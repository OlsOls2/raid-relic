import { randomBytes } from 'node:crypto';
import { httpTransport } from './oauth.js';

export function createSendOff({ state, oauth, clientId, streamerId, transport = httpTransport, now = Date.now, authorize }) {
  async function processPending() {
    const owner = randomBytes(24).toString('hex');
    const intent = await state.sendOffStep({ type: 'claim', source: streamerId, owner }, now());
    if (!intent) return { status: 'idle-or-reconcile-only' };
    const finish = status => state.sendOffStep({ type: 'finish', id: intent.id, owner, status }, now());
    let token; let refreshed = false;
    try {
      await authorize?.(intent.sourceId, intent.targetId);
      token = await oauth.accessToken('streamer');
      async function get(url) {
        let response = await transport(url, { headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId } });
        if (response.status === 401 && !refreshed) {
          refreshed = true; token = await oauth.accessToken('streamer', { refresh: true });
          response = await transport(url, { headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId } });
        }
        if (response.status !== 200 || !Array.isArray(response.data?.data)) throw new Error('Preflight failed');
        return response.data.data;
      }
      const users = await get(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(intent.targetLogin)}`);
      if (users.length !== 1 || users[0].id !== intent.targetId || users[0].login !== intent.targetLogin) throw new Error('Target mismatch');
      const streams = await get(`https://api.twitch.tv/helix/streams?user_id=${intent.sourceId}&user_id=${intent.targetId}`);
      for (const [id, stream] of [[intent.sourceId, intent.sourceStreamId], [intent.targetId, intent.targetStreamId]]) {
        if (!streams.some(item => item.user_id === id && item.id === stream && item.type === 'live')) throw new Error('Not live');
      }
    } catch { await finish('rejected'); return { status: 'rejected-preflight' }; }
    try { if (authorize) { await authorize(intent.sourceId, intent.targetId); token = await oauth.accessToken('streamer'); } } catch { await finish('rejected'); return { status: 'rejected-preflight' }; }
    const dispatched = await state.sendOffStep({ type: 'dispatch', id: intent.id, owner }, now());
    if (!dispatched) return { status: 'rejected-or-lease-lost' };
    // Irreversible dispatch boundary is persisted BEFORE HTTP. Never retry this
    // request, even on 401. Crash/timeout/5xx outcomes require reconciliation.
    let status = 'unknown';
    try {
      const response = await transport(`https://api.twitch.tv/helix/raids?from_broadcaster_id=${intent.sourceId}&to_broadcaster_id=${intent.targetId}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId } });
      status = response.status === 200 ? 'accepted' : response.status >= 400 && response.status < 500 ? 'rejected' : 'unknown';
    } catch { /* May have reached Twitch: no automatic retry. */ }
    await finish(status);
    return { status };
  }
  return { processPending };
}
