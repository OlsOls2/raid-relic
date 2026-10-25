import { boundedCall } from './bounded.js';
import { httpTransport } from './oauth.js';

// Twitch may include the unused raid direction as an empty string. Nothing
// else is optional: nonempty opposite directions and unknown keys fail closed.
export function matchesSubscriptionCondition(type, actual, desired) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual) || !desired || typeof desired !== 'object' || Array.isArray(desired)) return false;
  const keys = Object.keys(desired);
  if (type !== 'channel.raid') return Object.keys(actual).length === keys.length
    && keys.every(key => Object.hasOwn(actual, key) && actual[key] === desired[key]);
  if (keys.length !== 1 || !['from_broadcaster_user_id', 'to_broadcaster_user_id'].includes(keys[0]) || typeof desired[keys[0]] !== 'string' || !/^\d{1,32}$/.test(desired[keys[0]])) return false;
  const active = keys[0], opposite = active === 'from_broadcaster_user_id' ? 'to_broadcaster_user_id' : 'from_broadcaster_user_id';
  return Object.hasOwn(actual, active) && actual[active] === desired[active]
    && Object.keys(actual).every(key => key === active || key === opposite)
    && (!Object.hasOwn(actual, opposite) || actual[opposite] === '');
}
const matches = (item, payload) => item?.type === payload.type && item.version === payload.version
  && item.transport?.method === 'webhook' && item.transport.callback === payload.transport.callback
  && matchesSubscriptionCondition(payload.type, item.condition, payload.condition);
const diagnosticStages = new Set(['grants', 'app-token', 'list', 'readiness-list', 'pagination', 'create']);
const diagnosticTypes = new Set(['stream.online', 'stream.offline', 'channel.raid', 'channel.chat.message']);
function safeDiagnostic(value) {
  return { stage: diagnosticStages.has(value.stage) ? value.stage : 'subscriptions',
    ...(Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? { httpStatus: value.httpStatus } : {}),
    ...(diagnosticTypes.has(value.type) ? { type: value.type,
      ...(value.type === 'channel.raid' && ['incoming', 'outgoing'].includes(value.direction) ? { direction: value.direction } : {}) } : {}) };
}
class SubscriptionFailure extends Error {
  constructor(stage, status, payload) {
    super(`Subscription ${diagnosticStages.has(stage) ? stage : 'request'} failed; reconcile explicitly after review`);
    this.diagnostic = safeDiagnostic({ stage, httpStatus: status, type: payload?.type,
      direction: payload?.type === 'channel.raid' ? (payload.condition?.from_broadcaster_user_id ? 'outgoing' : 'incoming') : undefined });
  }
}
// Re-whitelist on extraction; no caller/config text or extra fields can escape.
export const subscriptionFailureDiagnostic = error => error instanceof SubscriptionFailure ? safeDiagnostic(error.diagnostic) : null;

// Explicit privileged service only: never called during startup or via public HTTP.
export function createSubscriptionManager({ oauth, bot, clientId, clientSecret, streamerId, transport = httpTransport }) {
  function payloads() {
    const chat = bot.chatSubscription();
    if (typeof streamerId !== 'string' || !/^\d{1,32}$/.test(streamerId) || chat.condition?.broadcaster_user_id !== streamerId) throw new Error('Configured subscription identity mismatch');
    return [
      { type: 'stream.online', condition: { broadcaster_user_id: streamerId } },
      { type: 'stream.offline', condition: { broadcaster_user_id: streamerId } },
      { type: 'channel.raid', condition: { to_broadcaster_user_id: streamerId } },
      { type: 'channel.raid', condition: { from_broadcaster_user_id: streamerId } },
    ].map(item => ({ ...item, version: '1', transport: { ...chat.transport } })).concat(chat);
  }
  async function call(url, options, stage, payload) {
    try { return await boundedCall(signal => transport(url, { ...options, signal })); } catch { throw new SubscriptionFailure(stage, undefined, payload); }
  }
  async function reconcile({ readiness = false } = {}) {
    const desired = payloads();
    try { await oauth.accessToken('streamer'); await oauth.accessToken('bot'); } catch { throw new SubscriptionFailure('grants'); }
    const response = await call('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString() }, 'app-token');
    if (response.status !== 200 || typeof response.data?.access_token !== 'string' || !response.data.access_token) throw new SubscriptionFailure('app-token', response.status);
    const headers = { Authorization: `Bearer ${response.data.access_token}`, 'Client-Id': clientId, 'content-type': 'application/json' };
    async function list(stage = 'list') {
    const existing = []; const cursors = new Set(); let cursor;
    for (let page = 0; page < 5; page++) {
      const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions'); url.searchParams.set('first', '100');
      if (cursor) url.searchParams.set('after', cursor);
      const listed = await call(url.href, { headers }, stage);
      if (listed.status !== 200 || !Array.isArray(listed.data?.data) || listed.data.data.length > 100) throw new SubscriptionFailure(stage, listed.status);
      existing.push(...listed.data.data); cursor = listed.data.pagination?.cursor;
      if (!cursor) break;
      if (typeof cursor !== 'string' || cursor.length > 1024 || cursors.has(cursor) || page === 4) throw new SubscriptionFailure('pagination');
      cursors.add(cursor);
    }
    return existing;
    }
    let existing = await list(); let relisted = false;
    const results = [];
    for (const payload of desired) {
      const find = () => existing.find(item => matches(item, payload) && ['enabled', 'webhook_callback_verification_pending'].includes(item.status));
      if (find()) { results.push({ type: payload.type, status: 'existing' }); continue; }
      const created = await call('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers, body: JSON.stringify(payload) }, 'create', payload);
      if (created.status === 409 && !relisted) {
        relisted = true; existing = await list();
        if (find()) { results.push({ type: payload.type, status: 'existing' }); continue; }
      }
      if (created.status !== 202 || typeof created.data?.data?.[0]?.id !== 'string') throw new SubscriptionFailure('create', created.status, payload);
      results.push({ type: payload.type, status: 'created' });
    }
    if (!readiness) return results;
    const final = await list('readiness-list');
    const conditions = desired.map(payload => {
      const matching = final.filter(item => matches(item, payload));
      const status = matching.some(item => item.status === 'enabled') ? 'enabled'
        : matching.some(item => item.status === 'webhook_callback_verification_pending') ? 'pending' : 'missing';
      const direction = payload.type === 'channel.raid' ? (payload.condition.from_broadcaster_user_id ? 'outgoing' : 'incoming') : null;
      return { type: payload.type, direction, status };
    });
    return { results, conditions, ready: conditions.every(item => item.status === 'enabled') };
  }
  return { payloads, setup: reconcile, reconcile };
}
