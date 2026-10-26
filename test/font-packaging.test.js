import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app.js';
const fonts = [
  ['Cinzel.ttf', 'f4d83d34d1f6c741193e4acf4b3dff9531e5a67b6aa65228d00a7db72a4e0f34', 'font/ttf'],
  [
    'OFL-Cinzel.txt',
    'f2b3029aba64c378bf0963b62945eee15e564fe4330b934c8f2eb058282b5e83',
    'text/plain',
  ],
];
test('Docker normalizes only public fonts before switching user and verifies readable pinned bytes as node', async () => {
  const docker = await readFile('Dockerfile', 'utf8');
  const copy = docker.indexOf('COPY public/ ./public/');
  const normalize = docker.indexOf(
    'RUN chmod 0755 public/fonts && chmod 0644 public/fonts/Cinzel.ttf public/fonts/OFL-Cinzel.txt',
  );
  const user = docker.indexOf('USER node\n');
  const check = docker.indexOf('RUN node -e', user);
  assert.ok(copy >= 0 && normalize > copy && user > normalize && check > user);
  const command = docker.slice(check, docker.indexOf('\n', check));
  assert.match(command, /fs\.readFileSync\(file\)/);
  assert.match(command, /createHash\("sha256"\)/);
  for (const [name, digest] of fonts) {
    assert.ok(command.includes(`public/fonts/${name}`));
    assert.ok(command.includes(digest));
  }
  assert.ok(!/chmod.*777|chown/.test(docker));
  assert.ok(docker.indexOf('CMD ["node", "src/server.js"]') > check);
});
test('public fonts have portable read permissions, pinned bytes and exact HTTP routes', async () => {
  const directoryMode = (await stat('public/fonts')).mode;
  assert.equal(directoryMode & 0o005, 0o005);
  assert.equal(directoryMode & 0o002, 0);
  for (const [name, digest, type] of fonts) {
    const path = `public/fonts/${name}`,
      bytes = await readFile(path);
    const fileMode = (await stat(path)).mode;
    assert.equal(fileMode & 0o444, 0o444);
    assert.equal(fileMode & 0o002, 0);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
    const response = await createApp().dispatch({ method: 'GET', path: `/fonts/${name}` });
    assert.equal(response.status, 200);
    assert.ok(response.type.startsWith(type));
    assert.deepEqual(response.body, bytes);
  }
});
test('0600 owner-readable fixture illustrates why an owner-only host read cannot prove nonroot image readability', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'raid-relic-font-mode-'));
  try {
    const path = join(dir, 'synthetic-font');
    await writeFile(path, 'not a credential', { mode: 0o600 });
    await chmod(path, 0o600);
    assert.equal((await stat(path)).mode & 0o004, 0);
    assert.equal(await readFile(path, 'utf8'), 'not a credential');
    await chmod(path, 0o644);
    assert.equal((await stat(path)).mode & 0o004, 0o004);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
