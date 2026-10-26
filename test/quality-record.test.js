import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQARecords, qualityMetadata } from '../scripts/update-quality-record.js';
const now = Date.parse('2026-10-26T12:00:00.000Z');
const options = {
  expectedScripts: ['browser-smoke-a.js', 'browser-smoke-b.js'],
  nodeVersion: '22.23.4',
  observedAt: new Date(now).toISOString(),
  now,
};
const units = () => ({
  mode: 'tests',
  executions: [
    {
      status: 0,
      failed: false,
      testSummary: ['ℹ tests 10', 'ℹ pass 10', 'ℹ fail 0', 'ℹ skipped 0', 'ℹ cancelled 0'],
    },
  ],
});
const browsers = () =>
  ['a', 'b'].map((name, i) => ({
    script: `browser-smoke-${name}.js`,
    status: 0,
    failed: false,
    report: { passed: true, checks: i + 1 },
  }));
test('quality metadata derives counts from explicit complete successful reports', () => {
  const result = qualityMetadata(units(), browsers(), options);
  assert.equal(result.tests, 10);
  assert.equal(result.passed, 10);
  assert.equal(result.skipped, 0);
  assert.equal(result.workflows, 2);
  assert.equal(result.checks, 3);
  assert.equal(parseQARecords('ISOLATED_QA_RESULT ' + JSON.stringify(units()))[0].mode, 'tests');
  assert.equal(parseQARecords(browsers().map(JSON.stringify).join('\n')).length, 2);
  const wrapped = [{ mode: 'browser', executions: browsers() }];
  assert.equal(qualityMetadata(units(), wrapped, options).checks, 3);
});
test('failed, skipped, inconsistent or incomplete cohorts never update quality', () => {
  for (const changed of [
    { ...units(), failed: true },
    { mode: 'tests', executions: [{ ...units().executions[0], status: 1 }] },
    { mode: 'tests', executions: [{ ...units().executions[0], failed: true }] },
    ...['ℹ tests 11', 'ℹ skipped 1', 'ℹ fail 1'].map((row) => ({
      mode: 'tests',
      executions: [
        {
          status: 0,
          failed: false,
          testSummary: [
            ...units().executions[0].testSummary.filter(
              (s) => !s.startsWith(row.split(' ').slice(0, 2).join(' ')),
            ),
            row,
          ],
        },
      ],
    })),
  ])
    assert.throws(() => qualityMetadata(changed, browsers(), options));
  for (const changed of [
    browsers().slice(0, 1),
    [...browsers(), browsers()[0]],
    [{ ...browsers()[0], status: 1 }, browsers()[1]],
    [{ ...browsers()[0], report: { passed: false, checks: 1 } }, browsers()[1]],
    [{ ...browsers()[0], report: { passed: true, checks: 1, skipped: 1 } }, browsers()[1]],
    [{ ...browsers()[0], report: { passed: true, checks: [{ passed: false }] } }, browsers()[1]],
  ])
    assert.throws(() => qualityMetadata(units(), changed, options));
});
test('quality metadata rejects stale/future reports, old Node and malformed private records without echoing them', () => {
  for (const patch of [
    { observedAt: '2026-10-24T12:00:00.000Z' },
    { observedAt: '2026-10-27T12:00:00.000Z' },
    { latestSourceTime: now + 1 },
    { nodeVersion: '20.0.0' },
    { nodeVersion: '22.23.4\n' },
  ])
    assert.throws(() => qualityMetadata(units(), browsers(), { ...options, ...patch }));
  assert.throws(
    () => parseQARecords('PRIVATE_NOT_JSON'),
    (error) => !error.message.includes('PRIVATE_NOT_JSON'),
  );
});

const nativeUnit = () => ({
  mode: 'tests',
  failed: false,
  executions: [
    {
      args: ['--test', '--test-reporter=spec', '--test-concurrency=1'],
      status: 0,
      signal: null,
      failedTests: [],
      testSummary: ['ℹ tests 10', 'ℹ pass 10', 'ℹ fail 0', 'ℹ skipped 0'],
      tail: 'Ignored; never copied into the quality record',
    },
  ],
  reports: [],
});
const nativeFlow = (script, checks) => ({
  mode: 'browsers',
  failed: false,
  executions: [{ args: [`scripts/${script}`], status: 0, signal: null }],
  reports: [
    {
      name: 'browser-results.json',
      passed: true,
      checks,
      failure: null,
      stage: null,
      failureCategory: null,
      diagnostic: null,
    },
  ],
});
const nativeOptions = {
  ...options,
  expectedScripts: ['browser-smoke.js', 'browser-smoke-tier1.js'],
};
test('actual supervisors inherit explicit root success and include the basic browser workflow', () => {
  const records = [nativeFlow('browser-smoke.js', 13), nativeFlow('browser-smoke-tier1.js', 3)];
  const result = qualityMetadata(nativeUnit(), records, nativeOptions);
  assert.equal(result.tests, 10);
  assert.equal(result.workflows, 2);
  assert.equal(result.checks, 16);
  assert.equal(
    parseQARecords(records.map((r) => 'ISOLATED_QA_RESULT ' + JSON.stringify(r)).join('\n')).length,
    2,
  );
  const multi = nativeFlow('browser-smoke.js', 13);
  multi.reports.push({ ...multi.reports[0], name: 'second-results.json', checks: 2 });
  assert.equal(qualityMetadata(nativeUnit(), [multi, records[1]], nativeOptions).checks, 18);
  assert.ok(!JSON.stringify(result).includes('Ignored'));
});
test('actual supervisor failures, missing success proof, signal, reports and incomplete flows fail closed', () => {
  const records = [nativeFlow('browser-smoke.js', 13), nativeFlow('browser-smoke-tier1.js', 3)];
  for (const mutate of [
    (u) => {
      u.failed = true;
    },
    (u) => {
      delete u.failed;
    },
    (u) => {
      u.executions[0].status = 1;
    },
    (u) => {
      u.executions[0].signal = 'SIGTERM';
    },
    (u) => {
      u.executions[0].failedTests = ['not copied'];
    },
    (u) => {
      u.executions[0].testSummary[3] = 'ℹ skipped 1';
    },
  ]) {
    const unit = nativeUnit();
    mutate(unit);
    assert.throws(() => qualityMetadata(unit, records, nativeOptions));
  }
  for (const mutate of [
    (r) => {
      r.failed = true;
    },
    (r) => {
      delete r.failed;
    },
    (r) => {
      r.executions[0].signal = 'SIGTERM';
    },
    (r) => {
      r.executions[0].error = 'not copied';
    },
    (r) => {
      r.reports = [];
    },
    (r) => {
      r.reports[0].checks = 0;
    },
    (r) => {
      r.reports[0].passed = false;
    },
    (r) => {
      r.reports[0].failure = 'not copied';
    },
    (r) => {
      r.reports[0].failureCategory = 'timeout';
    },
  ]) {
    const flow = nativeFlow('browser-smoke.js', 13);
    mutate(flow);
    assert.throws(() => qualityMetadata(nativeUnit(), [flow, records[1]], nativeOptions));
  }
  assert.throws(() => qualityMetadata(nativeUnit(), [records[0]], nativeOptions));
  assert.throws(() => qualityMetadata(nativeUnit(), [records[0], records[0]], nativeOptions));
});
