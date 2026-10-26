import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runeSvg, runeGeometry, normalizeMark } from '../src/marks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { recapProjection, recapSVG } from '../src/recap.js';
import { createJourneyFixture } from '../test-support/journey-fixture.js';
import { createJudges } from '../test-support/judges.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
import { createApp } from '../src/app.js';
const archive = (count = 16) => ({
  stops: Array.from({ length: count }, (_, i) => ({
    stopId: (i + 1).toString(16).padStart(64, '0'),
    from: '1591805230',
    to: '1591806023',
    ringIndex: i + 1,
    claimedAt: 1,
    marks: Array.from({ length: 160 }, (_, n) => ({
      id: `m${n + 1}`,
      userId: 'PRIVATE_USER_CANARY',
      text: 'moon',
    })),
  })),
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: recap empty and completed counts come from one bounded archive, approved retained entries only`, async (t) => {
    const db = kind === 'firestore' ? fakeFirestore() : undefined;
    const f = await createJourneyFixture({ firestoreClient: db });
    t.after(() => f.close());
    await f.chat(f.source, '9999', { type: 'mark', text: 'pending' });
    if (db) db.reads.length = 0;
    const result = await f.app.dispatch({ method: 'GET', path: '/api/recap' });
    assert.equal(result.status, 200);
    if (db) assert.equal(db.reads.length, 1);
    const data = JSON.parse(result.body);
    assert.equal(data.mode, 'simulator');
    assert.equal(data.rings, 1);
    assert.equal(data.completedStops, 1);
    assert.equal(data.retainedMarkEntries, 4);
    assert.equal(data.shownRunes, 4);
    assert.deepEqual(
      Object.keys(data.route[0]).sort(),
      ['stopId', 'from', 'to', 'claimedAt', 'ringIndex', 'retainedEntries'].sort(),
    );
    for (const forbidden of [
      'userId',
      'PRIVATE_USER',
      'pending',
      'csrf',
      'refresh_token',
      'eventId',
      'streamId',
    ])
      assert.ok(!JSON.stringify(data).includes(forbidden));
    assert.ok(data.svg.includes('SIMULATOR'));
    assert.ok(!data.svg.includes('moon'));
    const empty = await createJourneyFixture({
      seed: false,
      firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined,
    });
    t.after(() => empty.close());
    const zero = await empty.state.getRecap();
    assert.equal(zero.rings, 0);
    assert.equal(zero.retainedMarkEntries, 0);
    assert.match(recapSVG(zero), /No completed hops yet/);
  });
  test(`${kind}: fresh recap and SVG immediately reflect forget/block/veto/opt-out and never resurrect content`, async (t) => {
    for (const action of ['forgetme', 'block', 'veto-last', 'opt-out']) {
      const f = await createJourneyFixture({
        firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined,
      });
      t.after(() => f.close());
      const before = JSON.parse((await f.app.dispatch({ method: 'GET', path: '/api/recap' })).body);
      await f.state.controlMarks(
        f.source,
        { broadcasterId: f.source, chatterId: action === 'forgetme' ? '9000' : f.source },
        { type: action, userId: '9000' },
        Date.now(),
      );
      const after = JSON.parse((await f.app.dispatch({ method: 'GET', path: '/api/recap' })).body);
      assert.equal(after.rings, 1);
      assert.ok(after.retainedMarkEntries < before.retainedMarkEntries);
      assert.notEqual(after.svg, before.svg);
      await f.chat(f.source, f.source, {
        type: 'approve',
        markId: action === 'veto-last' ? 'm4' : 'm1',
      });
      assert.equal((await f.state.getRecap()).retainedMarkEntries, after.retainedMarkEntries);
    }
  });
}
test('recap shows all16 stops and2560 entries; rune subset explicitly labelled, hard caps reject instead of truncating', () => {
  const full = recapProjection(archive());
  assert.equal(full.route.length, 16);
  assert.equal(full.rings, 16);
  assert.equal(full.retainedMarkEntries, 2560);
  assert.equal(full.runes.length, 24);
  const svg = recapSVG(full);
  assert.match(svg, /All 16 retained stops shown/);
  assert.match(svg, /24 of 2560/);
  assert.ok(Buffer.byteLength(svg) < 65536);
  assert.throws(() => recapProjection(archive(17)));
  const tooMany = archive(1);
  tooMany.stops[0].marks.push({ text: 'moon' });
  assert.throws(() => recapProjection(tooMany));
  const bytes = archive(1);
  bytes.extra = 'x'.repeat(524288);
  assert.throws(() => recapProjection(bytes));
});
test('server-generated SVG never contains user text, unsafe XML, URLs, supplied markup or identity associations', () => {
  const data = recapProjection(archive(1));
  const svg = recapSVG(data);
  assert.ok(runeSvg('moon').includes(data.runes[0].points.map((p) => p.join(',')).join(' ')));
  assert.ok(runeSvg('moon').includes(data.runes[0].color));
  for (const unsafe of [
    '<script',
    'foreignObject',
    'href=',
    'onload=',
    '<image',
    'PRIVATE_USER_CANARY',
    'moon',
    'https://',
  ])
    assert.ok(!svg.includes(unsafe));
  for (const text of ['<script>alert(1)</script>', 'https://example.com', 'moon\u0000']) {
    const a = archive(1);
    a.stops[0].marks[0].text = text;
    assert.throws(() => recapProjection(a));
  }
  assert.throws(() =>
    recapSVG({ ...data, route: [{ ...data.route[0], from: '"><script>bad</script>' }] }),
  );
  assert.throws(() => recapSVG({ ...data, runes: [{ color: '"><script>', points: [] }] }));
  assert.throws(() =>
    recapSVG({ ...data, runes: [{ color: '#e6bb70', points: Array(8).fill(['<img>', 2]) }] }),
  );
});
test('recap strict read-only paths/body/query and public budget reject before archive reads; failures generic', async () => {
  let reads = 0;
  const state = {
    getRecap() {
      reads++;
      return recapProjection();
    },
  };
  const app = createApp({ state });
  for (const path of ['/api/recap?q=x', '/api/recap.svg?x=1', '/api/recap/', '/recap?x=1'])
    assert.equal((await app.dispatch({ method: 'GET', path })).status, 400);
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'])
    for (const path of ['/recap', '/api/recap', '/api/recap.svg'])
      assert.equal((await app.dispatch({ method, path })).status, 405);
  assert.equal(
    (await app.dispatch({ method: 'GET', path: '/api/recap', rawBody: Buffer.from('{}') })).status,
    400,
  );
  assert.equal(reads, 0);
  const limited = createApp({ state, publicBudget: { burst: 1, perSecond: 0 } });
  assert.equal((await limited.dispatch({ method: 'GET', path: '/api/recap' })).status, 200);
  assert.equal((await limited.dispatch({ method: 'GET', path: '/api/recap.svg' })).status, 429);
  assert.equal(reads, 1);
  const broken = createApp({
    state: {
      getRecap() {
        throw Error('PRIVATE_DATA');
      },
    },
  });
  assert.equal((await broken.dispatch({ method: 'GET', path: '/api/recap' })).status, 503);
});
test('HTTP recap API/SVG no-store, attachment/CSP and default live empty are truthful', async () => {
  const app = createApp();
  for (const path of ['/api/recap', '/api/recap.svg']) {
    const req = Readable.from([]);
    req.method = 'GET';
    req.url = path;
    req.headers = {};
    let code, headers, body;
    await app.handler(req, {
      writeHead(c, h) {
        code = c;
        headers = h;
      },
      end(b) {
        body = b;
      },
    });
    assert.equal(code, 200);
    assert.equal(headers['cache-control'], 'no-store');
    if (path.endsWith('.svg')) {
      assert.match(headers['content-disposition'], /attachment/);
      assert.match(headers['content-security-policy'], /sandbox/);
      assert.ok(!body.includes('SIMULATOR'));
    } else {
      assert.equal(JSON.parse(body).mode, 'live');
      assert.equal(JSON.parse(body).rings, 0);
    }
  }
});
test('judges recap always labelled in first DOM, JSON and exported SVG; real app has no simulator query activation', async (t) => {
  const f = await createJudges({ intent: true, env: {} });
  t.after(() => f.close());
  const req = (path) => f.dispatch({ method: 'GET', path, headers: { host: '127.0.0.1:5191' } });
  const page = await req('/recap');
  assert.equal(page.status, 200);
  assert.match(page.body, /<title>SIMULATOR/);
  assert.match(page.body, /SIMULATOR · LOCAL MEMORY ONLY/);
  assert.equal(JSON.parse((await req('/api/recap')).body).mode, 'simulator');
  assert.match((await req('/api/recap.svg')).body, /SIMULATOR SNAPSHOT/);
  assert.equal(
    (await createApp().dispatch({ method: 'GET', path: '/recap?simulator=1' })).status,
    400,
  );
});
test('client uses fresh fetch for each download, textContent/relative links, blob cleanup and bounded offscreen PNG; Atlas links recap', async () => {
  const source = await readFile('public/recap.js', 'utf8');
  const parsed = spawnSync(process.execPath, ['--check', '--input-type=module'], {
    input: source,
    timeout: 2000,
    maxBuffer: 65536,
    encoding: 'utf8',
  });
  assert.ok(parsed.error == null, 'ESM parser must finish without a process error');
  assert.equal(parsed.signal, null);
  assert.equal(parsed.status, 0, 'Public recap must parse as ESM without executing it');
  assert.ok(source.includes("cache: 'no-store'"));
  assert.ok(source.includes('const data = await read()'));
  assert.ok(source.includes('new OffscreenCanvas(1200, 630)'));
  assert.ok(source.includes('URL.revokeObjectURL'));
  assert.ok(source.includes('textContent'));
  assert.ok(!source.includes('innerHTML'));
  assert.ok((await readFile('public/atlas.html', 'utf8')).includes('href="/recap"'));
});
for (const kind of ['memory', 'firestore'])
  test(`${kind}: sixteen actual completed kernel hops retain all route and entry counts`, async (t) => {
    const db = kind === 'firestore' ? fakeFirestore() : undefined;
    const f = await createJourneyFixture({ seed: false, firestoreClient: db });
    t.after(() => f.close());
    const base = Date.now() - 1000;
    for (const [host, streamId] of [
      [f.source, '9001'],
      [f.target, '9002'],
    ]) {
      await f.event(
        { lifecycle: { host, type: 'online', streamId, startedAt: base, sentAt: base } },
        base,
      );
      await f.chat(host, host, { type: 'keep' }, base);
    }
    for (let i = 0; i < 16; i++) {
      const source = i % 2 ? f.target : f.source,
        target = i % 2 ? f.source : f.target,
        time = base + i + 1;
      await f.chat(source, String(9100 + i), { type: 'mark', text: 'moon' }, time);
      await f.chat(source, source, { type: 'approve', markId: `m${Math.floor(i / 2) + 1}` }, time);
      await f.event(
        { raid: { from_broadcaster_user_id: source, to_broadcaster_user_id: target, viewers: 1 } },
        time,
      );
      await f.chat(source, source, { type: 'offer' }, time);
      await f.chat(target, target, { type: 'accept' }, time);
    }
    if (db) db.reads.length = 0;
    const data = await f.state.getRecap();
    if (db) assert.equal(db.reads.length, 1);
    assert.equal(data.rings, 16);
    assert.equal(data.route.length, 16);
    assert.equal(data.retainedMarkEntries, 72);
    assert.equal(data.shownRunes, 24);
    assert.equal(
      data.route.reduce((sum, stop) => sum + stop.retainedEntries, 0),
      72,
    );
  });

test('canonical rune byte goldens survive shared geometry extraction; normalized words/emoji retain recap identity', () => {
  // Captured from canonical runeSvg before extracting the shared helper.
  const goldens = [
    ['moon', '276dd622a4efee80e2394ba662f1c4fc3e989dfa5f5be80221d6daa3220fd1c0'],
    ['amber', 'dde2cd9439b7d60a9c38dfd56c3d1be03a0551a73bcae70eabc4f9df9406e002'],
    ['星', '506d1270c154b16370a125348786aa6e3aa97df8295c2cc22cdc5e0bc15d0c5c'],
    ['💎', '7c2bede255ebd47f94e59cc1c2add58ec410b2736c57028583064add2482e36f'],
    ['👩‍🚀', 'ad2d209e7aaf3197fd2c4830d6fdf61f3c22fd3921a86ec7e2078c242cf4cec2'],
    ['ＳＴＡＲ', '783a0fd7aa4b41ecf8bf5a88838b7d96c0df9abb02c675a8a51de58e778a610c'],
    ['Straße', 'ffff6c23bb1870cb14703fe4a4b8a11458a43ea1a60731190cd526335437e386'],
    ['🇬🇧', '1e9ce5812129977375a673f3fb5e41e6ff880b12c01ad1d93aba80829e7a94ee'],
  ];
  const colors = new Set();
  for (const [word, digest] of goldens) {
    const canonical = runeSvg(word);
    assert.equal(createHash('sha256').update(canonical).digest('hex'), digest);
    const geometry = runeGeometry(word);
    colors.add(geometry.color);
    const a = archive(1);
    a.stops[0].marks = [{ text: normalizeMark(word), userId: 'PRIVATE_CANARY' }];
    const view = recapProjection(a);
    assert.deepEqual(view.runes[0], geometry);
    const points = geometry.points.map((p) => p.join(',')).join(' ');
    for (const svg of [canonical, recapSVG(view)]) {
      assert.ok(svg.includes(`points="${points}"`));
      assert.ok(svg.includes(`stroke="${geometry.color}"`));
    }
    assert.deepEqual(Object.keys(geometry).sort(), ['color', 'points']);
    assert.ok(!JSON.stringify(view).includes('PRIVATE_CANARY'));
  }
  assert.deepEqual([...colors].sort(), ['#e6bb70', '#9e87ed', '#70c9bd', '#dd93b3'].sort());
  assert.throws(() => runeGeometry('<script>'));
  assert.throws(() => runeGeometry('https://evil.example'));
  assert.match(recapSVG(recapProjection()), /RAID RELIC · JOURNEY SNAPSHOT/);
  assert.ok(!recapSVG(recapProjection()).includes('A COMPLETED JOURNEY'));
});
