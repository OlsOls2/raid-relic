import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  strictJSON,
  forgeDescription,
  templateDesign,
  validDesign,
  forgeSVG,
  createForge,
  forgeMutation,
} from '../src/forge.js';
import { createApp } from '../src/app.js';
import { createJourneyFixture } from '../test-support/journey-fixture.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
const enabled = {
  CHRONICLE_ENABLED: 'true',
  CHRONICLE_ALLOW_PAID: 'true',
  OPENAI_API_KEY: 'synthetic-forge-test-key',
};
const response = (design) => ({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(design) }] }],
});
const post = (app, body) =>
  app.dispatch({
    method: 'POST',
    path: '/api/forge',
    headers: { 'content-type': 'application/json' },
    rawBody: Buffer.from(JSON.stringify(body)),
  });
async function received(f) {
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.chat(HOME, '811', '!mark moon');
  await f.chat(HOME, HOME, '!relic approve m1');
  await f.raid();
  await f.chat(HOME, HOME, '!offer');
  await f.chat(OTHER, OTHER, '!accept');
}
async function owner(f, id, body = {}, headers = {}) {
  const status = await f.request(`/control/${id}/status`, 'GET', { cookie: f.cookies[id] });
  const csrf = status.status === 200 ? JSON.parse(status.body).csrf : 'expired';
  return f.request(
    `/control/${id}/forge`,
    'POST',
    {
      cookie: f.cookies[id],
      origin: 'https://pilot.example',
      'content-type': 'application/json',
      ...headers,
    },
    Buffer.from(
      JSON.stringify({ csrf, description: 'violet crystal', acknowledge: true, ...body }),
    ),
  );
}
test('Forge template NFKC/casefold deterministic keywords/fallback produce only versioned schema and bounded own SVG', async () => {
  const a = templateDesign('ＴＡＬＬ ＶＩＯＬＥＴ crystal with 8 facets');
  assert.deepEqual(a, templateDesign('tall violet CRYSTAL with 8 facets'));
  assert.equal(a.facets, 8);
  assert.equal(a.aspect, 1.4);
  assert.equal(templateDesign('warm amber orb').shape, 'orb');
  assert.equal(templateDesign('broad seed').shape, 'seed');
  assert.equal(templateDesign('unknown idea').shape, 'crystal');
  assert.equal(forgeDescription('Straße'), 'strasse');
  assert.ok(validDesign(a));
  assert.ok(forgeSVG(a).length < 12000);
  for (const value of [
    { ...a, path: '<svg>' },
    { ...a, facets: NaN },
    { ...a, facets: 2 },
    { ...a, facets: 13 },
    { ...a, aspect: Infinity },
    { ...a, aspect: '1' },
    { ...a, aspect: 0.59 },
    { ...a, version: 2 },
    { ...a, shape: 'arbitrary' },
    { ...a, palette: ['url(x)', ...a.palette.slice(1)] },
    { ...a, palette: ['#fff', ...a.palette.slice(1)] },
  ]) {
    assert.ok(!validDesign(value));
    assert.throws(() => forgeSVG(value));
  }
  const svg = forgeSVG(a);
  for (const word of ['<script', 'href=', 'foreignObject', 'violet', '<style'])
    assert.ok(!svg.includes(word));
});
test('Forge strict JSON rejects duplicate/escaped keys, invalidUTF8, prototype keys, NaN and oversized descriptions/requests', async () => {
  for (const raw of [
    '{"description":"a","description":"b"}',
    '{"description":"a","\\u0064escription":"b"}',
    '{"__proto__":{}}',
    '{"constructor":{}}',
    '{"palette":[{"prototype":1}]}',
    '{"aspect":NaN}',
    '{"aspect":Infinity}',
    '{"a":1,}',
    '{',
    ' '.repeat(1025),
  ])
    assert.throws(() => strictJSON(Buffer.from(raw)));
  assert.throws(() => strictJSON(Buffer.from([255])));
  const app = createApp({
    state: new Proxy(
      {},
      {
        get() {
          assert.fail('Template must not read/write DB');
        },
      },
    ),
  });
  for (const body of [
    {},
    { description: '' },
    { description: 'x'.repeat(241) },
    { description: '<svg>' },
    { description: '＜svg＞' },
    { description: 'https://x' },
    { description: 'crystal', model: true },
    { description: 'crystal', acknowledge: true },
    { description: 42 },
    { description: 'a\nline' },
  ])
    assert.equal((await post(app, body)).status, 400);
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error('Network forbidden');
  };
  try {
    const result = await post(app, { description: 'round amber' });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).source, 'template');
  } finally {
    globalThis.fetch = original;
  }
});
test('Forge read-only public route rejects GET/query/extra fields and budgets before work; template never claims/applies', async () => {
  const app = createApp({
    state: {
      forgeStep() {
        assert.fail('Public template must not claim');
      },
    },
    publicBudget: { burst: 1, perSecond: 0 },
  });
  const result = await post(app, { description: 'crystal' });
  assert.equal(result.status, 200);
  const data = JSON.parse(result.body);
  assert.equal(data.applied, false);
  assert.equal(data.mode, 'live');
  assert.equal(data.source, 'template');
  assert.equal((await post(app, { description: 'orb' })).status, 429);
  const other = createApp();
  for (const path of ['/api/forge?description=x', '/api/forge/', '/api/forge?model=1'])
    assert.equal((await other.dispatch({ method: 'POST', path })).status, 400);
  assert.equal((await other.dispatch({ method: 'GET', path: '/api/forge' })).status, 405);
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: private owner Forge needs exact scoped auth/CSRF/Origin; one moderated attempt and strict output only`, async () => {
    const calls = [];
    const design = templateDesign('warm seed');
    const f = await pilotFixture(kind, {
      chronicleEnv: enabled,
      forgeHTTP: async (path, body) => {
        calls.push({ path, body });
        return path === 'responses' ? response(design) : { results: [{ flagged: false }] };
      },
    });
    await received(f);
    assert.equal(calls.length, 0);
    for (const headers of [
      { cookie: undefined },
      { cookie: f.cookies[HOME] },
      { origin: undefined },
      { origin: 'https://evil.example' },
      { cookie: `${f.cookies[OTHER]}; ${f.cookies[OTHER]}` },
    ])
      assert.equal((await owner(f, OTHER, {}, headers)).status, 403);
    assert.equal((await owner(f, OTHER, { csrf: 'wrong' })).status, 403);
    assert.equal((await owner(f, OTHER, { actorId: HOME })).status, 403);
    assert.equal(calls.length, 0);
    await owner(f, HOME);
    assert.equal(calls.length, 0); // Wrong recipient has no completed received stop.
    const both = await Promise.all([owner(f, OTHER), owner(f, OTHER)]);
    assert.ok(both.every((r) => r.status === 200));
    assert.deepEqual(
      calls.map((c) => c.path),
      ['moderations', 'responses', 'moderations'],
    );
    const model = calls[1].body;
    assert.equal(model.model, 'gpt-4.1-mini');
    assert.equal(model.text.format.strict, true);
    assert.equal(model.text.format.schema.additionalProperties, false);
    assert.equal(model.input, 'violet crystal');
    assert.equal(model.store, false);
    assert.ok(!JSON.stringify(calls).includes('moon'));
    assert.ok(!JSON.stringify(calls).includes(HOME));
    assert.ok(both.some((r) => JSON.parse(r.body).source === 'model'));
    await owner(f, OTHER);
    assert.equal(calls.length, 3);
    await f.request('/forge');
    await post(f.runtime, { description: 'crystal' });
    await f.request('/api/atlas');
    assert.equal(calls.length, 3);
    f.advance(43200001);
    assert.equal((await owner(f, OTHER)).status, 403);
    assert.equal(calls.length, 3);
  });
  test(`${kind}: off/no-key/no acknowledgement and missing stop use pure template without claims or network`, async () => {
    for (const env of [
      {},
      { CHRONICLE_ENABLED: 'true' },
      { ...enabled, CHRONICLE_ALLOW_PAID: 'false' },
      { CHRONICLE_ENABLED: 'true', CHRONICLE_ALLOW_PAID: 'true' },
    ]) {
      const f = await pilotFixture(kind, {
        chronicleEnv: env,
        forgeHTTP: () => {
          assert.fail('Off cannot call network');
        },
      });
      await f.login(OTHER);
      const result = await owner(f, OTHER);
      assert.equal(result.status, 200);
      assert.equal(JSON.parse(result.body).source, 'template');
    }
    const state = {
      forgeStep() {
        assert.fail('No acknowledgement cannot claim');
      },
    };
    const service = createForge({
      state,
      enabled: true,
      allowPaid: true,
      key: 'synthetic',
      claimId: randomUUID,
      transport() {
        assert.fail('No acknowledgement cannot call');
      },
    });
    assert.equal((await service.write(OTHER, 'crystal', false)).source, 'template');
    const f = await pilotFixture(kind, {
      chronicleEnv: enabled,
      forgeHTTP() {
        assert.fail('Missing stop cannot call');
      },
    });
    await f.login(OTHER);
    assert.equal(JSON.parse((await owner(f, OTHER)).body).source, 'template');
  });
  test(`${kind}: fresh Forge finish never resurrects concurrent forgotten archive content; crash marker survives service restart`, async (t) => {
    const f = await createJourneyFixture({
      firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined,
    });
    t.after(() => f.close());
    let release, entered;
    const started = new Promise((r) => {
        entered = r;
      }),
      blocked = new Promise((r) => {
        release = r;
      });
    const service = createForge({
      state: f.state,
      enabled: true,
      allowPaid: true,
      key: 'synthetic',
      claimId: randomUUID,
      transport: async (path) => {
        if (path === 'responses') {
          entered();
          await blocked;
          return response(templateDesign('orb'));
        }
        return { results: [{ flagged: false }] };
      },
    });
    const pending = service.write(f.target, 'orb', true);
    await started;
    await f.state.controlMarks(
      f.source,
      { broadcasterId: f.source, chatterId: '9000' },
      { type: 'forgetme' },
      Date.now(),
    );
    release();
    assert.equal((await pending).source, 'model');
    assert.ok(!(await f.state.getPublicJourney()).stops[0].marks.some((m) => m.text === 'moon'));
    const fresh = await createJourneyFixture({
      firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined,
    });
    t.after(() => fresh.close());
    await fresh.state.forgeStep({ keeperId: fresh.target, claimId: 'crashed' });
    const restart = createForge({
      state: fresh.state,
      enabled: true,
      allowPaid: true,
      key: 'synthetic',
      claimId: randomUUID,
      transport() {
        assert.fail('Crash cannot retry');
      },
    });
    assert.equal((await restart.write(fresh.target, 'orb', true)).source, 'template');
  });
}
test('Forge moderation flags, malformed output,429/timeouts and unavailable moderation safely consume attempt without retries', async (t) => {
  for (const failure of [
    'inputFlag',
    'inputError',
    'inputMalformed',
    'inputTimeout',
    'outputFlag',
    'outputError',
    'outputMalformed',
    'outputTimeout',
    'malformed',
    'oversized',
    'extra',
    'duplicate',
    '429',
    'timeout',
  ]) {
    const f = await createJourneyFixture();
    t.after(() => f.close());
    let calls = 0,
      paid = 0;
    const service = createForge({
      state: f.state,
      enabled: true,
      allowPaid: true,
      key: 'synthetic',
      claimId: randomUUID,
      timeoutMs: 5,
      transport: async (path) => {
        calls++;
        if (path === 'responses') {
          paid++;
          if (failure === 'oversized') return { huge: 'x'.repeat(17000) };
          if (failure === '429') throw Error('PRIVATE authorization 429');
          if (failure === 'timeout') return new Promise(() => {});
          if (failure === 'malformed') return {};
          if (failure === 'extra') return response({ ...templateDesign('orb'), url: 'https://x' });
          if (failure === 'duplicate')
            return {
              status: 'completed',
              output: [
                {
                  type: 'message',
                  content: [{ type: 'output_text', text: '{"version":1,"version":1}' }],
                },
              ],
            };
          return response(templateDesign('orb'));
        }
        if (
          (failure === 'inputMalformed' && calls === 1) ||
          (failure === 'outputMalformed' && calls > 1)
        )
          return {};
        if (
          (failure === 'inputTimeout' && calls === 1) ||
          (failure === 'outputTimeout' && calls > 1)
        )
          return new Promise(() => {});
        if ((failure === 'inputError' && calls === 1) || (failure === 'outputError' && calls > 1))
          throw Error('PRIVATE upstream');
        return {
          results: [
            {
              flagged:
                (failure === 'inputFlag' && calls === 1) || (failure === 'outputFlag' && calls > 1),
            },
          ],
        };
      },
    });
    const value = await service.write(f.target, 'crystal', true);
    assert.equal(value.source, 'template');
    const count = calls;
    await service.write(f.target, 'seed', true);
    assert.equal(calls, count);
    assert.ok(paid <= 1);
    if (failure.startsWith('input')) assert.equal(paid, 0);
    assert.ok(!JSON.stringify(value).includes('PRIVATE'));
  }
});
test('Forge lineage guard and failed Firestore commit cannot charge or overwrite archive', async (t) => {
  const previous = { stops: [{ stopId: 'id', to: OTHER, marks: [], extra: 'x'.repeat(524288) }] };
  assert.throws(() => forgeMutation(previous, { keeperId: OTHER, claimId: 'a' }));
  assert.ok(!previous.stops[0].forge);
  const db = fakeFirestore();
  const f = await createJourneyFixture({ firestoreClient: db });
  t.after(() => f.close());
  db.failCommit = true;
  const service = createForge({
    state: f.state,
    enabled: true,
    allowPaid: true,
    key: 'synthetic',
    claimId: randomUUID,
    transport() {
      assert.fail('Failed commit cannot call provider');
    },
  });
  await assert.rejects(service.write(f.target, 'crystal', true));
});
test('judges Forge always labels DOM/JSON/SVG with no inherited paid path; client source never injects HTML or stores description', async (t) => {
  const f = await createJudges({ intent: true, env: {} });
  t.after(() => f.close());
  const headers = { host: '127.0.0.1:5191' };
  const page = await f.dispatch({ method: 'GET', path: '/forge', headers });
  assert.match(page.body, /<title>SIMULATOR/);
  assert.match(page.body, /SIMULATOR · LOCAL MEMORY ONLY/);
  const result = await f.dispatch({
    method: 'POST',
    path: '/api/forge',
    headers: { ...headers, origin: JUDGES_ORIGIN, 'content-type': 'application/json' },
    rawBody: Buffer.from('{"description":"orb"}'),
  });
  const body = JSON.parse(result.body);
  assert.equal(body.mode, 'simulator');
  assert.ok(body.svg.includes('SIMULATOR'));
  assert.equal(body.source, 'template');
  for (const file of ['public/forge.js', 'public/forge-owner.js']) {
    const source = await readFile(file, 'utf8');
    assert.doesNotThrow(() => new Function(source));
    assert.ok(!/innerHTML|localStorage|sessionStorage|console\./.test(source));
    assert.ok(source.includes('textContent'));
    assert.ok(source.includes('URL.revokeObjectURL'));
  }
});
test('Forge failed completion leaves consumed marker; exact two-field legacy controls cannot accept Forge payloads', async (t) => {
  const db = fakeFirestore();
  const f = await createJourneyFixture({ firestoreClient: db });
  t.after(() => f.close());
  let calls = 0;
  const service = createForge({
    state: f.state,
    enabled: true,
    allowPaid: true,
    key: 'synthetic',
    claimId: randomUUID,
    transport: async (path) => {
      calls++;
      if (path === 'responses') return response(templateDesign('orb'));
      if (calls === 3) db.failCommit = true;
      return { results: [{ flagged: false }] };
    },
  });
  await assert.rejects(service.write(f.target, 'orb', true));
  db.failCommit = false;
  assert.equal((await service.write(f.target, 'seed', true)).source, 'template');
  assert.equal(calls, 3);
  const pilot = await pilotFixture();
  await pilot.login(HOME);
  const status = JSON.parse(
    (await pilot.request(`/control/${HOME}/status`, 'GET', { cookie: pilot.cookies[HOME] })).body,
  );
  assert.equal(
    (
      await pilot.request(
        `/control/${HOME}`,
        'POST',
        {
          cookie: pilot.cookies[HOME],
          origin: 'https://pilot.example',
          'content-type': 'application/json',
        },
        Buffer.from(JSON.stringify({ action: 'chronicle', csrf: status.csrf, description: 'orb' })),
      )
    ).status,
    403,
  );
  assert.equal((await owner(pilot, HOME, { acknowledge: false })).status, 200);
});
