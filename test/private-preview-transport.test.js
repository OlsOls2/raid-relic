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
