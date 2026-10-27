// Trusted CI launcher. Toolchain download happens BEFORE this offline boundary.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, writeFile, realpath, open, rm } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
let scratch,
  passed = false;
try {
  const repo = await realpath(process.cwd());
  const selected = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!selected || !isAbsolute(selected) || selected === '/') throw Error('Browser cache required');
  const browsers = await realpath(selected);
  if (browsers === '/' || browsers === repo || browsers.startsWith(repo + '/'))
    throw Error('Separate toolchain required');
  scratch = await mkdtemp('/tmp/raid-relic-ci-');
  await mkdir(join(scratch, 'artifacts'), { mode: 0o700 });
  await mkdir(resolve(repo, 'artifacts'), { recursive: true });
  await writeFile(join(scratch, 'hosts'), '127.0.0.1 localhost\n::1 localhost\n', { mode: 0o600 });
  const args = [
    '--cpu=120',
    '--data=1073741824',
    '--nproc=512',
    '--nofile=2048',
    '--fsize=16777216',
    '--',
    '/usr/bin/bwrap',
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--uid',
    '1000',
    '--gid',
    '1000',
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
    '--tmpfs',
    '/tmp',
    '--dir',
    '/tmp/home',
    '--dir',
    '/tmp/home/cache',
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
    'scripts/browser-smoke-journey-ci.js',
  ];
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
      child.once('close', ok);
    });
  } finally {
    clearTimeout(timeout);
  }
  const handle = await open(
    join(scratch, 'artifacts', 'journey-ci-browser-results.json'),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let report;
  try {
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
    }),
  );
} catch {
  console.log(JSON.stringify({ passed: false, stage: 'sandbox-or-toolchain' }));
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
if (!passed) process.exitCode = 1;
