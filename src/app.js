import { recapSVG } from './recap.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMemoryState } from './state.js';
import { parseChat } from './bot.js';
import { createMarkService, normalizeMark } from './marks.js';
import { validateReleaseCommit } from './release.js';
import { parseLifecycle } from './lifecycle.js';

export const MAX_BODY_BYTES = 65536;
export const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const assets = new Map([
  ['/', ['atlas.html', 'text/html; charset=utf-8']],
  ['/atlas', ['atlas.html', 'text/html; charset=utf-8']],
  ['/atlas/', ['atlas.html', 'text/html; charset=utf-8']],
  ['/recap.css', ['recap.css', 'text/css; charset=utf-8']],
  ['/recap.js', ['recap.js', 'text/javascript; charset=utf-8']],
  ['/atlas.css', ['atlas.css', 'text/css; charset=utf-8']],
  ['/atlas.js', ['atlas.js', 'text/javascript; charset=utf-8']],
  ['/control.js', ['control.js', 'text/javascript; charset=utf-8']],
  ['/control.css', ['control.css', 'text/css; charset=utf-8']],
  ['/overlay-audio.js', ['overlay-audio.js', 'text/javascript; charset=utf-8']],
  ['/arrival.js', ['arrival.js', 'text/javascript; charset=utf-8']],
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

export function createApp({ secret, state = createMemoryState(), now = Date.now, oauth, chatContext, overlayFeed, overlayFeeds, raidPilot = false, releaseCommit, publicBudget = { burst: 60, perSecond: 1 } } = {}) {
  const keepers = chatContext?.keeperIds ?? (chatContext ? [chatContext.streamerId] : []);
  if (!Array.isArray(keepers) || keepers.length > 4 || (chatContext && !keepers.length)
    || !keepers.every(id => typeof id === 'string' && /^\d{1,32}$/.test(id))
    || (chatContext && !keepers.includes(chatContext.streamerId))) throw new Error('Configured Keeper allowlist required');
  let credits = publicBudget.burst; let budgetAt = now();
  const spend = () => { const time = now(); credits = Math.min(publicBudget.burst, credits + Math.max(0, time - budgetAt) / 1000 * publicBudget.perSecond); budgetAt = time;
    if (credits < 1) return false; credits--; return true; };
  const release = validateReleaseCommit(releaseCommit);
  // Pure request boundary for tests: rawBody is never reserialized before HMAC.
  async function dispatch({ method, path, headers = {}, rawBody = Buffer.alloc(0) }) {
    if ((path.startsWith('/control/') || path.startsWith('/api/') || path.split('?')[0] === '/auth/callback' || path.startsWith('/oauth/')) && !spend()) return result(429, 'Public request budget reached; retry later');
    if (path.startsWith('/control/')) {
      if (!oauth?.control) return result(503, 'Control not configured');
      return oauth.control.route({ path, method, headers, rawBody });
    }
    if (path.startsWith('/oauth/') || (oauth && path.split('?')[0] === oauth.callbackPath)) {
      if (!oauth) return result(503, 'OAuth not configured');
      return oauth.route({ method, path, headers });
    }
    if (method === 'GET' && path === '/health') {
      return result(200, JSON.stringify({ status: 'ok', releaseCommit: release, phase: raidPilot ? 'raid-pilot' : 'foundation', readiness: raidPilot ? 'owner-test-ready' : 'not-ready-for-raids', ...(raidPilot ? { liveValidated: false } : {}) }), 'application/json');
    }
    if ((path.startsWith('/recap') && !['/recap.js', '/recap.css'].includes(path)) || path.startsWith('/api/recap')) {
      if (!['/recap', '/api/recap', '/api/recap.svg'].includes(path)) return result(400, 'Invalid recap path');
      if (method !== 'GET') return result(405, 'Read only');
      if (!Buffer.isBuffer(rawBody) || rawBody.length) return result(400, 'No request body');
      if (path === '/recap') return result(200, await readFile(new URL('../public/recap.html', import.meta.url)), 'text/html; charset=utf-8');
      try {
        const projection = await state.getRecap(); const simulator = overlayFeed?.simulator === true;
        const svg = recapSVG(projection, { simulator });
        if (path.endsWith('.svg')) return { ...result(200, svg, 'image/svg+xml'), headers: { 'content-disposition': 'attachment; filename="raid-relic-recap.svg"', 'content-security-policy': "default-src 'none'; sandbox" } };
        return result(200, JSON.stringify({ ...projection, svg, mode: simulator ? 'simulator' : 'live' }), 'application/json');
      } catch { return result(503, 'Recap unavailable; previous snapshot must be cleared'); }
    }
    if (path.startsWith('/api/atlas/search')) {
      if (path !== '/api/atlas/search') return result(400, 'Invalid search path');
      if (method !== 'POST') return result(405, 'Search requires read-only POST');
      if (headers['content-type'] !== 'application/json' || !Buffer.isBuffer(rawBody) || rawBody.length > 1024) return result(400, 'Invalid search request');
      let body; try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody); body = JSON.parse(text);
        if (!body || Array.isArray(body) || Object.keys(body).some(key => !['query', 'offset', 'limit'].includes(key))
          || (text.match(/"(?:query|offset|limit)"\s*:/g) ?? []).length !== Object.keys(body).length) return result(400, 'Invalid search request');
      } catch { return result(400, 'Invalid search request'); }
      const query = normalizeMark(body.query), offset = Object.hasOwn(body, 'offset') ? body.offset : 0, limit = Object.hasOwn(body, 'limit') ? body.limit : 20;
      if (!query || !Number.isInteger(offset) || offset < 0 || offset > 2560 || !Number.isInteger(limit) || limit < 1 || limit > 20) return result(400, 'Invalid search request');
      try { return result(200, JSON.stringify({ ...await state.searchPublicMarks({ query, offset, limit }), mode: overlayFeed?.simulator ? 'simulator' : 'live' }), 'application/json'); }
      catch { return result(503, 'Search unavailable; previous matches must be cleared'); }
    }
    if (path.startsWith('/api/atlas')) {
      if (method !== 'GET') return result(405, 'Read only');
      const match = /^\/api\/atlas(?:\/stops\/([a-f0-9]{64}))?(?:\?([^#]*))?$/.exec(path);
      if (!match) return result(400, 'Invalid Atlas path');
      const params = new URLSearchParams(match[2] ?? '');
      if ([...params.keys()].some(key => !['offset', 'limit'].includes(key)) || [...params.keys()].some(key => params.getAll(key).length !== 1)) return result(400, 'Invalid paging');
      const number = (key, fallback, max) => { const v = params.get(key); if (v === null) return fallback; return /^(0|[1-9]\d{0,2})$/.test(v) && Number(v) <= max ? Number(v) : NaN; };
      const offset = number('offset', 0, match[1] ? 160 : 16); const limit = number('limit', match[1] ? 20 : 8, match[1] ? 20 : 8);
      if (!Number.isInteger(offset) || !Number.isInteger(limit) || limit < 1) return result(400, 'Invalid paging');
      try {
        const page = await state.getAtlasPage({ stopId: match[1], offset, limit });
        return page ? result(200, JSON.stringify({ ...page, pilotEnabled: raidPilot, mode: overlayFeed?.simulator ? 'simulator' : 'live' }), 'application/json') : result(404, 'Stop not found');
      } catch { return result(503, 'Atlas unavailable; clear previous data and refresh later'); }
    }
    if (/^\/stops\/[a-f0-9]{64}$/.test(path)) {
      if (method !== 'GET') return result(405, 'Read only');
      return result(200, await readFile(new URL('../public/atlas.html', import.meta.url)), 'text/html; charset=utf-8');
    }
    if (path === '/api/journey') {
      if (method !== 'GET') return result(404, 'Read only');
      try { return result(200, JSON.stringify(await state.getAtlasPage({ offset: 0, limit: 8 })), 'application/json'); }
      catch { return result(503, 'Atlas unavailable'); }
    }
    const feedPath = /^(\/api)?\/overlay\/(\d{1,32})(?:\?(.*))?$/.exec(path);
    if (feedPath) {
      const selected = (overlayFeeds ?? (overlayFeed ? { [overlayFeed.channel]: overlayFeed } : {}))[feedPath[2]];
      if (!selected) return result(404, 'Not found');
      if (method !== 'GET') return result(404, 'Read only');
      const params = new URLSearchParams(feedPath[3] ?? '');
      if (feedPath[1] && feedPath[3] !== undefined) return result(400, 'Invalid query');
      if ([...params].some(([key, value]) => !['corner', 'sound'].includes(key) || params.getAll(key).length !== 1
        || (key === 'corner' ? value !== '1' : !['0', '1'].includes(value)))) return result(400, 'Invalid query');
      if (feedPath[1]) return result(200, JSON.stringify(await selected.snapshot()), 'application/json');
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
    const signedHost = subscription.condition?.broadcaster_user_id;
    const context = chatContext && keepers.includes(signedHost) ? { ...chatContext, streamerId: signedHost } : null;
    if (type === 'notification') {
      if (['stream.online', 'stream.offline'].includes(subscription.type)) {
        if (!chatContext || !state.lifecycleEnabled) return result(503, 'Lifecycle not configured');
        if (!context) return result(400, 'Unconfigured lifecycle channel');
        try { lifecycle = parseLifecycle(payload, context?.streamerId, sentAt); } catch { return result(400, 'Invalid lifecycle'); }
      } else if (subscription.type === 'channel.chat.message') {
        if (!chatContext) return result(503, 'Chat not configured');
        if (!context) return result(400, 'Unconfigured chat channel');
        try { chat = parseChat(payload, { ...context, includeMarkCommands: true }); } catch { return result(400, 'Invalid chat'); }
      } else {
        if (subscription.type !== 'channel.raid' || subscription.version !== '1') return result(400, 'Unsupported subscription');
        raid = payload.event;
        if (!raid || !['from_broadcaster_user_id', 'to_broadcaster_user_id'].every(key => typeof raid[key] === 'string' && /^\d+$/.test(raid[key]))
          || !Number.isInteger(raid.viewers) || raid.viewers < 0 || raid.viewers > 1000000) return result(400, 'Invalid raid');
        if (chatContext) {
          const condition = subscription.condition ?? {};
          const incoming = Object.keys(condition).length === 1 && keepers.includes(condition.to_broadcaster_user_id) && raid.to_broadcaster_user_id === condition.to_broadcaster_user_id;
          const outgoing = Object.keys(condition).length === 1 && keepers.includes(condition.from_broadcaster_user_id) && raid.from_broadcaster_user_id === condition.from_broadcaster_user_id;
          if (!incoming && !outgoing) return result(400, 'Invalid raid condition');
        }
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
  return { dispatch, handler, state, allowPublicRead: spend, marks: createMarkService(state, { now }) };
}
