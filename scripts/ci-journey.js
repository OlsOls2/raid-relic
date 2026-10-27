// Trusted CI launcher. Toolchain download happens BEFORE this offline boundary.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  writeFile,
  realpath,
  open,
  rm,
  access,
  readlink,
  stat,
} from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
let scratch,
  passed = false,
  preflightStage = 'repository',
  childExitCode = null,
  childSignal = 'none',
  errorCode = 'none',
  stderrCategory = 'none',
  stderrOrigin = 'none',
  permissionArea = 'none',
  insideStage = 'not-started',
  insideErrorCode = 'none';
let stderr = '';
const projectStderr = (value) => {
  stderrOrigin = /^bwrap:/m.test(value)
    ? 'bwrapPrefix'
    : /error while loading shared libraries|cannot execute binary/i.test(value)
      ? 'nativeLoader'
      : /EACCES|EPERM|EROFS/.test(value)
        ? 'nodeFilesystem'
        : value
          ? 'unclassified'
          : 'none';
  permissionArea = value.includes('/app/artifacts')
    ? 'artifacts'
    : value.includes('/tmp/home')
      ? 'home'
      : value.includes('/tool-node')
        ? 'tool-node'
        : /\/tmp(?:\/|['"\s])/.test(value)
          ? 'tmp'
          : /\/app(?:\/|['"\s])/.test(value)
            ? 'source'
            : 'none';
  const marker =
    /^CI_PREFLIGHT:(identity|namespaces|readonly|tmp|home|cache|artifacts|launch):(OK|EACCES|EPERM|EROFS|ENOENT|ENOSPC|invariant|other)$/m;
  for (const line of value.split('\n')) {
    const match = marker.exec(line);
    if (match) {
      insideStage = match[1];
      insideErrorCode = match[2];
    }
  }
};
const classifyStderr = (value) => {
  if (/unknown option|unrecognized option|invalid option|invalid argument/i.test(value))
    return 'invalidBwrapArg';
  if (/user namespace|creating new namespace|unshare|uid map|gid map|uid_map|gid_map/i.test(value))
    return 'userNamespaceUnavailable';
  if (/no such file or directory|cannot find module|executable doesn't exist/i.test(value))
    return 'missingMount';
  if (/permission denied|operation not permitted/i.test(value)) return 'permissionDenied';
  return value ? 'unclassified' : 'none';
};
// Trusted installed tool only; never execute target code during preflight.
async function supportsBoundedTmpfs(bwrap) {
  const help = spawn(
    '/usr/bin/prlimit',
    ['--cpu=2', '--data=67108864', '--nofile=64', '--fsize=65536', '--', bwrap, '--help'],
    { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '',
    bytes = 0,
    overflow = false,
    timedOut = false;
  for (const stream of [help.stdout, help.stderr])
    stream.on('data', (buffer) => {
      bytes += buffer.length;
      if (bytes > 65536) {
        overflow = true;
        help.kill('SIGKILL');
      } else output += buffer.toString('utf8');
    });
  const timeout = setTimeout(() => {
    timedOut = true;
    help.kill('SIGKILL');
  }, 5000);
  try {
    const code = await new Promise((ok, fail) => {
      help.once('error', fail);
      help.once('close', ok);
    });
    return (
      code === 0 &&
      !overflow &&
      !timedOut &&
      ['--size', '--perms', '--unshare-all'].every((flag) =>
        new RegExp('(?:^|\\s)' + flag + '(?:\\s|=|$)', 'm').test(output),
      )
    );
  } finally {
    clearTimeout(timeout);
    output = '';
  }
}
try {
  const repo = await realpath(process.cwd());
  preflightStage = 'browser-cache';
  const selected = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!selected || !isAbsolute(selected) || selected === '/') throw Error('Browser cache required');
  const browsers = await realpath(selected);
  if (browsers === '/' || browsers === repo || browsers.startsWith(repo + '/'))
    throw Error('Separate toolchain required');
  preflightStage = 'toolchain';
  const selectedBwrap = process.env.RAID_RELIC_BWRAP_PATH ?? '/usr/bin/bwrap';
  if (!isAbsolute(selectedBwrap)) throw Error('Absolute sandbox tool required');
  const bwrap = await realpath(selectedBwrap);
  const binary = await stat(bwrap);
  if (
    bwrap === repo ||
    bwrap.startsWith(repo + '/') ||
    !binary.isFile() ||
    (binary.mode & 0o6022) !== 0 ||
    ![0, process.getuid?.()].includes(binary.uid)
  )
    throw Error('Trusted non-setuid sandbox tool required');
  for (const executable of ['/usr/bin/prlimit', bwrap, process.execPath])
    await access(executable, constants.X_OK);
  preflightStage = 'sandbox-capabilities';
  if (!(await supportsBoundedTmpfs(bwrap))) {
    stderrCategory = 'unsupportedSandboxVersion';
    throw Error('Required sandbox capability unavailable');
  }
  preflightStage = 'identity';
  const uid = process.getuid?.(),
    gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0)
    throw Error('Nonroot identity required');
  preflightStage = 'scratch';
  scratch = await mkdtemp('/tmp/raid-relic-ci-');
  if (bwrap.startsWith(scratch + '/')) throw Error('Sandbox tool outside scratch required');
  await mkdir(join(scratch, 'artifacts'), { mode: 0o700 });
  await mkdir(resolve(repo, 'artifacts'), { recursive: true });
  await writeFile(join(scratch, 'hosts'), '127.0.0.1 localhost\n::1 localhost\n', { mode: 0o600 });
  const hostNamespaces = {};
  for (const name of ['user', 'pid', 'net'])
    hostNamespaces[name] = await readlink('/proc/self/ns/' + name);
  // Trusted bootstrap is mounted read-only. It emits closed markers and never
  // imports application code unless all sandbox invariants hold.
  await writeFile(
    join(scratch, 'preflight.mjs'),
    `
import { mkdir, open, unlink, readFile, readlink } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
let stage = 'identity';
const mark = (code) => process.stderr.write('CI_PREFLIGHT:' + stage + ':' + code + '\\n');
const requireInvariant = (ok) => { if (!ok) throw Object.assign(new Error(), { code: 'invariant' }); };
try {
  requireInvariant(process.getuid() === ${uid} && process.getgid() === ${gid} && process.getuid() > 0);
  mark('OK');
  stage = 'namespaces';
  const host = ${JSON.stringify(hostNamespaces)};
  for (const name of ['user', 'pid', 'net'])
    requireInvariant(await readlink('/proc/self/ns/' + name) !== host[name]);
  const interfaces = networkInterfaces();
  requireInvariant(Object.hasOwn(interfaces, 'lo') && Object.entries(interfaces).every(([name, rows]) =>
    name === 'lo' && rows.every((row) => row.internal)));
  mark('OK');
  stage = 'readonly';
  const mounts = (await readFile('/proc/self/mountinfo', 'utf8')).trim().split('\\n').map((line) => line.split(' '));
  for (const path of ['/app', '/tool-node', '/opt/playwright-browsers', '/ci-preflight.mjs'])
    requireInvariant(mounts.some((row) => row[4] === path && row[5].split(',').includes('ro')));
  mark('OK');
  for (const [name, path] of [['tmp', '/tmp'], ['home', '/tmp/home'], ['cache', '/tmp/home/cache'], ['artifacts', '/app/artifacts']]) {
    stage = name;
    if (name === 'home' || name === 'cache') await mkdir(path, { recursive: true, mode: 0o700 });
    const probe = path + '/.ci-write-probe';
    const handle = await open(probe, 'wx', 0o600);
    await handle.close();
    await unlink(probe);
    mark('OK');
  }
  stage = 'launch';
  mark('OK');
} catch (error) {
  mark(['EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOSPC', 'invariant'].includes(error?.code) ? error.code : 'other');
  process.exit(1);
}
await import('/app/scripts/browser-smoke-journey-ci.js');
`,
    { mode: 0o600 },
  );
  const args = [
    '--cpu=120',
    '--data=1073741824',
    '--nproc=512',
    '--nofile=2048',
    '--fsize=16777216',
    '--',
    bwrap,
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--uid',
    String(uid),
    '--gid',
    String(gid),
    '--clearenv',
    '--ro-bind',
    '/usr',
    '/usr',
    '--symlink',
    'usr/bin',
    '/bin',
    '--symlink',
    'usr/sbin',
    '/sbin',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--dir',
    '/etc',
    '--ro-bind',
    '/etc/fonts',
    '/etc/fonts',
    '--ro-bind',
    '/etc/ld.so.cache',
    '/etc/ld.so.cache',
    '--ro-bind',
    join(scratch, 'hosts'),
    '/etc/hosts',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--size',
    '536870912',
    '--perms',
    '1777',
    '--tmpfs',
    '/tmp',
    '--ro-bind',
    join(scratch, 'preflight.mjs'),
    '/ci-preflight.mjs',
    '--ro-bind',
    dirname(process.execPath),
    '/tool-node',
    '--ro-bind',
    browsers,
    '/opt/playwright-browsers',
    '--ro-bind',
    repo,
    '/app',
    '--bind',
    join(scratch, 'artifacts'),
    '/app/artifacts',
    '--chdir',
    '/app',
    '--setenv',
    'PATH',
    '/tool-node:/usr/bin:/bin',
    '--setenv',
    'HOME',
    '/tmp/home',
    '--setenv',
    'XDG_CACHE_HOME',
    '/tmp/home/cache',
    '--setenv',
    'TMPDIR',
    '/tmp',
    '--setenv',
    'OPENSSL_CONF',
    '/dev/null',
    '--setenv',
    'PLAYWRIGHT_BROWSERS_PATH',
    '/opt/playwright-browsers',
    '--setenv',
    'NODE_OPTIONS',
    '--max-old-space-size=256',
    '/tool-node/node',
    '/ci-preflight.mjs',
  ];
  preflightStage = 'sandbox-spawn';
  const child = spawn('/usr/bin/prlimit', args, {
    env: { PATH: '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bytes = 0,
    overflow = false,
    timedOut = false;
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b) => {
      bytes += b.length;
      if (stream === child.stderr && bytes <= 65536) stderr += b.toString('utf8');
      if (bytes > 65536) {
        overflow = true;
        child.kill('SIGKILL');
      }
    });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, 180000);
  let code;
  try {
    code = await new Promise((ok, fail) => {
      child.once('error', fail);
      child.once('close', (exitCode, signal) => {
        childExitCode = Number.isInteger(exitCode) ? exitCode : null;
        childSignal = ['SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGSEGV', 'SIGXCPU', 'SIGXFSZ'].includes(
          signal,
        )
          ? signal
          : signal
            ? 'other'
            : 'none';
        ok(exitCode);
      });
    });
  } finally {
    clearTimeout(timeout);
  }
  stderrCategory = classifyStderr(stderr);
  projectStderr(stderr);
  stderr = '';
  preflightStage = 'report-open';
  const handle = await open(
    join(scratch, 'artifacts', 'journey-ci-browser-results.json'),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let report;
  try {
    preflightStage = 'report-validate';
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 65536)
      throw Error('Report rejected');
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.ino !== before.ino)
      throw Error('Report changed');
    report = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await handle.close();
  }
  passed =
    code === 0 && !overflow && !timedOut && report.passed === true && report.checks?.length === 3;
  // Emit closed summary only; never child output, DOM, URLs or cookies.
  console.log(
    JSON.stringify({
      passed,
      checks: report.checks?.length ?? 0,
      stage: ['setup', 'own-control-send', 'signed-arrival', 'spotlight-replay-export'].includes(
        report.stage,
      )
        ? report.stage
        : 'other',
      assertionLine: Number.isSafeInteger(report.diagnostic?.assertionLine)
        ? report.diagnostic.assertionLine
        : 0,
      timedOut,
      outputOverflow: overflow,
      childExitCode,
      childSignal,
      stderrCategory,
      stderrOrigin,
      permissionArea,
      insideStage,
      insideErrorCode,
    }),
  );
} catch (error) {
  errorCode = ['ENOENT', 'EACCES', 'EPERM', 'EINVAL', 'ELOOP', 'ENOTDIR', 'ENOSPC'].includes(
    error?.code,
  )
    ? error.code
    : 'other';
  if (preflightStage === 'toolchain' && errorCode === 'ENOENT') stderrCategory = 'toolchainMissing';
  else if (stderr) {
    stderrCategory = classifyStderr(stderr);
    projectStderr(stderr);
  }
  stderr = '';
  console.log(
    JSON.stringify({
      passed: false,
      stage: 'sandbox-or-toolchain',
      preflightStage,
      childExitCode,
      childSignal,
      errorCode,
      stderrCategory,
      stderrOrigin,
      permissionArea,
      insideStage,
      insideErrorCode,
    }),
  );
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
if (!passed) process.exitCode = 1;
