// Operator-only closed QA metadata; explicit report paths, no raw log discovery.
import { readFile, readdir, lstat, writeFile, rename } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const count = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100000;
const failedReport = (r) =>
  !r ||
  r.passed === false ||
  r.failed === true ||
  (typeof r.failed === 'number' && r.failed > 0) ||
  r.skipped === true ||
  (typeof r.skipped === 'number' && r.skipped > 0) ||
  r.skip === true ||
  r.truncated === true ||
  r.timedOut === true ||
  r.timeout === true ||
  Boolean(r.error) ||
  r.timeouts === true ||
  (typeof r.timeouts === 'number' && r.timeouts > 0) ||
  (Array.isArray(r.errors) && r.errors.length > 0);
const browserScript = /^browser-smoke(?:-[a-z0-9-]+)?\.js$/;
const successful = (execution, supervisor) => {
  const explicitSuccess =
    execution?.failed === false ||
    execution?.failed === 0 ||
    (execution?.failed === undefined && supervisor?.failed === false);
  return (
    execution &&
    execution.status === 0 &&
    explicitSuccess &&
    execution.signal == null &&
    !failedReport(execution) &&
    (execution.failedTests === undefined ||
      (Array.isArray(execution.failedTests) && execution.failedTests.length === 0))
  );
};
function supervisorFlow(record) {
  if (
    record.failed !== false ||
    failedReport(record) ||
    !Array.isArray(record.executions) ||
    record.executions.length !== 1 ||
    !successful(record.executions[0], record) ||
    !Array.isArray(record.reports) ||
    !record.reports.length ||
    record.reports.length > 32
  ) {
    throw Error('Browser supervisor execution failed');
  }
  const execution = record.executions[0];
  if (
    !Array.isArray(execution.args) ||
    execution.args.length > 64 ||
    execution.args.some((arg) => typeof arg !== 'string' || arg.length > 512)
  ) {
    throw Error('Browser supervisor arguments rejected');
  }
  const scripts = execution.args
    .map((arg) => basename(arg))
    .filter((arg) => browserScript.test(arg));
  if (scripts.length !== 1) throw Error('Browser supervisor script rejected');
  const names = new Set();
  let checks = 0;
  for (const report of record.reports) {
    if (
      report?.passed !== true ||
      failedReport(report) ||
      report.failure != null ||
      report.failureCategory != null ||
      !Number.isSafeInteger(report.checks) ||
      report.checks < 1 ||
      report.checks > 100000 ||
      typeof report.name !== 'string' ||
      !/^[a-z0-9-]+\.json$/.test(report.name) ||
      names.has(report.name)
    )
      throw Error('Browser supervisor report rejected');
    names.add(report.name);
    checks += report.checks;
  }
  if (!count(checks)) throw Error('Browser supervisor total rejected');
  return { script: scripts[0], checks };
}
export function parseQARecords(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1048576)
    throw Error('QA report rejected');
  try {
    return [JSON.parse(text)];
  } catch {}
  const lines = text.trim().split('\n');
  if (!lines.length || lines.length > 128) throw Error('QA report bounds rejected');
  return lines.map((line) => {
    const value = line.replace(/^ISOLATED_QA_RESULT\s*:?\s*/, '');
    try {
      return JSON.parse(value);
    } catch {
      throw Error('QA record rejected');
    }
  });
}
export function qualityMetadata(
  unit,
  browsers,
  { expectedScripts, nodeVersion, observedAt, now = Date.now(), latestSourceTime = 0 } = {},
) {
  if (
    typeof nodeVersion !== 'string' ||
    nodeVersion !== nodeVersion.trim() ||
    !/^v?(?:2[2-9]|[3-9]\d)\.\d+\.\d+$/.test(nodeVersion)
  )
    throw Error('Node version rejected');
  const time = Date.parse(observedAt);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== observedAt ||
    time < latestSourceTime ||
    time > now + 5000 ||
    now - time > 86400000
  )
    throw Error('Stale QA rejected');
  if (
    unit?.mode !== 'tests' ||
    failedReport(unit) ||
    !Array.isArray(unit.executions) ||
    unit.executions.length !== 1 ||
    !successful(unit.executions[0], unit)
  )
    throw Error('Unit execution failed');
  const execution = unit.executions[0],
    totals = {};
  const summaryRows = Array.isArray(execution.testSummary)
    ? execution.testSummary
    : execution.testSummary?.rows;
  if (!Array.isArray(summaryRows) || summaryRows.length > 100) throw Error('Unit summary missing');
  for (const row of summaryRows) {
    const text = typeof row === 'string' ? row : row?.text;
    const match =
      typeof text === 'string' &&
      /^(?:ℹ\s*)?(tests|pass|fail|skipped|cancelled)\s+(\d+)\s*$/.exec(text.trim());
    if (!match) continue;
    if (Object.hasOwn(totals, match[1])) throw Error('Duplicate unit count');
    totals[match[1]] = Number(match[2]);
  }
  if (
    !['tests', 'pass', 'fail', 'skipped'].every((k) => count(totals[k])) ||
    !totals.tests ||
    totals.tests !== totals.pass ||
    totals.fail !== 0 ||
    totals.skipped !== 0 ||
    (totals.cancelled ?? 0) !== 0
  )
    throw Error('Unit count mismatch or non-pass');
  const flows = [];
  for (const record of browsers) {
    if (failedReport(record)) throw Error('Truncated browser cohort');
    if (record.mode === 'browsers') {
      flows.push(supervisorFlow(record));
      continue;
    }
    const rows = record.mode === 'browser' ? record.executions : [record];
    if (!Array.isArray(rows) || !rows.length) throw Error('Browser records missing');
    for (const row of rows) {
      const report = row.report;
      if (
        !successful(row, record) ||
        report?.passed !== true ||
        report.failureCategory != null ||
        failedReport(report)
      )
        throw Error('Browser execution failed');
      const checks = Array.isArray(report.checks)
        ? report.checks.every((c) => c.passed === true && !failedReport(c))
          ? report.checks.length
          : -1
        : report.checks;
      if (!count(checks) || !checks || typeof row.script !== 'string' || row.script.length > 512)
        throw Error('Browser count rejected');
      const script = basename(row.script);
      if (!browserScript.test(script)) throw Error('Browser script rejected');
      flows.push({ script, checks });
    }
  }
  const names = flows.map((f) => f.script).sort();
  if (
    !Array.isArray(expectedScripts) ||
    !expectedScripts.length ||
    new Set(names).size !== names.length ||
    names.join(',') !== [...expectedScripts].sort().join(',')
  )
    throw Error('Incomplete browser cohort');
  return {
    observedAt: new Date(time).toISOString(),
    nodeVersion: nodeVersion.replace(/^v/, ''),
    tests: totals.tests,
    passed: totals.pass,
    skipped: 0,
    workflows: flows.length,
    checks: flows.reduce((n, f) => n + f.checks, 0),
  };
}
async function report(path) {
  const file = resolve(path),
    info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576)
    throw Error('Report file rejected');
  const bytes = await readFile(file);
  return {
    records: parseQARecords(bytes.toString('utf8')),
    mtime: info.mtimeMs,
    digest: sha(bytes),
  };
}
async function sourceIdentity(root) {
  const rows = [];
  let latest = 0;
  for (const directory of ['src', 'public', 'scripts', 'test', 'test-support']) {
    for (const name of (await readdir(join(root, directory))).sort()) {
      if (!/\.(?:js|html|css)$/.test(name)) continue;
      const path = join(root, directory, name),
        s = await lstat(path);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 2097152)
        throw Error('Source identity rejected');
      latest = Math.max(latest, s.mtimeMs);
      rows.push(`${directory}/${name}:${sha(await readFile(path))}`);
    }
  }
  for (const name of ['package.json', 'package-lock.json', 'README.md']) {
    const s = await lstat(join(root, name));
    if (!s.isFile() || s.isSymbolicLink() || s.size > 2097152)
      throw Error('Source identity rejected');
    latest = Math.max(latest, s.mtimeMs);
    rows.push(`${name}:${sha(await readFile(join(root, name)))}`);
  }
  return { latest, digest: sha(rows.sort().join('\n')) };
}
export async function updateQualityRecord({
  root = process.cwd(),
  unitReport,
  browserReport,
  nodeVersion,
} = {}) {
  if (!unitReport || !browserReport) throw Error('Explicit reports required');
  const unit = await report(unitReport),
    browser = await report(browserReport),
    source = await sourceIdentity(root);
  if (unit.records.length !== 1) throw Error('One unit cohort required');
  const expectedScripts = (await readdir(join(root, 'scripts'))).filter((n) =>
    browserScript.test(n),
  );
  const earliest = Math.min(unit.mtime, browser.mtime);
  if (
    earliest < source.latest ||
    Date.now() - earliest > 86400000 ||
    Math.max(unit.mtime, browser.mtime) > Date.now() + 5000
  )
    throw Error('Stale report files');
  const data = qualityMetadata(unit.records[0], browser.records, {
    expectedScripts,
    nodeVersion,
    observedAt: new Date(Math.max(unit.mtime, browser.mtime)).toISOString(),
    latestSourceTime: source.latest,
  });
  const file = join(root, 'docs/QUALITY.md'),
    info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw Error('Quality destination rejected');
  const old = await readFile(file, 'utf8'),
    end = '<!-- CURRENT_QUALITY_END -->';
  const history = old.includes(end)
    ? old.slice(old.indexOf(end) + end.length).trim()
    : old.replace(/^# Dated quality record\s*/, '## Earlier dated checkpoints\n\n');
  const markdown = `# Dated quality record\n\n<!-- CURRENT_QUALITY_START -->\nGenerated from successful operator reports; not source-author execution or physical Twitch proof.\n\n| Latest observed cohort | Value |\n|---|---|\n| Observed UTC | ${data.observedAt} |\n| Node | ${data.nodeVersion} |\n| Unit tests / pass / skip | ${data.tests} / ${data.passed} / 0 |\n| Browser workflows / checks | ${data.workflows} / ${data.checks} |\n| Source identity SHA256 | ${source.digest} |\n| Unit report SHA256 | ${unit.digest} |\n| Browser report SHA256 | ${browser.digest} |\n\n${end}\n\n${history}\n`;
  const temporary = file + '.quality.tmp';
  await writeFile(temporary, markdown, { flag: 'wx', mode: 0o644 });
  await rename(temporary, file);
  return data;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2),
      options = {};
    if (args.length !== 6) throw Error('Arguments rejected');
    for (let i = 0; i < args.length; i += 2) {
      const key = {
        '--unit-report': 'unitReport',
        '--browser-report': 'browserReport',
        '--node-version': 'nodeVersion',
      }[args[i]];
      if (!key || options[key]) throw Error('Arguments rejected');
      options[key] = args[i + 1];
    }
    console.log(JSON.stringify(await updateQualityRecord(options)));
  } catch {
    console.error(
      'Quality record rejected: require fresh complete zero-failure/zero-skip operator reports; no report content printed.',
    );
    process.exitCode = 1;
  }
}
