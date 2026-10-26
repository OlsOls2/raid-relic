// Standalone foundation only: deliberately not imported by runtime/OAuth/controls.
const id = (value) => typeof value === 'string' && /^\d{1,32}$/.test(value);
const cursor = (value) => typeof value === 'string' && /^[A-Za-z0-9_+=/-]{1,256}$/.test(value);
const iso = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value))
    return null;
  const n = Date.parse(value);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 19) === value.slice(0, 19)
    ? n
    : null;
};
class BanPreparationFailure extends Error {
  constructor(stage, httpStatus = null) {
    super('Ban preparation unavailable');
    this.safe = { stage, httpStatus };
  }
}
const fail = (stage, status) => {
  throw new BanPreparationFailure(stage, status);
};
function page(response, stage) {
  if (response?.status !== 200)
    fail(
      stage,
      Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599
        ? response.status
        : null,
    );
  const body = response.data;
  if (
    !body ||
    !Array.isArray(body.data) ||
    body.data.length > 100 ||
    !body.pagination ||
    typeof body.pagination !== 'object' ||
    Array.isArray(body.pagination) ||
    Object.keys(body.pagination).some((k) => k !== 'cursor') ||
    (Object.hasOwn(body.pagination, 'cursor') && !cursor(body.pagination.cursor))
  )
    fail(stage);
  return body;
}
export function createBanSafety({
  keeperIds,
  botId,
  clientId,
  callbackUrl,
  webhookSecret,
  transport,
  validateGrant,
  getAppToken,
  now = Date.now,
  timeoutMs = 8000,
}) {
  if (
    !Array.isArray(keeperIds) ||
    keeperIds.length < 2 ||
    keeperIds.length > 4 ||
    new Set(keeperIds).size !== keeperIds.length ||
    !keeperIds.every(id) ||
    !id(botId) ||
    keeperIds.includes(botId) ||
    typeof clientId !== 'string' ||
    !clientId ||
    typeof transport !== 'function' ||
    typeof validateGrant !== 'function' ||
    typeof getAppToken !== 'function' ||
    typeof now !== 'function' ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 8000
  )
    throw Error('Injected ban preparation configuration required');
  let callback;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw Error('Canonical webhook configuration required');
  }
  if (
    callback.protocol !== 'https:' ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash ||
    callback.pathname !== '/eventsub' ||
    callback.href !== callbackUrl ||
    typeof webhookSecret !== 'string' ||
    webhookSecret.length < 10 ||
    webhookSecret.length > 100
  )
    throw Error('Canonical webhook configuration required');
  const plans = (host) =>
    ['channel.ban', 'channel.unban'].map((type) => ({
      type,
      version: '1',
      condition: { broadcaster_user_id: host },
    }));
  async function bounded(work, stage) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        work(controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new BanPreparationFailure(stage));
          }, timeoutMs);
        }),
      ]);
    } catch {
      fail(stage);
    } finally {
      clearTimeout(timer);
    }
  }
  const call = (url, options, stage) =>
    bounded((signal) => transport(url, { ...options, signal }), stage);
  async function list(headers) {
    const all = [];
    const seen = new Set();
    let after;
    for (let n = 0; n < 2; n++) {
      const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
      url.searchParams.set('first', '100');
      if (after) url.searchParams.set('after', after);
      const body = page(
        await call(url.href, { method: 'GET', headers }, 'subscription-list'),
        'subscription-list',
      );
      all.push(...body.data);
      if (!Object.hasOwn(body.pagination, 'cursor')) return all;
      after = body.pagination.cursor;
      if (seen.has(after)) fail('subscription-pagination');
      seen.add(after);
    }
    fail('subscription-pagination');
  }
  function matches(all, desired) {
    const candidates = all.filter(
      (item) =>
        item?.type === desired.type &&
        item.version === '1' &&
        item.condition?.broadcaster_user_id === desired.condition.broadcaster_user_id,
    );
    if (candidates.length > 1) fail('subscription-conflict');
    const item = candidates[0];
    if (!item) return null;
    if (
      Object.keys(item.condition).length !== 1 ||
      item.transport?.method !== 'webhook' ||
      item.transport.callback !== callbackUrl
    )
      fail('subscription-conflict');
    if (!['enabled', 'webhook_callback_verification_pending'].includes(item.status))
      fail('subscription-status');
    return item.status;
  }
  return {
    async prepare(host, options = {}) {
      let stage = 'grant';
      try {
        if (
          !options ||
          typeof options !== 'object' ||
          Array.isArray(options) ||
          Object.keys(options).some((k) => k !== 'reconcileSubscriptions') ||
          (Object.hasOwn(options, 'reconcileSubscriptions') &&
            typeof options.reconcileSubscriptions !== 'boolean')
        )
          fail('options');
        const reconcileSubscriptions = options.reconcileSubscriptions === true;
        if (!keeperIds.includes(host)) fail('grant');
        const startedAt = now();
        const grant = await bounded((signal) => validateGrant(host, { signal }), 'grant');
        const checkedAt = now();
        if (
          !grant ||
          grant.kind !== 'user' ||
          grant.clientId !== clientId ||
          grant.userId !== host ||
          grant.userId === botId ||
          !Array.isArray(grant.scopes) ||
          !grant.scopes.includes('channel:moderate') ||
          !['moderation:read', 'moderator:manage:banned_users'].some((scope) =>
            grant.scopes.includes(scope),
          ) ||
          !Number.isFinite(grant.validatedAt) ||
          grant.validatedAt > checkedAt ||
          checkedAt - grant.validatedAt > 60000 ||
          !Number.isFinite(grant.expiresAt) ||
          grant.expiresAt <= checkedAt ||
          typeof grant.token !== 'string' ||
          !grant.token
        )
          fail('grant');
        const desired = plans(host);
        let conditions = desired.map((p) => ({ ...p, status: 'not-reconciled' }));
        if (reconcileSubscriptions) {
          stage = 'app-token';
          const app = await bounded((signal) => getAppToken({ signal }), 'app-token');
          if (
            !app ||
            app.kind !== 'app' ||
            app.clientId !== clientId ||
            !Number.isFinite(app.expiresAt) ||
            app.expiresAt <= now() ||
            typeof app.token !== 'string' ||
            !app.token
          )
            fail(stage);
          const headers = {
            Authorization: `Bearer ${app.token}`,
            'Client-Id': clientId,
            'content-type': 'application/json',
          };
          let all = await list(headers);
          // Validate BOTH callbacks before any creation; never delete or retarget conflicts.
          for (const p of desired) matches(all, p);
          for (const p of desired)
            if (!matches(all, p)) {
              stage = 'subscription-create';
              const response = await call(
                'https://api.twitch.tv/helix/eventsub/subscriptions',
                {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({
                    ...p,
                    transport: { method: 'webhook', callback: callbackUrl, secret: webhookSecret },
                  }),
                },
                stage,
              );
              if (![202, 409].includes(response?.status))
                fail(
                  stage,
                  Number.isInteger(response?.status) &&
                    response.status >= 100 &&
                    response.status <= 599
                    ? response.status
                    : null,
                );
              if (response.status === 409) {
                all = await list(headers);
                if (!matches(all, p)) fail('subscription-conflict');
              }
            }
          all = await list(headers);
          conditions = desired.map((p) => ({ ...p, status: matches(all, p) ?? 'missing' }));
          if (conditions.some((p) => p.status !== 'enabled')) fail('subscription-pending');
        }
        stage = 'bans-read';
        const headers = { Authorization: `Bearer ${grant.token}`, 'Client-Id': clientId };
        const bans = [],
          users = new Set(),
          cursors = new Set();
        let after;
        for (let n = 0; n < 2; n++) {
          if (now() >= grant.expiresAt || now() - grant.validatedAt > 60000) fail('grant');
          const url = new URL('https://api.twitch.tv/helix/moderation/banned');
          url.searchParams.set('broadcaster_id', host);
          url.searchParams.set('first', '100');
          if (after) url.searchParams.set('after', after);
          const body = page(await call(url.href, { method: 'GET', headers }, stage), stage);
          for (const item of body.data) {
            const bannedAt = iso(item?.created_at),
              expiresAt = item?.expires_at === '' ? null : iso(item?.expires_at);
            if (
              !id(item?.user_id) ||
              users.has(item.user_id) ||
              bannedAt === null ||
              bannedAt > startedAt ||
              (item.expires_at !== '' &&
                (expiresAt === null || expiresAt <= now() || expiresAt <= bannedAt))
            )
              fail('snapshot-schema');
            users.add(item.user_id);
            bans.push({ userId: item.user_id, bannedAt, expiresAt });
            if (bans.length > 128) fail('snapshot-capacity');
          }
          if (!Object.hasOwn(body.pagination, 'cursor')) {
            if (now() >= grant.expiresAt || now() - grant.validatedAt > 60000) fail('grant');
            return {
              prepared: true,
              activated: false,
              globalReady: false,
              snapshotComplete: true,
              host,
              observedAt: startedAt,
              conditions,
              snapshot: bans,
            };
          }
          after = body.pagination.cursor;
          if (cursors.has(after)) fail('snapshot-pagination');
          cursors.add(after);
        }
        fail('snapshot-pagination');
      } catch (error) {
        return {
          prepared: false,
          activated: false,
          globalReady: false,
          snapshotComplete: false,
          diagnostic:
            error instanceof BanPreparationFailure ? error.safe : { stage, httpStatus: null },
        };
      }
    },
  };
}
// Future signed-ingress utility only. No runtime wiring or unban mutation.
export function parsePreparedUnban(payload, host, verifiedHeaderTimestamp) {
  const s = payload?.subscription,
    e = payload?.event,
    sentAt = iso(verifiedHeaderTimestamp);
  if (
    !id(host) ||
    s?.type !== 'channel.unban' ||
    s.version !== '1' ||
    !s.condition ||
    Object.keys(s.condition).join(',') !== 'broadcaster_user_id' ||
    s.condition.broadcaster_user_id !== host ||
    e?.broadcaster_user_id !== host ||
    !id(e.user_id) ||
    !id(e.moderator_user_id) ||
    e.source_broadcaster_user_id != null ||
    e.source_message_id != null ||
    sentAt === null
  )
    throw Error('Invalid prepared unban');
  return { host, userId: e.user_id, sentAt };
}
