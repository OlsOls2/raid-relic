import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMemoryState } from './state.js';

export const MAX_BODY_BYTES = 65536;
export const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const assets = new Map([
  ['/', ['atlas.html', 'text/html; charset=utf-8']],
  ['/overlay', ['overlay.html', 'text/html; charset=utf-8']],
  ['/relic.svg', ['relic.svg', 'image/svg+xml']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const header = (headers, name) => typeof headers[name] === 'string' ? headers[name] : '';
const result = (status, body = '', type = 'text/plain; charset=utf-8') => ({ status, body, type });

export function createApp({ secret, state = createMemoryState(), now = Date.now } = {}) {
  // Pure request boundary for tests: rawBody is never reserialized before HMAC.
  async function dispatch({ method, path, headers = {}, rawBody = Buffer.alloc(0) }) {
    if (method === 'GET' && path === '/health') {
      return result(200, JSON.stringify({ status: 'ok' }), 'application/json');
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
    let raid;
    if (type === 'notification') {
      if (subscription.type !== 'channel.raid' || subscription.version !== '1') return result(400, 'Unsupported subscription');
      raid = payload.event;
      if (!raid || !['from_broadcaster_user_id', 'to_broadcaster_user_id'].every(key => typeof raid[key] === 'string' && /^\d+$/.test(raid[key]))
        || !Number.isInteger(raid.viewers) || raid.viewers < 0) return result(400, 'Invalid raid');
    }
    const accepted = await state.accept({ id, now: receivedAt, expiresAt: sentAt + REPLAY_WINDOW_MS, raid });
    if (accepted === 'full') return result(503, 'Event capacity reached');
    return result(204);
  }

  async function handler(req, res) {
    const send = ({ status, body, type }) => {
      const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
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
  return { dispatch, handler, state };
}
