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
  assert.match(guide, /panels14a4 is the latest deployed review release/);
  assert.match(guide, /newer gate\/connect\/parallel contributions are LOCAL UNCOMMITTED/);
  assert.doesNotMatch(s, /\b(?:1151|934)\b|\d+\/\d+ native/);
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
    'LOCAL UNCOMMITTED',
    '14a4f138858de911741510fc5b14c051594f2604',
    '31 October 2026, 00:20:59.568 UTC',
    '41145753035',
    '1,151/1,151',
    'FORMAT-LOCKED 46/46 browser workflows /147 checks',
    '3,600,206 ms',
    '3,605,492 ms',
    'run270',
    '295/296',
    'BLOCKED',
    '1565854078880190495',
    '2026-10-30T22:25:04Z',
    '16 MiB each / 32 MiB total',
    'missing-approval blocker is cleared',
    'not be summed',
    '20:56UTC',
    'd2ae612',
  ])
    assert.ok(provenance.includes(value), value);
  assert.match(provenance, /panels-1030.*at \*\*0% traffic\*\*/);
  assert.match(provenance, /Earlier published feature checkpoints · historical/);
  assert.match(provenance, /UNFORMATTED immutable docs298 snapshot \/ app296 bytes/);
  assert.match(provenance, /result is \*\*unknown\*\* here/);
  assert.match(provenance, /No worker patches are copied\/merged by this documentation turn/);
  assert.match(provenance, /No access key was provisioned or read/);
  assert.match(provenance, /unlisted tag URLs were unauthenticated\/public200/);
  assert.match(provenance, /repo privacy.*read-only flags do not make the site access-private/);
  assert.match(
    provenance,
    /remote\/default `main` \*\*3991bb84b9a3d60d1681e8d18e68b5e9cb44f511\*\* is an ancestor of14a4/,
  );
  assert.match(provenance, /No forced rewrite, main merge or default-branch switch was performed/);
  assert.match(provenance, /promotion\/default change is not authorized/);
  const handoff = await readFile('docs/PANEL_OPERATOR_HANDOFF.md', 'utf8');
  assert.match(handoff, /compaction is \*\*NOT STARTED\*\*/);
  assert.match(handoff, /private COMPLETE backup first/);
  assert.match(handoff, /version\/CAS preconditions/);
  assert.match(handoff, /Restoring an old backup must never resurrect forgotten content/);
  assert.match(provenance, /real 180-second app window/);
  assert.match(provenance, /without refunding quotas; saved downloads cannot be recalled/);
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

test('authorized session registry separates merged report-only history, five actual authors and pending application integration', async () => {
  const registry = await readFile('docs/CODEX_SESSIONS.md', 'utf8');
  const report = await readFile('docs/RUNTIME_RELEASE_QA.md', 'utf8');
  assert.ok(Buffer.byteLength(registry) <= 32768 && Buffer.byteLength(report) <= 65536);
  const ids = [
    ...new Set(registry.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g)),
  ].sort();
  assert.deepEqual(ids, [
    '01a1705c-a87d-7143-80f6-021e47b78ced',
    '01a18f00-8033-7d81-befa-9b82d727a3a6',
    '01a19023-5596-7dd2-825a-5c0e25286d42',
    '01a19023-b32e-75f2-9c0b-94bc30233f1e',
    '01a19046-f9c9-7112-a4d3-ae2f073e90c6',
  ]);
  for (const id of ids) assert.equal(registry.split(id).length - 1, 1, id);
  for (const value of [
    '1565854078880190495',
    '2026-10-30T22:25:04Z',
    'feature/raid-relic-runtime-qa-1030',
    '95609788c054dfce6b2a968555a79f5ded8ff9c0',
    'UNFORMATTED docs298 / app296',
    '46/46',
    '147 checks',
    '317 source hashes',
    'through source303',
    'LOCAL UNCOMMITTED',
    'integration pending',
    'full-history merged into published 14a4',
    'Original-session selected evidence covers only the original lead',
    'Worker CLI/session transcripts remain private, separate and unpublished',
  ])
    assert.ok(registry.includes(value), value);
  assert.match(registry, /not any of the four separately registered workers/);
  assert.match(registry, /original application\/test\/art author.*through source298/);
  assert.match(registry, /not claimed as sole-lead authorship/);
  const workerRows = registry.split('\n').filter((line) => /^\| `01a190/.test(line));
  assert.equal(workerRows.length, 3);
  for (const [index, branch, role] of [
    [0, 'feature/raid-relic-audit-presentation-1031', 'Presentation fonts/tokens'],
    [1, 'feature/raid-relic-audit-control-1031', 'Control wizard/readiness/observation copy'],
    [2, 'feature/raid-relic-replies-1031', 'Shared reply copy, six-slot hop notice reservations'],
  ]) {
    assert.ok(workerRows[index].includes(ids[index + 2]));
    assert.ok(workerRows[index].includes(branch));
    assert.ok(workerRows[index].includes(role));
    assert.match(
      workerRows[index],
      /LOCAL UNCOMMITTED contribution; worker stopped; composite whole-tree QA result unknown/,
    );
  }
  assert.match(registry, /No new worker commit, merge, deployment or passing cohort is inferred/);
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
