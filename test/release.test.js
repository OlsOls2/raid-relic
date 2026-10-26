import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { validateReleaseCommit } from '../src/release.js';
import { releaseFiles } from '../scripts/release-files.js';

test('health reports validated release and foundation readiness without claiming raids or DB readiness', async () => {
  for (const length of [40, 64]) {
    const commit = 'a'.repeat(length);
    const response = await createApp({ releaseCommit: commit }).dispatch({
      method: 'GET',
      path: '/health',
    });
    assert.deepEqual(JSON.parse(response.body), {
      status: 'ok',
      demo: 'simulated-client-only',
      releaseCommit: commit,
      phase: 'foundation',
      readiness: 'not-ready-for-raids',
      mode: 'live',
    });
  }
  assert.equal(validateReleaseCommit(undefined), null);
  assert.throws(() => validateReleaseCommit(undefined, { required: true }));
  for (const value of [
    '',
    'main',
    'abc1234',
    'g'.repeat(40),
    'A'.repeat(40),
    'a'.repeat(40) + '\n',
    '<script>',
  ])
    assert.throws(() => createApp({ releaseCommit: value }));
});
test('release inventory is runtime/build files only, with reproducible source parity hashes', async () => {
  const first = await releaseFiles(process.cwd());
  const again = await releaseFiles(process.cwd());
  assert.deepEqual(first, again);
  assert.ok(first.some((item) => item.file === 'src/server.js'));
  assert.ok(first.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.ok(
    first.every(
      (item) =>
        !/^(?:test|test-support|scripts|node_modules|\.git|\.codex-evidence|\.env|secrets)/.test(
          item.file,
        ),
    ),
  );
  const runtime = await releaseFiles(process.cwd(), { runtime: true });
  assert.ok(first.some((item) => item.file === 'cloudbuild.yaml'));
  assert.ok(
    runtime.every(
      (item) =>
        !['Dockerfile', 'cloudbuild.yaml', '.dockerignore', '.gcloudignore'].includes(item.file),
    ),
  );
  assert.ok((await readFile('.gcloudignore', 'utf8')).split('\n').includes('!cloudbuild.yaml'));
  assert.ok(!(await readFile('.dockerignore', 'utf8')).split('\n').includes('!cloudbuild.yaml'));
  for (const name of ['.dockerignore', '.gcloudignore']) {
    const patterns = (await readFile(name, 'utf8'))
      .split('\n')
      .filter((line) => line && !line.startsWith('#'));
    assert.equal(patterns[0], '**');
    assert.ok(
      !patterns.some(
        (line) =>
          line.includes('test') ||
          line.includes('simulator') ||
          line.includes('evidence') ||
          line.includes('node_modules'),
      ),
    );
  }
});
