// Parent executes inside the established offline OS VM; no skip or external runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  privatePreviewFixture,
  privateFixtureRequest,
} from '../scripts/browser-smoke-readiness-a11y.js';

test('real loopback HTTPS rejects ambiguous/duplicate/malformed/foreign credentials before product dispatch', async (t) => {
  const f = await privatePreviewFixture();
  t.after(() => f.close());
  for (const options of [
    { headers: { 'X-Preview-Access': f.key, Cookie: `__Host-raid-preview=${f.key}` } },
    { headers: { Cookie: `__Host-raid-preview=${f.key}; __Host-raid-preview=${f.key}` } },
    { headers: ['Host', 'localhost:5191', 'X-Preview-Access', f.key, 'x-preview-access', f.key] },
    {
      headers: [
        'Host',
        'localhost:5191',
        'Cookie',
        `__Host-raid-preview=${f.key}`,
        'Cookie',
        'other=fixture',
      ],
    },
    { headers: { 'X-Preview-Access': f.key + '=' } },
    { headers: { 'X-Preview-Access': 'A'.repeat(43) } },
  ]) {
    const r = await privateFixtureRequest('/health', options);
    assert.ok([400, 401].includes(r.status));
    assert.ok(!r.body.includes(f.key));
  }
  for (const path of [
    '/?key=' + f.key,
    '/%2fhealth',
    '/a/../health',
    '//health',
    '/health?key=' + f.key,
  ]) {
    const r = await privateFixtureRequest(path);
    assert.ok([400, 401].includes(r.status));
  }
  const body = 'key=' + f.key;
  const foreign = await privateFixtureRequest('/_preview/access', {
    method: 'POST',
    body,
    headers: {
      Origin: 'https://foreign.invalid',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(body)),
    },
  });
  assert.equal(foreign.status, 401);
  assert.equal(foreign.headers['set-cookie'], undefined);
  const before = f.stats();
  assert.equal(before.app, 0);
  assert.equal(before.snapshot, 0);
  assert.equal(before.subscribe, 0);
  assert.equal(before.readBudget, 0);
  for (const headers of [
    { 'X-Preview-Access': f.key },
    { Cookie: `__Host-raid-preview=${f.key}` },
  ]) {
    const r = await privateFixtureRequest('/health', { headers });
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'private, no-store');
    assert.ok(!r.body.includes(f.key));
  }
  assert.equal(
    (
      await privateFixtureRequest('/eventsub', {
        method: 'POST',
        headers: { 'X-Preview-Access': f.key },
      })
    ).status,
    403,
  );
  const after = f.stats();
  assert.equal(after.credentialLeak, 0);
  assert.equal(after.actions, 0);
  assert.equal(after.provider, 0);
  assert.equal(after.readOnlyDenied, 1);
});
test('real loopback HTTPS form returns fixed303 secure cookie without body/URL reflection and rejects extra fields', async (t) => {
  const f = await privatePreviewFixture();
  t.after(() => f.close());
  assert.equal((await privateFixtureRequest('/')).headers['referrer-policy'], 'same-origin');
  const post = (body) =>
    privateFixtureRequest('/_preview/access', {
      method: 'POST',
      body,
      headers: {
        Origin: f.origin,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': String(Buffer.byteLength(body)),
      },
    });
  for (const body of [
    'key=' + f.key + '&next=//foreign.invalid',
    'key=' + f.key + '&key=' + f.key,
    'key=' + encodeURIComponent(f.key + '='),
  ]) {
    const r = await post(body);
    assert.equal(r.status, 401);
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['set-cookie'], undefined);
    assert.ok(!r.body.includes(f.key));
  }
  const r = await post('key=' + f.key);
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/');
  assert.ok(!r.body.includes(f.key));
  const cookies = r.headers['set-cookie'];
  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /; Secure; HttpOnly; Path=\/; SameSite=Strict; Max-Age=\d+$/);
  const authenticated = await privateFixtureRequest('/snapshot', {
    headers: { Cookie: cookies[0].split(';')[0] },
  });
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.headers['referrer-policy'], 'no-referrer');
  assert.equal(f.stats().credentialLeak, 0);
  assert.equal(f.stats().actions, 0);
  assert.equal(f.stats().provider, 0);
});
test('public-default transport remains public and the gate does not intercept its paths', async (t) => {
  const f = await privatePreviewFixture({ enabled: false });
  t.after(() => f.close());
  const root = await privateFixtureRequest('/');
  assert.equal(root.status, 200);
  assert.match(root.body, /LOCAL synthetic product/);
  assert.doesNotMatch(root.body, /<h1>Private preview/);
  assert.equal((await privateFixtureRequest('/health')).status, 200);
  assert.equal((await privateFixtureRequest('/_preview/access', { method: 'POST' })).status, 403); // Product stub's read-only policy, not gate login.
  assert.equal(f.stats().app, 3);
  assert.equal(f.stats().provider, 0);
  assert.equal(f.stats().actions, 0);
});

test('judge HTTPS form cookie admits only reads and numeric read WSS; real expiry disconnects', async (t) => {
  const { WebSocket } = await import('ws');
  const f = await privatePreviewFixture({ judge: true, expiryMs: 5000 });
  t.after(() => f.close());
  const body = 'key=' + f.key;
  const login = await privateFixtureRequest('/_preview/access', {
    method: 'POST',
    body,
    headers: {
      Origin: f.origin,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(body)),
    },
  });
  assert.equal(login.status, 303);
  assert.match(login.headers['set-cookie'][0], /; Secure; HttpOnly; Path=\/; SameSite=Strict;/);
  const Cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal(f.stats().app, 0);
  for (const path of [
    '/health',
    '/fixture.js',
    '/fonts/Cinzel.ttf',
    '/vendor/three.module.js',
    '/vendor/three.core.js',
    '/stops/' + 'a'.repeat(64),
    '/api/atlas/stops/' + 'a'.repeat(64),
  ]) {
    assert.equal((await privateFixtureRequest(path, { headers: { Cookie } })).status, 200);
  }
  const before = f.stats();
  for (const path of [
    '/control/201',
    '/oauth/keeper/start',
    '/auth/callback',
    '/eventsub',
    '/internal/wander/tick',
    '/api/forge',
  ]) {
    for (const method of ['GET', 'POST'])
      assert.equal(
        (await privateFixtureRequest(path, { method, headers: { Cookie } })).status,
        403,
      );
  }
  assert.equal(
    (
      await privateFixtureRequest('/health', {
        headers: { Cookie: '__Host-raid-preview=' + 'A'.repeat(43) },
      })
    ).status,
    401,
  );
  assert.equal(f.stats().app, before.app);
  assert.equal(f.stats().provider, 0);
  assert.equal(f.stats().actions, 0);
  const connect = (path) =>
    new WebSocket(f.origin.replace('https:', 'wss:') + path, {
      rejectUnauthorized: false,
      origin: f.origin,
      headers: { Cookie },
      handshakeTimeout: 2000,
    });
  for (const path of ['/control/201', '/ws/201?write=1']) {
    await new Promise((resolve, reject) => {
      const ws = connect(path);
      ws.once('open', () => {
        ws.terminate();
        reject(Error('Non-read upgrade admitted'));
      });
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => {
        const status = res.statusCode;
        res.resume();
        ws.terminate();
        status === 401 ? resolve() : reject(Error('Unexpected upgrade denial'));
      });
    });
  }
  assert.equal(f.stats().snapshot, 0);
  assert.equal(f.stats().readBudget, 0);
  const ws = connect('/ws/201');
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(Error('Judge read snapshot timeout'));
    }, 2000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        assert.deepEqual(JSON.parse(data.toString()), {
          type: 'snapshot',
          fixture: true,
          revision: 1,
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  assert.equal(f.stats().snapshot, 1);
  assert.equal(f.stats().subscribe, 1);
  assert.equal(f.stats().credentialLeak, 0);
  // An admitted read socket is not a command channel.
  await new Promise((resolve, reject) => {
    const writer = connect('/ws/201');
    const timer = setTimeout(() => {
      writer.terminate();
      reject(Error('Judge write socket did not close'));
    }, 2000);
    writer.once('open', () => writer.send('{"action":"raid"}'));
    writer.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    writer.once('close', (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 1008);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  assert.equal(f.stats().app, before.app);
  assert.equal(f.stats().provider, 0);
  assert.equal(f.stats().actions, 0);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(Error('Judge expiry did not close socket'));
    }, 6500);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  assert.equal((await privateFixtureRequest('/health', { headers: { Cookie } })).status, 401);
  assert.equal(f.stats().activeSubscriptions, 0);
  assert.equal(f.stats().provider, 0);
  assert.equal(f.stats().actions, 0);
});
