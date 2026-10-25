import { httpTransport } from './oauth.js';

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
  async function call(url, options) {
    try { return await transport(url, options); } catch { throw new Error('Subscription request failed'); }
  }
  async function reconcile({ readiness = false } = {}) {
    const desired = payloads();
    await oauth.accessToken('streamer'); await oauth.accessToken('bot');
    const response = await call('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString() });
    if (response.status !== 200 || typeof response.data?.access_token !== 'string' || !response.data.access_token) throw new Error('Subscription app token unavailable');
    const headers = { Authorization: `Bearer ${response.data.access_token}`, 'Client-Id': clientId, 'content-type': 'application/json' };
    async function list() {
    const existing = []; const cursors = new Set(); let cursor;
    for (let page = 0; page < 5; page++) {
      const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions'); url.searchParams.set('first', '100');
      if (cursor) url.searchParams.set('after', cursor);
      const listed = await call(url.href, { headers });
      if (listed.status !== 200 || !Array.isArray(listed.data?.data) || listed.data.data.length > 100) throw new Error('Subscription list unavailable');
      existing.push(...listed.data.data); cursor = listed.data.pagination?.cursor;
      if (!cursor) break;
      if (typeof cursor !== 'string' || cursor.length > 1024 || cursors.has(cursor) || page === 4) throw new Error('Subscription pagination capacity reached');
      cursors.add(cursor);
    }
    return existing;
    }
    let existing = await list(); let relisted = false;
    const results = [];
    for (const payload of desired) {
      const find = () => existing.find(item => item.type === payload.type && item.version === payload.version
        && ['enabled', 'webhook_callback_verification_pending'].includes(item.status)
        && item.transport?.method === 'webhook' && item.transport.callback === payload.transport.callback
        && Object.keys(item.condition ?? {}).length === Object.keys(payload.condition).length
        && Object.entries(payload.condition).every(([key, value]) => item.condition[key] === value));
      if (find()) { results.push({ type: payload.type, status: 'existing' }); continue; }
      const created = await call('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers, body: JSON.stringify(payload) });
      if (created.status === 409 && !relisted) {
        relisted = true; existing = await list();
        if (find()) { results.push({ type: payload.type, status: 'existing' }); continue; }
      }
      if (created.status !== 202 || typeof created.data?.data?.[0]?.id !== 'string') throw new Error('Subscription creation failed; reconcile explicitly after review');
      results.push({ type: payload.type, status: 'created' });
    }
    if (!readiness) return results;
    const final = await list();
    const conditions = desired.map(payload => {
      const matches = final.filter(item => item.type === payload.type && item.version === payload.version
        && item.transport?.method === 'webhook' && item.transport.callback === payload.transport.callback
        && Object.keys(item.condition ?? {}).length === Object.keys(payload.condition).length
        && Object.entries(payload.condition).every(([key, value]) => item.condition[key] === value));
      const status = matches.some(item => item.status === 'enabled') ? 'enabled'
        : matches.some(item => item.status === 'webhook_callback_verification_pending') ? 'pending' : 'missing';
      const direction = payload.type === 'channel.raid' ? (payload.condition.from_broadcaster_user_id ? 'outgoing' : 'incoming') : null;
      return { type: payload.type, direction, status };
    });
    return { results, conditions, ready: conditions.every(item => item.status === 'enabled') };
  }
  return { payloads, setup: reconcile, reconcile };
}
