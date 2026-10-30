import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('judge front door uses canonical links, clear pitch and linked technical evidence', async () => {
  const s = await readFile('README.md', 'utf8');
  const guide = await readFile('docs/PROJECT_GUIDE.md', 'utf8');
  assert.ok(s.trimEnd().split('\n').length < 40);
  for (const term of [
    'Raids that leave a story.',
    'Node.js 22+',
    'npm ci && npm test',
    'docs/PROJECT_GUIDE.md',
    'docs/PROVENANCE.md',
    'docs/QUALITY.md',
    'BUILT_WITH_CODEX.md',
    'ARCHITECTURE.md',
    'Unofficial fan project. Not affiliated with Twitch.',
  ])
    assert.ok(s.includes(term), term);
  assert.ok(
    s.includes(
      'https://film-clock-1030---raid-relic-vz4bhnskgq-uc.a.run.app/demo/film?autoplay=1&kiosk=1',
    ),
  );
  assert.match(
    s,
    /!\[Neutral original[^\]]*not a screenshot or live proof\]\(public\/relic\.svg\)/,
  );
  assert.ok(
    s.includes(
      'Original procedural/vector art, not a live view, screenshot or verification result.',
    ),
  );
  const linked = s + '\n' + guide;
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
  ])
    assert.ok(
      term.startsWith('multiple ')
        ? linked.replace(/\s+/g, ' ').toLowerCase().includes(term.toLowerCase())
        : linked.replace(/\s+/g, ' ').includes(term),
      term,
    );
  assert.match(
    linked.replace(/\s+/g, ' '),
    /multiple \*\*simultaneous\*\* relics[^\n]*future work[^\n]*not a current feature/i,
  );
  assert.ok(!s.includes('p9-review---'));
  for (const term of [
    'not open public signup',
    'saved downloads cannot be recalled',
    'not a zero-invoice guarantee',
  ])
    assert.ok(s.toLowerCase().includes(term), term);
  assert.match(guide, /LOCAL UNPUBLISHED/);
  assert.match(guide, /ten-second client-only expiry|client-only expiry/);
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

// Parent-readable documentation guards; do not read generated evidence contents.
test('provenance and private draft separate historical/published/local proof and four paraphrased episodes', async () => {
  const paths = [
    'README.md',
    'docs/PROJECT_GUIDE.md',
    'docs/PROVENANCE.md',
    'docs/DEVPOST_DRAFT.md',
    'docs/CODEX_USAGE.md',
    'docs/SCREENSHOTS.md',
    'docs/JUDGES.md',
  ];
  const text = {};
  for (const path of paths) {
    text[path] = await readFile(path, 'utf8');
    assert.ok(Buffer.byteLength(text[path]) <= 131072);
  }
  const provenance = text['docs/PROVENANCE.md'],
    draft = text['docs/DEVPOST_DRAFT.md'];
  for (const value of [
    '01a1705c-a87d-7143-80f6-021e47b78ced',
    '95635e4dc347bf72234a7918af6bba2ef1d97a27',
    '934/934',
    '46 browser flows / 141 checks',
    '41087864748',
    'LOCAL UNPUBLISHED',
    'run270',
    '295/296',
    'BLOCKED',
    '1565854078880190495',
    '2026-10-30T22:25:04Z',
    '16 MiB each / 32 MiB total',
    'missing-approval blocker is cleared',
    'not be summed',
    '20:56 UTC',
    'd2ae612',
  ])
    assert.ok(provenance.includes(value), value);
  for (const name of ['raidrelichq', 'olsols2', 'olsols3'])
    assert.ok(provenance.includes(name) && draft.includes(name));
  assert.match(provenance, /not community adoption, real-user growth or a public launch/);
  assert.match(provenance, /not physical OBS/);
  assert.match(draft, /^# PRIVATE DRAFT[^\n]*not submitted/);
  assert.equal((draft.match(/^### Episode [1-4] ·/gm) ?? []).length, 4);
  assert.equal((draft.match(/\*\*Prompt\/problem paraphrase:\*\*/g) ?? []).length, 4);
  for (const value of [
    'paraphrases, not verbatim quotes',
    'c63ec31',
    'd8eecf4',
    'b079fe8',
    'run061',
    '8ded729',
  ])
    assert.ok(draft.includes(value), value);
  for (const [path, body] of Object.entries(text)) {
    assert.doesNotMatch(
      body,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bBearer [A-Za-z0-9._~-]{20,}|https?:\/\/[^\s)]+[?&](?:access_token|refresh_token|client_secret)=/,
    );
    if (path === 'README.md' || path === 'docs/PROVENANCE.md' || path === 'docs/DEVPOST_DRAFT.md')
      for (const m of body.matchAll(/\]\(([^)]+)\)/g)) {
        const target = m[1];
        if (/^(?:https?:|#)/.test(target)) continue;
        const url = new URL(target, new URL('../' + path, import.meta.url));
        assert.ok((await stat(url)).isFile(), target);
      }
  }
});

test('current judge docs use neutral original art and preserve obsolete captures only as unchanged archive metadata', async () => {
  for (const path of [
    'README.md',
    'docs/PROJECT_GUIDE.md',
    'docs/SCREENSHOTS.md',
    'docs/JUDGES.md',
  ]) {
    const body = await readFile(path, 'utf8');
    assert.doesNotMatch(body, /!\[[^\]]*\]\([^)]*\.png(?:[?#][^)]*)?\)/i);
  }
  const svg = await readFile('public/relic.svg', 'utf8');
  assert.match(svg, /<svg\b/);
  assert.doesNotMatch(svg, /twitchcon|san diego/i);
  const judges = await readFile('docs/JUDGES.md', 'utf8');
  assert.match(
    judges,
    /Open the \[45-second whole-loop sandbox\]\(https:\/\/film-clock-1030---raid-relic-vz4bhnskgq-uc\.a\.run\.app\/demo\/judge\)/,
  );
  assert.ok(
    judges.includes(
      'Older judge-sandbox/demo-film/holder-card links above are historical release references only',
    ),
  );
  const archive = await readFile('docs/SCREENSHOTS.md', 'utf8');
  for (const [name, size, digest] of [
    [
      'atlas-preview.png',
      110700,
      '6197c17f9e9c2eb7cb8b045f246588066999590fe4a37765779789d12ddc5bd0',
    ],
    [
      'keeper-page-preview.png',
      81955,
      '8e5bf4cb7ab45b04eb1d52b4a028bcb7b530addcda4db701f89c141c96fd14ee',
    ],
    [
      'demo-preview.png',
      106847,
      'ec75662569176d2e4aaacb8ef5bfb4693d549f434d0d642dbca76c54f7bdc9dd',
    ],
    [
      'demo-film-story.png',
      162989,
      '337efc7061e04a84db1ea4cffac7998694cc4a548c84ba646fde45d835d60397',
    ],
    [
      'demo-film-card.png',
      104131,
      '9be007861da071e31b95df43147fd5679ab590eee77a1ddfc3ea7e3dcd47c1c9',
    ],
  ]) {
    assert.ok(archive.includes(name) && archive.includes(digest));
    const bytes = await readFile('docs/media/' + name);
    assert.equal(bytes.length, size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  }
});

test('authorized QA session registry separates report-only contribution, original export and pending integration', async () => {
  const registry = await readFile('docs/CODEX_SESSIONS.md', 'utf8');
  const report = await readFile('docs/RUNTIME_RELEASE_QA.md', 'utf8');
  assert.ok(Buffer.byteLength(registry) <= 32768 && Buffer.byteLength(report) <= 65536);
  const ids = [
    ...new Set(registry.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g)),
  ].sort();
  assert.deepEqual(ids, [
    '01a1705c-a87d-7143-80f6-021e47b78ced',
    '01a18f00-8033-7d81-befa-9b82d727a3a6',
  ]);
  for (const value of [
    '1565854078880190495',
    '2026-10-30T22:25:04Z',
    'feature/raid-relic-runtime-qa-1030',
    '95609788c054dfce6b2a968555a79f5ded8ff9c0',
    'UNFORMATTED docs298 / app296',
    '46/46',
    '147 checks',
    '317 source hashes',
    'run270',
    'original301',
    'pending',
  ])
    assert.ok(registry.includes(value), value);
  assert.match(registry, /worker transcript is \*\*not included\*\*/);
  assert.match(registry, /only `docs\/RUNTIME_RELEASE_QA\.md`/);
  assert.match(report, /canonical-formatted source parity or exact final-commit parity/);
  assert.ok(report.includes('No worker session ID is asserted') === false);
  assert.ok(report.includes('01a18f00-8033-7d81-befa-9b82d727a3a6'));
  for (const path of [
    'docs/PROVENANCE.md',
    'docs/CODEX_USAGE.md',
    'docs/DEVPOST_DRAFT.md',
    'docs/CODEX_EVIDENCE.md',
  ]) {
    const body = await readFile(path, 'utf8');
    assert.ok(body.includes('CODEX_SESSIONS.md'), path);
    assert.ok(
      body.includes('01a18f00-8033-7d81-befa-9b82d727a3a6') || path === 'docs/CODEX_EVIDENCE.md',
      path,
    );
  }
});
