import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

// Parse only: no DOM/module execution, server, network or provider initialization.
// Closed first-party roots, top-level JS only; vendor/fonts/private artifacts are not traversed.
test(
  'all first-party application, browser, script and fixture modules parse before runtime QA',
  { timeout: 30000 },
  async () => {
    const root = await realpath(fileURLToPath(new URL('../', import.meta.url))),
      files = [];
    for (const name of ['src', 'public', 'scripts', 'test-support']) {
      const dir = join(root, name);
      assert.equal((await lstat(dir)).isSymbolicLink(), false);
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        assert.equal(entry.isSymbolicLink(), false, `Symlink rejected in ${name}`);
        if (!entry.name.endsWith('.js')) continue;
        assert.ok(entry.isFile(), `Expected regular JavaScript file in ${name}`);
        const file = join(dir, entry.name),
          resolved = await realpath(file),
          path = relative(root, resolved);
        assert.ok(path && !path.startsWith('..') && !isAbsolute(path));
        assert.equal(resolved, file);
        files.push(file);
      }
    }
    assert.ok(files.length > 0 && files.length <= 160, 'Bounded first-party module inventory');
    assert.ok(files.includes(join(root, 'public', 'demo.js')));
    for (const file of files.sort()) {
      const result = spawnSync(process.execPath, ['--check', file], {
        cwd: root,
        timeout: 3000,
        maxBuffer: 65536,
        encoding: 'utf8',
      });
      assert.equal(result.error, undefined, `Parser unavailable: ${relative(root, file)}`);
      assert.equal(result.signal, null, `Parser interrupted: ${relative(root, file)}`);
      assert.equal(result.status, 0, `JavaScript syntax failed: ${relative(root, file)}`);
    }
  },
);
