import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBanSafety, parsePreparedUnban } from '../src/ban-safety.js';
const HOME = '1591805230', OTHER = '1591806023', BOT = '1591804828', now = Date.parse('2026-10-25T13:00:00Z');
function fixture() {
  const calls = [], subscriptions = [{ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: HOME, user_id: BOT }, status: 'enabled', transport: { method: 'webhook', callback: 'https://other.test/eventsub' } }];
  let grantCalls = 0, appCalls = 0, conflict = false, pending = false; const pages = [];
  const grant = { kind: 'user', clientId: 'client', userId: HOME, scopes: ['channel:moderate', 'moderation:read'], token: 'synthetic-user-token', validatedAt: now, expiresAt: now + 600000 };
  const options = { keeperIds: [HOME, OTHER], botId: BOT, clientId: 'client', callbackUrl: 'https://canonical.test/eventsub', webhookSecret: 'synthetic-webhook-secret', now: () => now,
    validateGrant: async () => { grantCalls++; return grant; }, getAppToken: async () => { appCalls++; return { kind: 'app', clientId: 'client', token: 'synthetic-app-token', expiresAt: now + 600000 }; },
    transport: async (url, input) => {
      calls.push({ url, ...input }); const u = new URL(url);
      if (u.pathname === '/helix/eventsub/subscriptions') {
        assert.equal(input.headers.Authorization, 'Bearer synthetic-app-token');
        if (input.method === 'GET') return { status: 200, data: { data: subscriptions, pagination: {} } };
        assert.equal(input.method, 'POST'); const body = JSON.parse(input.body);
        assert.deepEqual(body.condition, { broadcaster_user_id: HOME }); assert.equal(body.version, '1'); assert.equal(body.transport.callback, options.callbackUrl);
        subscriptions.push({ ...body, status: pending ? 'webhook_callback_verification_pending' : 'enabled' });
        return { status: conflict ? 409 : 202, data: {} };
      }
      assert.equal(u.pathname, '/helix/moderation/banned'); assert.equal(u.searchParams.get('broadcaster_id'), HOME); assert.equal(u.searchParams.get('first'), '100');
      assert.equal(input.method, 'GET'); assert.equal(input.headers.Authorization, 'Bearer synthetic-user-token');
      return pages.shift() ?? { status: 200, data: { data: [], pagination: {} } };
    } };
  return { options, grant, calls, subscriptions, pages, counts: () => ({ grantCalls, appCalls }), conflict: () => { conflict = true; }, pending: () => { pending = true; }, service: () => createBanSafety(options) };
}
const rows = (count, offset = 0) => Array.from({ length: count }, (_, n) => ({ user_id: String(1000 + offset + n), created_at: new Date(now - (offset + n + 1) * 1000).toISOString(), expires_at: '', user_login: 'DO-NOT-COPY', reason: 'DO-NOT-COPY' }));
const page = (data, pagination = {}) => ({ status: 200, data: { data, pagination } });
test('constructor requires explicit bounded injection and canonical callback; never default-fetches or auto-starts', async () => {
  const f = fixture(); assert.throws(() => createBanSafety({}));
  for (const change of [{ keeperIds: [HOME] }, { keeperIds: [HOME, HOME] }, { keeperIds: [HOME, BOT] }, { callbackUrl: 'http://canonical.test/eventsub' }, { callbackUrl: 'https://canonical.test/eventsub?x=1' }, { transport: undefined }]) assert.throws(() => createBanSafety({ ...f.options, ...change }));
  f.service(); assert.equal(f.calls.length, 0); assert.equal(f.counts().grantCalls, 0);
  const source = await readFile('src/ban-safety.js', 'utf8'); assert.ok(!/\bfetch\s*\(/.test(source));
});
test('fresh own user grant needs both event and read permissions before any provider work', async () => {
  for (const change of [{ userId: OTHER }, { userId: BOT }, { kind: 'app' }, { clientId: 'wrong' }, { scopes: ['channel:moderate'] }, { scopes: ['moderation:read'] }, { validatedAt: now - 60001 }, { validatedAt: now + 1 }, { expiresAt: now }]) {
    const f = fixture(); Object.assign(f.grant, change); const result = await f.service().prepare(HOME, { reconcileSubscriptions: true });
    assert.equal(result.prepared, false); assert.equal(result.diagnostic.stage, 'grant'); assert.equal(f.calls.length, 0); assert.equal(f.counts().appCalls, 0);
  }
  const f = fixture(); f.grant.scopes = ['channel:moderate', 'moderator:manage:banned_users']; assert.equal((await f.service().prepare(HOME)).prepared, true);
});
test('plan-only prepare returns private minimal complete snapshot with activation/global readiness always false', async () => {
  const f = fixture(); const data = rows(1); data[0].expires_at = new Date(now + 10000).toISOString(); f.pages.push(page(data));
  const result = await f.service().prepare(HOME); assert.equal(result.prepared, true); assert.equal(result.activated, false); assert.equal(result.globalReady, false);
  assert.deepEqual(result.snapshot, [{ userId: '1000', bannedAt: now - 1000, expiresAt: now + 10000 }]);
  assert.ok(!JSON.stringify(result).includes('DO-NOT-COPY')); assert.equal(f.counts().appCalls, 0); assert.equal(f.calls.length, 1);
});
test('optional reconciliation preserves unrelated five-plan entries; exact ban/unban app-token creation,409 relist and enabled reuse are bounded', async () => {
  const f = fixture(); f.conflict(); const result = await f.service().prepare(HOME, { reconcileSubscriptions: true });
  assert.equal(result.prepared, true); assert.ok(result.conditions.every(p => p.status === 'enabled')); assert.equal(f.subscriptions[0].type, 'channel.chat.message');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2); assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 0);
  const before = f.calls.length; assert.equal((await f.service().prepare(HOME, { reconcileSubscriptions: true })).prepared, true);
  assert.equal(f.calls.slice(before).filter(c => c.method === 'POST').length, 0);
});
test('conflicting callback/condition and pending callbacks fail closed without destructive retargeting', async () => {
  for (const change of [{ transport: { method: 'webhook', callback: 'https://old.test/eventsub' } }, { condition: { broadcaster_user_id: HOME, unexpected: 'x' } }]) {
    const f = fixture(); f.subscriptions.push({ type: 'channel.ban', version: '1', condition: { broadcaster_user_id: HOME }, status: 'enabled', transport: { method: 'webhook', callback: f.options.callbackUrl }, ...change });
    const result = await f.service().prepare(HOME, { reconcileSubscriptions: true }); assert.equal(result.prepared, false); assert.equal(result.diagnostic.stage, 'subscription-conflict'); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  }
  const f = fixture(); f.pending(); const result = await f.service().prepare(HOME, { reconcileSubscriptions: true }); assert.equal(result.prepared, false); assert.equal(result.diagnostic.stage, 'subscription-pending'); assert.ok(!('snapshot' in result));
});
test('complete128 snapshot uses two pages, encoded cursor and no identity/name/reason copies', async () => {
  const f = fixture(); f.pages.push(page(rows(100), { cursor: 'cursor/+=safe' }), page(rows(28, 100)));
  const result = await f.service().prepare(HOME); assert.equal(result.snapshot.length, 128); assert.equal(new URL(f.calls[1].url).searchParams.get('after'), 'cursor/+=safe');
  assert.ok(result.snapshot.every(r => Object.keys(r).sort().join(',') === 'bannedAt,expiresAt,userId'));
});
test('overflow129, repeats, malformed timestamps/pagination/timeout expiry and incomplete pages never return partial snapshot', async () => {
  const variants = [[page(rows(100), { cursor: 'one' }), page(rows(29, 100))], [page(rows(1), { cursor: 'one' }), page(rows(1, 1), { cursor: 'one' })],
    [page(rows(1), { cursor: 'one' }), page(rows(1))], [page(rows(1, 1)), page(rows(1))], [page([{ ...rows(1)[0], created_at: 'bad' }])],
    [page([{ ...rows(1)[0], expires_at: new Date(now - 1).toISOString() }])], [page([], { cursor: '' })], [page([], { extra: 'secret' })],
    [page([], { cursor: 'one' }), page([], { cursor: 'two' })], [{ status: 200, data: { data: [], pagination: null } }]];
  // Independently invalid dates still reject; no API ordering assumption.
  variants[3] = [page([{ ...rows(1)[0], created_at: '2026-02-30T00:00:00Z' }])];
  for (const pages of variants) { const f = fixture(); f.pages.push(...pages); const result = await f.service().prepare(HOME); assert.equal(result.prepared, false); assert.equal(result.snapshotComplete, false); assert.ok(!('snapshot' in result)); }
});
test('HTTP401/403/429, transport errors and bounded timeouts disclose no secrets/cursors/raw errors', async () => {
  for (const status of [401, 403, 429]) { const f = fixture(); f.pages.push({ status, data: { message: 'PRIVATE_TOKEN' } }); const result = await f.service().prepare(HOME); assert.equal(result.prepared, false); assert.equal(result.diagnostic.httpStatus, status); assert.ok(!JSON.stringify(result).includes('PRIVATE_TOKEN')); }
  for (const transport of [async () => { throw Error('PRIVATE_TOKEN'); }, async () => new Promise(() => {})]) {
    const f = fixture(); f.options.transport = transport; f.options.timeoutMs = 2; const result = await f.service().prepare(HOME); assert.equal(result.prepared, false); assert.ok(!JSON.stringify(result).includes('PRIVATE_TOKEN'));
  }
});
test('unban utility trusts verified header ordering only, whitelists identities and performs no mutation', () => {
  const payload = { subscription: { type: 'channel.unban', version: '1', condition: { broadcaster_user_id: HOME } }, event: { broadcaster_user_id: HOME, user_id: '1000', moderator_user_id: HOME, user_login: 'PRIVATE', reason: 'PRIVATE', timestamp: 'untrusted' } };
  assert.deepEqual(parsePreparedUnban(payload, HOME, new Date(now).toISOString()), { host: HOME, userId: '1000', sentAt: now });
  for (const mutate of [p => { p.subscription.version = '2'; }, p => { p.subscription.condition.extra = 'x'; }, p => { p.event.source_message_id = 'copied'; }]) { const p = structuredClone(payload); mutate(p); assert.throws(() => parsePreparedUnban(p, HOME, new Date(now).toISOString())); }
});

test('wrong app-token principal and unresolved409 never fall back to user subscription tokens or retry create', async () => {
  const f = fixture(); f.options.getAppToken = async () => ({ kind: 'user', clientId: 'client', token: 'PRIVATE', expiresAt: now + 1000 });
  const result = await f.service().prepare(HOME, { reconcileSubscriptions: true }); assert.equal(result.prepared, false); assert.equal(f.calls.length, 0);
  const g = fixture(); let posts = 0;
  g.options.transport = async (_url, input) => { assert.equal(input.headers.Authorization, 'Bearer synthetic-app-token'); if (input.method === 'POST') { posts++; return { status: 409, data: { message: 'PRIVATE' } }; } return page([]); };
  const conflict = await g.service().prepare(HOME, { reconcileSubscriptions: true }); assert.equal(conflict.prepared, false); assert.equal(conflict.diagnostic.stage, 'subscription-conflict'); assert.equal(posts, 1); assert.ok(!JSON.stringify(conflict).includes('PRIVATE'));
});
test('invalid options and grant-validation failures cannot perform provider work', async () => {
  for (const options of [{ unexpected: true }, { reconcileSubscriptions: 'true' }, [], null]) {
    const f = fixture(); assert.equal((await f.service().prepare(HOME, options)).prepared, false); assert.equal(f.calls.length, 0); assert.equal(f.counts().grantCalls, 0);
  }
  const f = fixture(); f.options.validateGrant = async () => { throw Error('PRIVATE_GRANT'); };
  const result = await f.service().prepare(HOME); assert.equal(result.prepared, false); assert.equal(f.calls.length, 0); assert.ok(!JSON.stringify(result).includes('PRIVATE_GRANT'));
});

test('legitimate unsorted creation dates prepare completely and preserve provider order', async () => {
  const f = fixture(); const supplied = [rows(1, 10)[0], rows(1, 1)[0], rows(1, 20)[0]];
  f.pages.push(page(supplied)); const result = await f.service().prepare(HOME);
  assert.equal(result.prepared, true); assert.equal(result.snapshotComplete, true);
  assert.deepEqual(result.snapshot.map(r => r.userId), supplied.map(r => r.user_id));
  assert.deepEqual(result.snapshot.map(r => r.bannedAt), supplied.map(r => Date.parse(r.created_at)));
});
