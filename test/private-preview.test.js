import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { pilotFixture, HOME } from '../test-support/pilot-fixture.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
import { createPrivatePreview, privatePreviewConfig } from '../src/server.js';
const KEY = Buffer.alloc(32, 7).toString('base64url'); // Synthetic only; never an operator credential.
const NOW = Date.parse('2026-10-31T04:00:00.000Z');
const ENV = {
  P5_PREVIEW_PRIVATE_ENABLED: 'true',
  P5_PREVIEW_READ_ONLY: 'true',
  P5_PREVIEW_ACCESS_SHA256: createHash('sha256').update(KEY).digest('hex'),
  P5_PREVIEW_ACCESS_EXPIRES_AT: new Date(NOW + 3600000).toISOString(),
};
function request(url = '/', { method = 'GET', headers = {}, rawHeaders, body = '' } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.url = url;
  req.method = method;
  req.headers = Object.fromEntries(
    Object.entries({ host: 'preview.example', ...headers }).filter(
      ([, value]) => value !== undefined,
    ),
  );
  req.rawHeaders = rawHeaders ?? Object.entries(req.headers).flat();
  return req;
}
function response() {
  const res = {
    headersSent: false,
    destroyed: false,
    headers: {},
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
      return this;
    },
    end(body) {
      this.body = body === undefined ? '' : body.toString();
    },
  };
  return res;
}
async function invoke(
  gate,
  url,
  options = {},
  app = (_req, res) => {
    res.writeHead(200, {
      'content-security-policy': "default-src 'none'",
      'cache-control': 'public, max-age=3600',
    });
    res.end('synthetic application');
  },
) {
  const req = request(url, options),
    res = response();
  let calls = 0;
  await gate.wrapHandler((r, s) => {
    calls++;
    return app(r, s);
  })(req, res);
  return { req, res, calls };
}
function gate(options = {}) {
  return createPrivatePreview(ENV, { now: () => NOW, ...options });
}
test('disabled gate is an exact identity wrapper; private configuration requires explicit action policy independently of admission', () => {
  const handler = () => {},
    server = {};
  for (const env of [{}, { P5_PREVIEW_PRIVATE_ENABLED: 'false' }]) {
    const g = createPrivatePreview(env);
    assert.equal(g.enabled, false);
    assert.equal(g.wrapHandler(handler), handler);
    assert.equal(g.upgradeServer(server), server);
  }
  for (const readOnly of ['true', 'false']) {
    assert.equal(
      privatePreviewConfig({ ...ENV, P5_PREVIEW_READ_ONLY: readOnly }, NOW).enabled,
      true,
    );
    for (const change of [
      { P5_PREVIEW_PRIVATE_ENABLED: '' },
      { P5_PREVIEW_PRIVATE_ENABLED: 'TRUE' },
      { P5_PREVIEW_READ_ONLY: undefined },
      { P5_PREVIEW_READ_ONLY: '' },
      { P5_PREVIEW_READ_ONLY: 'TRUE' },
      { P5_PREVIEW_READ_ONLY: 'False' },
      { P5_PREVIEW_READ_ONLY: false },
      { P5_PREVIEW_READ_ONLY: true },
      { P5_PREVIEW_READ_ONLY: null },
      { P5_PREVIEW_READ_ONLY: '0' },
      { P5_PREVIEW_ACCESS_SHA256: '' },
      { P5_PREVIEW_ACCESS_SHA256: 'a'.repeat(63) },
      { P5_PREVIEW_ACCESS_SHA256: 'g'.repeat(64) },
      { P5_PREVIEW_ACCESS_EXPIRES_AT: undefined },
      { P5_PREVIEW_ACCESS_EXPIRES_AT: '2026-10-31T05:00:00+00:00' },
      { P5_PREVIEW_ACCESS_EXPIRES_AT: new Date(NOW).toISOString() },
      { P5_PREVIEW_ACCESS_EXPIRES_AT: new Date(NOW + 86400001).toISOString() },
      { P5_PREVIEW_ACCESS_EXPIRES_AT: '2026-02-30T05:00:00Z' },
    ])
      assert.throws(
        () => privatePreviewConfig({ ...ENV, P5_PREVIEW_READ_ONLY: readOnly, ...change }, NOW),
        /^Error: Invalid private preview configuration$/,
      );
  }
});

test('production-policy private admission gates HTTP and WS before dispatch; authorized delegation does not grant action permission', async () => {
  const g = createPrivatePreview({ ...ENV, P5_PREVIEW_READ_ONLY: 'false' }, { now: () => NOW });
  for (const path of [
    '/health',
    '/atlas.css',
    '/api/journey',
    '/eventsub',
    '/oauth/keeper/start',
    '/control/201',
  ]) {
    for (const method of ['GET', 'POST']) {
      const result = await invoke(g, path, { method });
      assert.equal(result.calls, 0);
      assert.equal(result.res.status, 401);
    }
  }
  const admitted = await invoke(g, '/health', { headers: { 'x-preview-access': KEY } });
  assert.equal(admitted.calls, 1);
  assert.equal(admitted.res.status, 200);
  assert.ok(!JSON.stringify(admitted.req.headers).includes(KEY));
  const app = (req, res) => {
    assert.equal(req.headers['x-preview-access'], undefined);
    assert.ok(!JSON.stringify(req.rawHeaders).includes(KEY));
    const authorized =
      req.headers.origin === 'https://preview.example' &&
      req.headers['x-fixture-csrf'] === 'synthetic-csrf';
    res.writeHead(authorized ? 202 : 403, { 'content-type': 'text/plain' });
    res.end(
      authorized ? 'Synthetic authorized action; no provider' : 'Application permission denied',
    );
  };
  const denied = await invoke(
    g,
    '/control/201',
    { method: 'POST', headers: { 'x-preview-access': KEY } },
    app,
  );
  assert.equal(denied.calls, 1);
  assert.equal(denied.res.status, 403, 'Preview admission alone grants no application authority');
  const delegated = await invoke(
    g,
    '/control/201',
    {
      method: 'POST',
      headers: {
        'x-preview-access': KEY,
        origin: 'https://preview.example',
        'x-fixture-csrf': 'synthetic-csrf',
      },
    },
    app,
  );
  assert.equal(delegated.calls, 1);
  assert.equal(delegated.res.status, 202);
  const server = new EventEmitter();
  let upgrades = 0;
  const facade = g.upgradeServer(server);
  const listener = (req) => {
    upgrades++;
    assert.ok(!JSON.stringify(req.headers).includes(KEY));
  };
  facade.on('upgrade', listener);
  const anonymous = socket();
  server.emit('upgrade', request('/ws/201'), anonymous, Buffer.alloc(0));
  assert.match(anonymous.output, /HTTP\/1\.1 401/);
  assert.equal(upgrades, 0);
  const authenticated = socket();
  server.emit(
    'upgrade',
    request('/ws/201', { headers: { 'x-preview-access': KEY } }),
    authenticated,
    Buffer.alloc(0),
  );
  assert.equal(upgrades, 1);
  authenticated.destroy();
  facade.off('upgrade', listener);
  assert.equal(server.listenerCount('upgrade'), 0);
});
test('root gate contains no app/pilot assets and unauthenticated aliases, assets, APIs, health, callbacks and mutations never dispatch', async () => {
  const g = gate(),
    root = await invoke(g, '/');
  assert.equal(root.res.status, 200);
  assert.equal(root.calls, 0);
  assert.match(root.res.body, /<main><h1>Private preview<\/h1>/);
  assert.match(root.res.body, /type="password"/);
  assert.doesNotMatch(
    root.res.body,
    /raidrelichq|olsols|159180|<script|<img|\/api\/|WebSocket|localStorage|https?:/,
  );
  assert.ok(!root.res.body.includes(KEY));
  assert.equal(root.res.headers['cache-control'], 'private, no-store');
  assert.equal(root.res.headers['referrer-policy'], 'same-origin');
  assert.match(
    root.res.headers['content-security-policy'],
    /default-src 'none'.*form-action 'self'.*frame-ancestors 'none'/,
  );
  for (const path of [
    '/health',
    '/atlas/',
    '/start',
    '/demo/judge',
    '/overlay/201',
    '/ws/201',
    '/api/journey',
    '/atlas.css',
    '/fonts/Cinzel.ttf',
    '/eventsub',
    '/auth/callback',
    '/oauth/callback',
    '/?key=' + KEY,
    '/_preview/access?key=' + KEY,
    '/%2f',
    '//health',
    '/a/../health',
    '/%',
    '/health#x',
  ]) {
    const r = await invoke(g, path);
    assert.ok([400, 401, 429].includes(r.res.status));
    assert.equal(r.calls, 0);
    assert.ok(!r.res.body.includes(KEY));
  }
  for (const method of ['HEAD', 'POST', 'PUT', 'OPTIONS', 'DELETE'])
    assert.equal((await invoke(g, '/', { method })).calls, 0);
});
test('exact canonical header/cookie admission strips preview credentials before the app and retains app security headers', async () => {
  for (const headers of [
    { 'x-preview-access': KEY },
    { cookie: `session=synthetic; __Host-raid-preview=${KEY}; other=value` },
  ]) {
    const result = await invoke(gate(), '/health', { headers }, (req, res) => {
      assert.equal(req.headers['x-preview-access'], undefined);
      assert.ok(!JSON.stringify(req.rawHeaders).includes(KEY));
      assert.ok(!JSON.stringify(req.headers).includes(KEY));
      if (headers.cookie) assert.equal(req.headers.cookie, 'session=synthetic; other=value');
      res.writeHead(200, {
        'content-security-policy': "default-src 'none'",
        'x-content-type-options': 'nosniff',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end('safe');
    });
    assert.equal(result.calls, 1);
    assert.equal(result.res.status, 200);
    assert.equal(result.res.headers['cache-control'], 'private, no-store');
    assert.equal(result.res.headers['Cache-Control'], undefined);
    assert.equal(result.res.headers['content-security-policy'], "default-src 'none'");
    assert.equal(result.res.headers['x-content-type-options'], 'nosniff');
    assert.equal(result.res.headers['referrer-policy'], 'no-referrer');
  }
});
test('forged, padded, duplicate, ambiguous, oversized, malformed or expired credentials never admit', async () => {
  const headers = [
    { 'x-preview-access': 'A'.repeat(43) },
    { 'x-preview-access': KEY + '=' },
    { 'x-preview-access': KEY, cookie: `__Host-raid-preview=${KEY}` },
    { cookie: `__Host-raid-preview=${KEY}; __Host-raid-preview=${KEY}` },
    { cookie: `__Host-raid-preview="${KEY}"` },
    { cookie: 'x='.padEnd(8193, 'a') },
    { 'x-preview-access': [KEY, KEY] },
  ];
  for (const h of headers) {
    const r = await invoke(gate(), '/health', { headers: h });
    assert.equal(r.calls, 0);
    assert.ok([400, 401].includes(r.res.status));
  }
  const duplicate = await invoke(gate(), '/health', {
    headers: { 'x-preview-access': KEY },
    rawHeaders: ['Host', 'preview.example', 'X-Preview-Access', KEY, 'x-preview-access', KEY],
  });
  assert.equal(duplicate.calls, 0);
  const duplicateCookie = await invoke(gate(), '/health', {
    headers: { cookie: `__Host-raid-preview=${KEY}` },
    rawHeaders: ['Cookie', `__Host-raid-preview=${KEY}`, 'Cookie', 'other=x'],
  });
  assert.equal(duplicateCookie.calls, 0);
  const giant = await invoke(gate(), '/health', { rawHeaders: ['X-Fill', 'a'.repeat(16385)] });
  assert.equal(giant.calls, 0);
  let time = NOW;
  const g = gate({ now: () => time });
  assert.equal((await invoke(g, '/health', { headers: { 'x-preview-access': KEY } })).calls, 1);
  time = NOW + 3600000;
  assert.equal((await invoke(g, '/health', { headers: { 'x-preview-access': KEY } })).calls, 0);
  time = NOW;
  assert.equal((await invoke(g, '/health', { headers: { 'x-preview-access': KEY } })).calls, 0);
});
const form = (body, headers = {}) => ({
  method: 'POST',
  body,
  headers: {
    origin: 'https://preview.example',
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/x-www-form-urlencoded',
    'content-length': String(Buffer.byteLength(body)),
    ...headers,
  },
});
test('bounded same-origin exact form sets Secure HttpOnly host cookie and fixed303 redirect, never key in URL/body', async () => {
  const r = await invoke(gate(), '/_preview/access', form('key=' + KEY));
  assert.equal(r.calls, 0);
  assert.equal(r.res.status, 303);
  assert.equal(r.res.headers.location, '/');
  assert.equal(
    r.res.headers['set-cookie'],
    `__Host-raid-preview=${KEY}; Secure; HttpOnly; Path=/; SameSite=Strict; Max-Age=3600`,
  );
  assert.ok(!r.res.body.includes(KEY));
  assert.ok(!r.res.headers.location.includes(KEY));
  const longEnv = { ...ENV, P5_PREVIEW_ACCESS_EXPIRES_AT: new Date(NOW + 86400000).toISOString() };
  const capped = await invoke(
    createPrivatePreview(longEnv, { now: () => NOW }),
    '/_preview/access',
    form('key=' + KEY),
  );
  assert.match(capped.res.headers['set-cookie'], /Max-Age=43200$/);
  let time = NOW;
  const g = gate({ now: () => time });
  time = NOW + 3599001;
  const tooLate = await invoke(g, '/_preview/access', form('key=' + KEY));
  assert.equal(tooLate.res.status, 401);
  assert.equal(tooLate.res.headers['set-cookie'], undefined);
});
test('invalid forms, foreign origin, duplicate fields, redirect injection, length/encoding violations are bounded and unreflected', async () => {
  for (const body of [
    'key=bad',
    'key=' + KEY + '&next=https://foreign.invalid',
    'key=' + KEY + '&key=' + KEY,
    'other=' + KEY,
    'key=' + encodeURIComponent(KEY + '='),
    'key=' + KEY + '\n',
  ]) {
    const r = await invoke(gate(), '/_preview/access', form(body));
    assert.equal(r.calls, 0);
    assert.equal(r.res.status, 401);
    assert.equal(r.res.headers['set-cookie'], undefined);
    assert.ok(!r.res.body.includes(KEY));
  }
  for (const h of [
    { origin: 'https://foreign.invalid' },
    { origin: 'null' },
    { origin: undefined },
    { 'sec-fetch-site': 'cross-site' },
    { 'content-length': '129' },
    { 'content-length': '0' },
    { 'transfer-encoding': 'chunked' },
    { 'content-type': 'application/json' },
  ])
    assert.equal((await invoke(gate(), '/_preview/access', form('key=' + KEY, h))).res.status, 401);
});
test('fixed global failure budget has no IP index, expires on existing clock window, valid operator header remains usable', async () => {
  let time = NOW;
  const g = gate({ now: () => time });
  for (let i = 0; i < 32; i++) assert.equal((await invoke(g, '/health')).res.status, 401);
  assert.equal((await invoke(g, '/health')).res.status, 429);
  assert.equal(
    (await invoke(g, '/health', { headers: { 'x-preview-access': KEY } })).res.status,
    200,
  );
  assert.equal((await invoke(g, '/_preview/access', form('key=' + KEY))).res.status, 429);
  time += 60000;
  assert.equal((await invoke(g, '/_preview/access', form('key=' + KEY))).res.status, 303);
});
function socket() {
  const s = new EventEmitter();
  s.output = '';
  s.end = function (text) {
    this.output = text;
    this.emit('close');
  };
  s.destroy = function () {
    this.closed = true;
    this.emit('close');
  };
  return s;
}
test('upgrade facade authorizes before any original upgrade/read callback; strips credentials and preserves close cleanup', () => {
  const server = new EventEmitter(),
    g = gate(),
    facade = g.upgradeServer(server);
  let reads = 0;
  const listener = (req) => {
    reads++;
    assert.ok(!JSON.stringify(req.headers).includes(KEY));
  };
  facade.on('upgrade', listener);
  for (const path of ['/ws/201', '/ws/201?key=' + KEY, '/%2fws/201']) {
    const s = socket();
    server.emit('upgrade', request(path), s, Buffer.alloc(0));
    assert.match(s.output, /HTTP\/1\.1 401/);
  }
  assert.equal(reads, 0);
  const s = socket();
  server.emit(
    'upgrade',
    request('/ws/201', { headers: { cookie: `__Host-raid-preview=${KEY}` } }),
    s,
    Buffer.alloc(0),
  );
  assert.equal(reads, 1);
  s.destroy();
  facade.off('upgrade', listener);
  assert.equal(server.listenerCount('upgrade'), 0);
});
test('accepted sockets are destroyed at absolute expiry; later upgrade cannot reach app', async () => {
  const start = Date.now(),
    server = new EventEmitter();
  const g = createPrivatePreview({
    ...ENV,
    P5_PREVIEW_ACCESS_EXPIRES_AT: new Date(start + 250).toISOString(),
  });
  let reads = 0;
  g.upgradeServer(server).on('upgrade', () => {
    reads++;
  });
  const s = socket(),
    closed = new Promise((resolve) => s.once('close', resolve));
  server.emit(
    'upgrade',
    request('/ws/201', { headers: { 'x-preview-access': KEY } }),
    s,
    Buffer.alloc(0),
  );
  let timeout;
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error('Synthetic expiry close deadline')), 2000);
      }),
    ]);
    assert.equal(s.closed, true);
  } finally {
    clearTimeout(timeout);
    s.destroy();
  }
  const later = socket();
  server.emit(
    'upgrade',
    request('/ws/201', { headers: { 'x-preview-access': KEY } }),
    later,
    Buffer.alloc(0),
  );
  assert.equal(reads, 1);
  assert.match(later.output, /401/);
});
test('server validates gate before runtime; HTTP and actual overlay adapter both receive gated entrypoints', async () => {
  const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(
    source.indexOf('const preview = createPrivatePreview(process.env)') <
      source.indexOf('await createRuntime(process.env)'),
  );
  assert.match(
    source,
    /if \(process\.argv\[1\] && import\.meta\.url === pathToFileURL\(resolve\(process\.argv\[1\]\)\)\.href\)/,
  );
  assert.match(source, /createServer\(preview\.wrapHandler\(runtime\.handler\)\)/);
  assert.match(source, /attachOverlaySockets\(\s*preview\.upgradeServer\(server\),/);
});
for (const kind of ['memory', 'firestore'])
  test(`${kind}: actual runtime HTTP handler is unreachable without preview admission, read-only and own-session guards remain after admission`, async () => {
    const f = await pilotFixture(kind, { chronicleEnv: { P5_PREVIEW_READ_ONLY: 'true' } });
    const g = gate(),
      before = await f.runtime.state.getKeeperRegistry();
    const dbBefore = f.db ? JSON.stringify([...f.db.docs]) : null;
    let appCalls = 0;
    const handler = g.wrapHandler((req, res) => {
      appCalls++;
      assert.ok(!JSON.stringify(req.headers).includes(KEY));
      return f.runtime.handler(req, res);
    });
    for (const path of [
      '/health',
      '/atlas.css',
      '/api/journey',
      '/eventsub',
      '/auth/callback',
      '/control/' + HOME + '/status',
    ]) {
      const req = request(path),
        res = response();
      await handler(req, res);
      assert.ok([401, 429].includes(res.status));
    }
    assert.equal(appCalls, 0);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await f.runtime.state.getKeeperRegistry(), before);
    if (f.db) assert.equal(JSON.stringify([...f.db.docs]), dbBefore);
    for (const path of ['/health', '/atlas.css']) {
      const res = response();
      await handler(request(path, { headers: { 'x-preview-access': KEY } }), res);
      assert.equal(res.status, 200);
      assert.ok(!res.body.includes(KEY));
      assert.ok(!res.body.includes(ENV.P5_PREVIEW_ACCESS_SHA256));
    }
    const own = response();
    await handler(
      request('/control/' + HOME + '/status', {
        headers: { cookie: `__Host-raid-preview=${KEY}` },
      }),
      own,
    );
    assert.equal(own.status, 403); // Existing master read-only guard remains stricter than session admission.
    const event = response();
    await handler(
      request('/eventsub', { method: 'POST', headers: { 'x-preview-access': KEY } }),
      event,
    );
    assert.equal(event.status, 403);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await f.runtime.state.getKeeperRegistry(), before);
  });
test('actual overlay adapter performs zero read-budget, projection or subscribe work before admission in both explicit action-policy modes', () => {
  for (const readOnly of ['true', 'false']) {
    const server = new EventEmitter();
    let reads = 0,
      subscriptions = 0,
      budgets = 0;
    const feed = {
      channel: '201',
      snapshot: async () => {
        reads++;
        return {};
      },
      subscribe: () => {
        subscriptions++;
        return () => {};
      },
    };
    const sockets = attachOverlaySockets(
      createPrivatePreview(
        { ...ENV, P5_PREVIEW_READ_ONLY: readOnly },
        { now: () => NOW },
      ).upgradeServer(server),
      feed,
      {
        origins: ['https://preview.example'],
        allowRead: () => {
          budgets++;
          return true;
        },
      },
    );
    try {
      for (const path of ['/ws/201', '/ws/201?key=' + KEY]) {
        const s = socket();
        server.emit(
          'upgrade',
          request(path, { headers: { origin: 'https://preview.example' } }),
          s,
          Buffer.alloc(0),
        );
        assert.match(s.output, /401/);
      }
      assert.equal(reads, 0);
      assert.equal(subscriptions, 0);
      assert.equal(budgets, 0);
      assert.equal(sockets.clients.size, 0);
    } finally {
      sockets.close();
    }
  }
});
test('bounded form timeout and four concurrent reads reject without dispatching or growing an address index', async () => {
  const g = gate({ bodyTimeoutMs: 100 }),
    held = [];
  const handler = g.wrapHandler(() => assert.fail('Preview form reached application'));
  for (let i = 0; i < 4; i++) {
    const req = new Readable({ read() {} });
    Object.assign(req, {
      url: '/_preview/access',
      method: 'POST',
      headers: {
        host: 'preview.example',
        origin: 'https://preview.example',
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '47',
      },
    });
    req.rawHeaders = Object.entries(req.headers).flat();
    const res = response();
    held.push({ req, res, done: handler(req, res) });
  }
  const fifth = await invoke(g, '/_preview/access', form('key=' + KEY));
  assert.equal(fifth.res.status, 429);
  for (const item of held) {
    item.req.push(Buffer.from('key=' + KEY));
    item.req.push(null);
  }
  await Promise.all(held.map((item) => item.done));
  for (const item of held) assert.equal(item.res.status, 303);
  const slow = new Readable({ read() {} });
  Object.assign(slow, {
    url: '/_preview/access',
    method: 'POST',
    headers: {
      host: 'preview.example',
      origin: 'https://preview.example',
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': '47',
    },
  });
  slow.rawHeaders = Object.entries(slow.headers).flat();
  const res = response();
  await handler(slow, res);
  assert.equal(res.status, 401);
  assert.equal(res.headers['set-cookie'], undefined);
  slow.destroy();
});

test('judge admission is default off, isolated, fixed-deadline and server read-only', async () => {
  const judgeEnv = {
    JUDGE_ADMISSION_ENABLED: 'true',
    P5_PREVIEW_READ_ONLY: 'true',
    JUDGE_ACCESS_SHA256: ENV.P5_PREVIEW_ACCESS_SHA256,
    JUDGE_ACCESS_EXPIRES_AT: '2026-11-16T00:00:00.000Z',
  };
  assert.equal(privatePreviewConfig(judgeEnv, NOW).judge, true);
  for (const change of [
    { P5_PREVIEW_READ_ONLY: 'false' },
    { P5_PREVIEW_READ_ONLY: undefined },
    { P5_PREVIEW_PRIVATE_ENABLED: 'true' },
    { P5_PREVIEW_PRIVATE_ENABLED: 'invalid' },
    { JUDGE_ACCESS_SHA256: undefined },
    { JUDGE_ACCESS_EXPIRES_AT: '2026-11-17T00:00:00.000Z' },
    { JUDGE_ADMISSION_ENABLED: 'TRUE' },
  ])
    assert.throws(() => privatePreviewConfig({ ...judgeEnv, ...change }, NOW));
  assert.throws(() => privatePreviewConfig(judgeEnv, Date.parse(judgeEnv.JUDGE_ACCESS_EXPIRES_AT)));
  const g = createPrivatePreview(judgeEnv, { now: () => NOW });
  for (const path of [
    '/oauth/keeper/start',
    '/auth/callback',
    '/control/1',
    '/eventsub',
    '/internal/wander/tick',
    '/api/forge',
    '/api/my-marks',
    '/%63ontrol/1',
  ]) {
    for (const method of ['GET', 'POST']) {
      const result = await invoke(g, path, { method, headers: { 'x-preview-access': KEY } });
      assert.equal(result.calls, 0);
      assert.ok([400, 403].includes(result.res.status));
    }
  }
  for (const path of [
    '/',
    '/health',
    '/atlas/',
    '/keeper/olsols3',
    '/demo/judge',
    '/overlay/1593561134',
    '/api/atlas?offset=0',
    '/atlas.js',
  ]) {
    assert.equal((await invoke(g, path, { headers: { 'x-preview-access': KEY } })).calls, 1);
    assert.equal(
      (await invoke(g, path, { method: 'POST', headers: { 'x-preview-access': KEY } })).calls,
      0,
    );
  }
  const server = new EventEmitter();
  let upgrades = 0;
  g.upgradeServer(server).on('upgrade', () => upgrades++);
  for (const path of ['/control/1', '/ws/1?write=1', '/oauth/keeper/start']) {
    const socket = new EventEmitter();
    socket.end = () => {};
    server.emit(
      'upgrade',
      request(path, { headers: { 'x-preview-access': KEY } }),
      socket,
      Buffer.alloc(0),
    );
  }
  assert.equal(upgrades, 0);
});

test('judge static graph and stop detail are readable without enabling actions', async () => {
  const { judgeReadRequest } = await import('../src/server.js');
  for (const path of [
    '/fonts/Cinzel.ttf',
    '/vendor/three.module.js',
    '/vendor/three.core.js',
    '/stops/' + 'a'.repeat(64),
    '/api/atlas/stops/' + 'a'.repeat(64),
  ])
    assert.equal(judgeReadRequest(request(path)), true);
  for (const path of [
    '/api/atlas/search',
    '/oauth/start?x=/atlas',
    '//atlas',
    '/control/1?x=.js',
    '/internal/wander/tick',
    '/eventsub',
    '/api/receiving/../control/1',
  ])
    assert.equal(judgeReadRequest(request(path)), false);
});

for (const durable of [false, true])
  test(`judge admission blocks actual ${durable ? 'Firestore' : 'memory'} fixture action dispatch`, async () => {
    const f = await pilotFixture({ durable });
    const g = createPrivatePreview(
      {
        JUDGE_ADMISSION_ENABLED: 'true',
        P5_PREVIEW_READ_ONLY: 'true',
        JUDGE_ACCESS_SHA256: ENV.P5_PREVIEW_ACCESS_SHA256,
        JUDGE_ACCESS_EXPIRES_AT: '2026-11-16T00:00:00.000Z',
      },
      { now: () => NOW },
    );
    const before = f.calls.length;
    for (const path of [
      '/control/' + HOME + '/send',
      '/eventsub',
      '/oauth/keeper/start',
      '/internal/wander/tick',
    ]) {
      const result = await invoke(
        g,
        path,
        { method: 'POST', headers: { 'x-preview-access': KEY } },
        () => {
          throw Error('Judge action reached runtime');
        },
      );
      assert.equal(result.res.status, 403);
      assert.equal(result.calls, 0);
    }
    assert.equal(f.calls.length, before);
  });

test('admitted judge start link explains sandbox without dispatching account connection', async () => {
  const g = createPrivatePreview(
    {
      JUDGE_ADMISSION_ENABLED: 'true',
      P5_PREVIEW_READ_ONLY: 'true',
      JUDGE_ACCESS_SHA256: ENV.P5_PREVIEW_ACCESS_SHA256,
      JUDGE_ACCESS_EXPIRES_AT: '2026-11-16T00:00:00.000Z',
    },
    { now: () => NOW },
  );
  const r = await invoke(g, '/start', { headers: { 'x-preview-access': KEY } });
  assert.equal(r.res.status, 200);
  assert.equal(r.calls, 0);
  assert.match(r.res.body, /Read-only judge sandbox/);
  assert.doesNotMatch(r.res.body, /oauth|<script|<form/i);
  assert.equal(
    (await invoke(g, '/start', { method: 'POST', headers: { 'x-preview-access': KEY } })).res
      .status,
    403,
  );
  assert.equal((await invoke(g, '/start')).res.status, 401);
});
