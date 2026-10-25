import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMemoryState } from './state.js';
import { parseChat } from './bot.js';
import { createMarkService } from './marks.js';
import { validateReleaseCommit } from './release.js';
import { parseLifecycle } from './lifecycle.js';

export const MAX_BODY_BYTES = 65536;
export const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const assets = new Map([
  ['/', ['atlas.html', 'text/html; charset=utf-8']],
  ['/overlay', ['overlay.html', 'text/html; charset=utf-8']],
  ['/relic.svg', ['relic.svg', 'image/svg+xml']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/overlay.css', ['overlay.css', 'text/css; charset=utf-8']],
  ['/overlay.js', ['overlay.js', 'text/javascript; charset=utf-8']],
  ['/overlay-client.js', ['overlay-client.js', 'text/javascript; charset=utf-8']],
  ['/crystal.svg', ['crystal.svg', 'image/svg+xml']],
]);
const header = (headers, name) => typeof headers[name] === 'string' ? headers[name] : '';
const result = (status, body = '', type = 'text/plain; charset=utf-8') => ({ status, body, type });

export function createApp({ secret, state = createMemoryState(), now = Date.now, oauth, chatContext, overlayFeed, releaseCommit } = {}) {
  const release = validateReleaseCommit(releaseCommit);
  // Pure request boundary for tests: rawBody is never reserialized before HMAC.
  async function dispatch({ method, path, headers = {}, rawBody = Buffer.alloc(0) }) {
    if (path.startsWith('/oauth/') || (oauth && path.split('?')[0] === oauth.callbackPath)) {
      if (!oauth) return result(503, 'OAuth not configured');
      return oauth.route({ method, path, headers });
    }
    if (method === 'GET' && path === '/health') {
      return result(200, JSON.stringify({ status: 'ok', releaseCommit: release, phase: 'foundation', readiness: 'not-ready-for-raids' }), 'application/json');
    }
    if (method === 'GET' && overlayFeed && path === `/api/overlay/${overlayFeed.channel}`) {
      return result(200, JSON.stringify(await overlayFeed.snapshot()), 'application/json');
    }
    if (method === 'GET' && overlayFeed && (path === `/overlay/${overlayFeed.channel}` || path === `/overlay/${overlayFeed.channel}?corner=1`)) {
      return result(200, await readFile(new URL('../public/overlay-live.html', import.meta.url)), 'text/html; charset=utf-8');
    }
    if (method === 'GET' && assets.has(path)) {
      const [file, type] = assets.get(path);
      return result(200, await readFile(new URL(`../public/${file}`, import.meta.url)), type);
    }
    if (path !== '/eventsub') return result(404, 'Not found');
    if (method !== 'POST') return result(405, 'Method not allowed');
    if (!secret) return result(503, 'Webhook secret not configured');
    if (!Buffer.isBuffer(rawBody)) return result(400, 'Expected raw bytes');
    if (rawBody.length > MAX_BODY_BYTES) return result(413, 'Body too large');
    const id = header(headers, 'twitch-eventsub-message-id');
    const timestamp = header(headers, 'twitch-eventsub-message-timestamp');
    const signature = header(headers, 'twitch-eventsub-message-signature');
    const type = header(headers, 'twitch-eventsub-message-type');
    if (!id || id.length > 256 || !/^sha256=[a-f0-9]{64}$/.test(signature)) return result(403, 'Invalid signature');
    const expected = createHmac('sha256', secret).update(id).update(timestamp).update(rawBody).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) return result(403, 'Invalid signature');
    const receivedAt = now();
    const sentAt = Date.parse(timestamp);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(timestamp)
      || !Number.isFinite(sentAt) || sentAt > receivedAt || receivedAt - sentAt > REPLAY_WINDOW_MS) return result(403, 'Outside replay window');
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)); }
    catch { return result(400, 'Invalid JSON'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return result(400, 'Invalid payload');
    if (type === 'webhook_callback_verification') {
      if (typeof payload.challenge !== 'string' || !payload.challenge) return result(400, 'Missing challenge');
      return result(200, payload.challenge);
    }
    if (type !== 'notification' && type !== 'revocation') return result(400, 'Unsupported message type');
    const subscription = payload.subscription;
    if (!subscription || typeof subscription.type !== 'string') return result(400, 'Missing subscription');
    let raid; let chat; let lifecycle;
    if (type === 'notification') {
      if (['stream.online', 'stream.offline'].includes(subscription.type)) {
        if (!chatContext || !state.lifecycleEnabled) return result(503, 'Lifecycle not configured');
        try { lifecycle = parseLifecycle(payload, chatContext.streamerId, sentAt); } catch { return result(400, 'Invalid lifecycle'); }
      } else if (subscription.type === 'channel.chat.message') {
        if (!chatContext) return result(503, 'Chat not configured');
        try { chat = parseChat(payload, { ...chatContext, includeMarkCommands: true }); } catch { return result(400, 'Invalid chat'); }
      } else {
        if (subscription.type !== 'channel.raid' || subscription.version !== '1') return result(400, 'Unsupported subscription');
        raid = payload.event;
        if (!raid || !['from_broadcaster_user_id', 'to_broadcaster_user_id'].every(key => typeof raid[key] === 'string' && /^\d+$/.test(raid[key]))
          || !Number.isInteger(raid.viewers) || raid.viewers < 0) return result(400, 'Invalid raid');
        if (chatContext && (subscription.condition?.to_broadcaster_user_id !== chatContext.streamerId || raid.to_broadcaster_user_id !== chatContext.streamerId)) return result(400, 'Invalid raid condition');
      }
    }
    const accepted = await state.accept({ id, now: receivedAt, sentAt, expiresAt: sentAt + REPLAY_WINDOW_MS, raid, chat, lifecycle });
    if (accepted === 'full') return result(503, 'Event capacity reached');
    return result(204);
  }

  async function handler(req, res) {
    const send = ({ status, body, type, headers: extraHeaders }) => {
      const headers = { ...extraHeaders, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      // 204 responses have no content or body framing headers.
      if (status === 204) {
        res.writeHead(status, headers);
        res.end();
        return;
      }
      headers['content-type'] = type;
      headers['content-length'] = Buffer.byteLength(body, 'utf8');
      res.writeHead(status, headers);
      res.end(body);
    };
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          send(result(413, 'Body too large'));
          return;
        }
        chunks.push(chunk);
      }
      send(await dispatch({ method: req.method, path: req.url, headers: req.headers, rawBody: Buffer.concat(chunks) }));
    } catch {
      if (!res.headersSent) send(result(500, 'Internal error'));
      else res.destroy();
    }
  }
  return { dispatch, handler, state, marks: createMarkService(state, { now }) };
}
