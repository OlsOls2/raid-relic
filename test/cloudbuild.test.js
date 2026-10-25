import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

test('Cloud Build script rejects invalid release substitutions before invoking Docker and builds exact commit tag', async () => {
  const config = await readFile('cloudbuild.yaml', 'utf8');
  assert.match(config, /name: 'gcr.io\/cloud-builders\/docker'/);
  assert.match(config, /'RELEASE_COMMIT=\$\{_RELEASE_COMMIT\}'/);
  assert.match(config, /logging: CLOUD_LOGGING_ONLY/);
  assert.ok(!/^\s*(?:machineType|pool|substitutions|substitutionOption):/m.test(config));
  assert.match(config, /images:\n  - 'us-central1-docker.pkg.dev\/raid-relic-hackathon\/raid-relic\/app:\$\{_RELEASE_COMMIT\}'/);
  const literal = config.match(/      - \|\n((?:        .*\n)+)/)?.[1];
  assert.ok(literal);
  // Cloud Build turns $$ into literal $, leaving shell variables for Bash.
  const script = literal.replace(/^        /gm, '').replaceAll('$$', '$');
  const directory = await mkdtemp(join(process.cwd(), '.cloudbuild-test-'));
  try {
    await writeFile(join(directory, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    for (const value of ['', 'main', 'a'.repeat(39), 'a'.repeat(64), 'A'.repeat(40), 'a'.repeat(40) + '\n', '$(echo injected)', 'x;echo injected']) {
      const result = spawnSync('/bin/bash', ['-ceu', script], { env: { PATH: directory, RELEASE_COMMIT: value }, encoding: 'utf8' });
      assert.notEqual(result.status, 0, value); assert.equal(result.stdout, '');
    }
    const commit = 'a'.repeat(40);
    const result = spawnSync('/bin/bash', ['-ceu', script], { env: { PATH: directory, RELEASE_COMMIT: commit }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), ['build', '--build-arg', `RELEASE_COMMIT=${commit}`, '--tag',
      `us-central1-docker.pkg.dev/raid-relic-hackathon/raid-relic/app:${commit}`, '.']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
