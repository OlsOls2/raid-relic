import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('judge front door uses canonical links, clear pitch and linked technical evidence', async () => {
  const s = await readFile('README.md', 'utf8');
  for (const term of [
    'A raid usually lasts ten seconds. Raid Relic turns it into something two communities build together, then pass on.',
    'Judge in 60 seconds',
    'https://raid-relic-760724762396.us-central1.run.app/demo/',
    'https://raid-relic-760724762396.us-central1.run.app/atlas/',
    'Autoplay 35-second tour',
    '```mermaid',
    'Node.js 22+',
    'npm ci && npm test',
    'multiple **simultaneous** relics',
    'clips:edit',
    'not runtime-wired',
    'docs/QUALITY.md',
    'BUILT_WITH_CODEX.md',
    'ARCHITECTURE.md',
  ])
    assert.ok(
      term.startsWith('multiple ')
        ? s.replace(/\s+/g, ' ').toLowerCase().includes(term.toLowerCase())
        : s.replace(/\s+/g, ' ').includes(term),
      term,
    );
  assert.match(
    s.replace(/\s+/g, ' '),
    /multiple \*\*simultaneous\*\* relics[^\n]*future work[^\n]*not a current feature/i,
  );
  assert.ok(!s.includes('p9-review---'));
  assert.ok(!/\| P[1-9] \|/.test(s));
  const built = await readFile('BUILT_WITH_CODEX.md', 'utf8'),
    scopes = await readFile('docs/JUDGE_SCOPES.md', 'utf8');
  assert.ok(built.includes('01a1705c-a87d-7143-80f6-021e47b78ced'));
  for (let i = 1; i <= 9; i++) assert.ok(built.includes(`| P${i} `));
  for (const scope of [
    'user:read:chat',
    'user:write:chat',
    'user:bot',
    'channel:bot',
    'channel:manage:raids',
    'moderator:manage:announcements',
    'moderator:manage:chat_messages',
    'moderator:manage:shoutouts',
    'user:read:moderated_channels',
    'clips:edit',
  ])
    assert.ok(scopes.includes(scope));
  assert.ok((await readFile('docs/media/raid-relic-hero.png')).length > 0);
});
test('bundled notices preserve full third-party terms and raw evidence is not generally unignored', async () => {
  const notice = await readFile('THIRD_PARTY_NOTICES.md', 'utf8'),
    mit = await readFile('public/vendor/LICENSE-three.txt', 'utf8'),
    ofl = await readFile('public/fonts/OFL-Cinzel.txt', 'utf8'),
    ignore = await readFile('.gitignore', 'utf8');
  assert.match(notice, /0\.186\.0/);
  assert.match(notice, /Version2\.000/);
  assert.match(notice, /public\/vendor\/LICENSE-three\.txt/);
  assert.match(notice, /public\/fonts\/OFL-Cinzel\.txt/);
  assert.match(mit, /Permission is hereby granted/);
  assert.match(mit, /THE SOFTWARE IS PROVIDED/);
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(ofl, /PERMISSION & CONDITIONS/);
  assert.ok(ignore.includes('/.codex-evidence/run-*.jsonl'));
  assert.ok(!ignore.split('\n').some((line) => line.startsWith('!/.codex-evidence/run-')));
});
