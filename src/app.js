import { canonicalLogin, shareRequestHash } from './my-marks.js';
import { parseBan } from './bans.js';
import { ackKey } from './claim-ack.js';
import { matchesSubscriptionCondition } from './subscriptions.js';
import { strictJSON, templateDesign, forgeResult } from './forge.js';
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
  ['/journey-map.js', ['journey-map.js', 'text/javascript; charset=utf-8']],
  ['/journey-map.css', ['journey-map.css', 'text/css; charset=utf-8']],
  ['/scoreboard.js', ['scoreboard.js', 'text/javascript; charset=utf-8']],
  ['/fonts.css', ['fonts.css', 'text/css; charset=utf-8']],
  ['/fonts/Cinzel.ttf', ['fonts/Cinzel.ttf', 'font/ttf']],
  ['/fonts/OFL-Cinzel.txt', ['fonts/OFL-Cinzel.txt', 'text/plain; charset=utf-8']],
  ['/control-view.js', ['control-view.js', 'text/javascript; charset=utf-8']],
  ['/control-read.js', ['control-read.js', 'text/javascript; charset=utf-8']],
  ['/cinematic.js', ['cinematic.js', 'text/javascript; charset=utf-8']],
  ['/relic3d.js', ['relic3d.js', 'text/javascript; charset=utf-8']],
  ['/vendor/three.module.js', ['vendor/three.module.js', 'text/javascript; charset=utf-8']],
  ['/vendor/three.core.js', ['vendor/three.core.js', 'text/javascript; charset=utf-8']],
  ['/vendor/LICENSE-three.txt', ['vendor/LICENSE-three.txt', 'text/plain; charset=utf-8']],
  ['/claim-meter.js', ['claim-meter.js', 'text/javascript; charset=utf-8']],
  ['/my-marks.js', ['my-marks.js', 'text/javascript; charset=utf-8']],
  ['/', ['atlas.html', 'text/html; charset=utf-8']],
  ['/atlas', ['atlas.html', 'text/html; charset=utf-8']],
  ['/atlas/', ['atlas.html', 'text/html; charset=utf-8']],
  ['/forge.css', ['forge.css', 'text/css; charset=utf-8']],
  ['/forge.js', ['forge.js', 'text/javascript; charset=utf-8']],
  ['/forge-owner.js', ['forge-owner.js', 'text/javascript; charset=utf-8']],
  ['/recap.css', ['recap.css', 'text/css; charset=utf-8']],
  ['/recap.js', ['recap.js', 'text/javascript; charset=utf-8']],
  ['/atlas.css', ['atlas.css', 'text/css; charset=utf-8']],
  ['/atlas-hero.js', ['atlas-hero.js', 'text/javascript; charset=utf-8']],
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
const demoAssets=new Map([['/demo','demo.html'],['/demo/','demo.html'],['/demo.js','demo.js'],['/demo-state.js','demo-state.js'],['/demo.css','demo.css'],['/ritual-copy.js','ritual-copy.js']]);
const header = (headers, name) => typeof headers[name] === 'string' ? headers[name] : '';
const result = (status, body = '', type = 'text/plain; charset=utf-8') => ({ status, body, type });

export function createApp({ scoreAcks, claimAcks, secret, state = createMemoryState(), now = Date.now, oauth, chatContext, overlayFeed, overlayFeeds, raidPilot = false, previewReadOnly = false, releaseCommit, shares, replies, banAuthorized, publicBudget = { burst: 60, perSecond: 1 } } = {}) {
  const keepers = chatContext?.keeperIds ?? (chatContext ? [chatContext.streamerId] : []);
  if (!Array.isArray(keepers) || keepers.length > 4 || (chatContext && !keepers.length)
    || !keepers.every(id => typeof id === 'string' && /^\d{1,32}$/.test(id))
    || (chatContext && !keepers.includes(chatContext.streamerId))) throw new Error('Configured Keeper allowlist required');
  let credits = publicBudget.burst; let budgetAt = now();
  const spend = () => { const time = now(); credits = Math.min(publicBudget.burst, credits + Math.max(0, time - budgetAt) / 1000 * publicBudget.perSecond); budgetAt = time;
    if (credits < 1) return false; credits--; return true; };
  const release = validateReleaseCommit(releaseCommit);
  const publicHTML=async file=>{const bytes=await readFile(new URL(`../public/${file}`,import.meta.url));return overlayFeed?.simulator?bytes.toString().replace(/<p([^>]*\bid="simulator"[^>]*)><\/p>/,(_,attrs)=>`<p${attrs.replace(/\s+hidden\b/,'')}>SIMULATOR · local test data</p>`):bytes;};
  // Pure request boundary for tests: rawBody is never reserialized before HMAC.
  async function dispatch({ method, path, headers = {}, rawBody = Buffer.alloc(0) }) {
    const demoPath=path.split('?')[0];
    if(demoAssets.has(demoPath)){
      if(method!=='GET')return result(previewReadOnly?403:405,'Static demo is read only');
      const file=demoAssets.get(demoPath),type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8';
      if(path.includes('?')&&!file.endsWith('.html'))return result(400,'Invalid static asset query');
      return{...result(200,await readFile(new URL(`../public/${file}`,import.meta.url)),type),headers:{'cache-control':'public, max-age=3600','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"}};
    }
    if (method === 'GET' && path === '/health') {
      return result(200, JSON.stringify({status:'ok',releaseCommit:release,phase:raidPilot?'live':'foundation',...(!raidPilot?{readiness:'not-ready-for-raids'}:{}),mode:overlayFeed?.simulator?'simulator':'live',...(previewReadOnly?{preview:'Read-only preview'}:{})}), 'application/json');
    }
    // Preview shares live storage: deny before authentication, DB access or effects.
    if (previewReadOnly && (method !== 'GET' || path.startsWith('/control/') || path.startsWith('/oauth/') || path.split('?')[0] === '/auth/callback' || path.split('?')[0] === '/eventsub')) return { ...result(403, 'P5 read-only preview. Live chat commands are not enabled on canonical yet.'), headers: { 'cache-control': 'no-store' } };
    if ((path.startsWith('/control/') || path.startsWith('/api/') || path.split('?')[0] === '/auth/callback' || path.startsWith('/oauth/')) && !spend()) return result(429, 'Public request budget reached; retry later');
    if (path.startsWith('/control/')) {
      if (!oauth?.control) return result(503, 'Control not configured');
      return oauth.control.route({ path, method, headers, rawBody });
    }
    if (path.startsWith('/oauth/') || (oauth && path.split('?')[0] === oauth.callbackPath)) {
      if (!oauth) return result(503, 'OAuth not configured');
      return oauth.route({ method, path, headers });
    }
    if (path.startsWith('/api/journey-map')) {
      if (path !== '/api/journey-map' || rawBody.length) return result(400, 'Invalid journey request');
      if (method !== 'GET') return result(405, 'Read only');
      try { const body = JSON.stringify({...await state.getJourneyMap(now()),mode:overlayFeed?.simulator ? 'simulator' : 'live'});
        if (Buffer.byteLength(body)>32768) throw Error();
        return {...result(200,body,'application/json'),headers:{'cache-control':'no-store'}};
      } catch { return result(503,'Journey unavailable; clear previous data'); }
    }
    if (/^\/atlas(?:\/embed)?(?:\/)?(?:\?.*)?$/.test(path)) {
      if (method !== 'GET') return result(405,'Read only');
      const embed=path.split('?')[0].replace(/\/$/,'')==='/atlas/embed', params=new URLSearchParams(path.split('?')[1] ?? '');
      if ([...params].some(([k,v])=>params.getAll(k).length!==1 || (k==='t' ? !/^[a-f0-9]{64}$/.test(v) : !(embed && k==='play' && v==='1')))) return result(400,'Invalid journey selection');
      return {...result(200,await publicHTML(embed?'journey-embed.html':'atlas.html'),'text/html; charset=utf-8'),headers:{'cache-control':'no-store'}};
    }
    if (path.startsWith('/api/scores')) {
      if (path !== '/api/scores' || rawBody.length) return result(400, 'Invalid score request');
      if (method !== 'GET') return result(405, 'Read only');
      try { return { ...result(200, JSON.stringify({ ...await state.getScoreboard(now()), mode: overlayFeed?.simulator ? 'simulator' : 'live', previewReadOnly }), 'application/json'), headers: { 'cache-control': 'no-store' } }; }
      catch { return result(503, 'Scores unavailable; previous content must be cleared'); }
    }
    if (path === '/my-marks') {
      if (method !== 'GET') return result(405, 'Read only');
      return { ...result(200, await readFile(new URL('../public/my-marks.html', import.meta.url)), 'text/html; charset=utf-8'), headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'; base-uri 'none'" } };
    }
    if (path.startsWith('/api/my-marks')) {
      if (path !== '/api/my-marks' || method !== 'POST') return result(400, 'Invalid shared history request');
      try {
        if (!shares || headers['content-type'] !== 'application/json') throw Error();
        const body = strictJSON(rawBody);
        if (!body || Object.keys(body).some(k => !['capability', 'offset', 'limit', 'login'].includes(k))) throw Error();
        const payload = shares.open(body.capability), offset = Object.hasOwn(body, 'offset') ? body.offset : 0, limit = Object.hasOwn(body, 'limit') ? body.limit : 20;
        if (Object.hasOwn(body, 'login') && canonicalLogin(body.login) !== payload.login) throw Error();
        if (!Number.isInteger(offset) || offset < 0 || offset > 2560 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw Error();
        return { ...result(200, JSON.stringify({ ...await state.getOwnMarks(payload, now(), offset, limit), mode: overlayFeed?.simulator ? 'simulator' : 'live' }), 'application/json'), headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } };
      } catch { return result(403, 'Shared history unavailable or expired; previous content must be cleared'); }
    }
    if (path === '/forge') {
      if (method !== 'GET') return result(405, 'Read only');
      return result(200, await readFile(new URL('../public/forge.html', import.meta.url)), 'text/html; charset=utf-8');
    }
    if (path.startsWith('/api/forge')) {
      if (path !== '/api/forge') return result(400, 'Invalid Forge path');
      if (method !== 'POST') return result(405, 'Template requires read-only POST');
      if (headers['content-type'] !== 'application/json') return result(400, 'Invalid Forge request');
      try { const body = strictJSON(rawBody); if (!body || Object.keys(body).join(',') !== 'description') return result(400, 'Invalid Forge request');
        return result(200, JSON.stringify(forgeResult(templateDesign(body.description), 'template', overlayFeed?.simulator === true)), 'application/json');
      } catch { return result(400, 'Invalid Forge description'); }
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
        return page ? result(200, JSON.stringify({ ...page, pilotEnabled: raidPilot, ...(previewReadOnly ? { previewReadOnly: true } : {}), mode: overlayFeed?.simulator ? 'simulator' : 'live' }), 'application/json') : result(404, 'Stop not found');
      } catch { return result(503, 'Atlas unavailable; clear previous data and refresh later'); }
    }
    if (/^\/stops\/[a-f0-9]{64}$/.test(path)) {
      if (method !== 'GET') return result(405, 'Read only');
      return result(200, await publicHTML('atlas.html'), 'text/html; charset=utf-8');
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
      return result(200, await publicHTML('overlay-live.html'), 'text/html; charset=utf-8');
    }
    if (method === 'GET' && assets.has(path)) {
      const [file, type] = assets.get(path);
      const bytes = file.endsWith('.html')?await publicHTML(file):await readFile(new URL(`../public/${file}`, import.meta.url));
      return result(200, bytes, type);
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
      if (subscription.type === 'channel.ban') {
        if (!context || !state.lifecycleEnabled) return result(400, 'Invalid ban channel');
        try { lifecycle = parseBan(payload, signedHost, sentAt); if (!banAuthorized || !await banAuthorized(signedHost)) return result(403, 'Ban capability unavailable'); } catch { return result(400, 'Invalid ban event'); }
      } else if (['stream.online', 'stream.offline'].includes(subscription.type)) {
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
          const incoming = matchesSubscriptionCondition('channel.raid', condition, { to_broadcaster_user_id: raid.to_broadcaster_user_id }) && keepers.includes(condition.to_broadcaster_user_id) && raid.to_broadcaster_user_id === condition.to_broadcaster_user_id;
          const outgoing = matchesSubscriptionCondition('channel.raid', condition, { from_broadcaster_user_id: raid.from_broadcaster_user_id }) && keepers.includes(condition.from_broadcaster_user_id) && raid.from_broadcaster_user_id === condition.from_broadcaster_user_id;
          if (!incoming && !outgoing) return result(400, 'Invalid raid condition');
        }
      }
    }
    const share = chat?.markAction?.type === 'mymarks' && shares && !chat.isBot && !chat.copied && chat.chatterLogin && (!chat.markAction.login || chat.markAction.login === chat.chatterLogin) ? shares.issue(chat.broadcasterId, chat.chatterId, receivedAt, chat.chatterLogin) : undefined;
    const accepted = await state.accept({ share, id, now: receivedAt, sentAt, expiresAt: sentAt + REPLAY_WINDOW_MS, raid, chat, lifecycle });
    if(accepted?.commandReply&&['capacity','budget','cooldown-quiet','policy-blocked'].includes(accepted.commandReply.reason)){const kind=['top','badges','help','scores-on','scores-off','offer','accept','mark','mymarks','forgetme','pause','keep','opt-out','approve','block','send','veto-last'].includes(accepted.commandReply.kind)?accepted.commandReply.kind:'other';try{console.warn(JSON.stringify({event:'command_reply',host:chat.broadcasterId,kind,outcome:'suppressed',reason:accepted.commandReply.reason,httpStatus:null}));}catch{}}
    if (accepted === 'full') return result(503, 'Event capacity reached');
    if(claimAcks&&Array.isArray(accepted?.completionAcks))for(const row of accepted.completionAcks.slice(0,2)){try{await claimAcks.process(row.host,row.key);}catch{}}
    if(accepted?.completionSkipped){try{console.warn(JSON.stringify({severity:'WARNING',event:'raid_relic_completion_ack_capacity',skipped:Math.min(2,accepted.completionSkipped)}));}catch{}}
    // Exact proven request only; duplicates can recover an unclaimed row, never another viewer's.
    if (share && replies) {
      try { await replies.processPending(chat.broadcasterId, shareRequestHash(chat)); } catch { /* No sensitive diagnostics or post-response worker. */ }
    }
    if (scoreAcks && chat && !chat.isBot && !chat.copied && Boolean(chat.markAction)) { try { await scoreAcks.process(chat.broadcasterId, ackKey(chat)); } catch {} }
    if (claimAcks && chat && !chat.isBot && !chat.copied && ['offer', 'accept'].includes(chat.markAction?.type)) {
      try { await claimAcks.process(chat.broadcasterId, ackKey(chat)); } catch {}
    }
    return result(204);
  }

  async function handler(req, res) {
    const send = ({ status, body, type, headers: extraHeaders }) => {
      const headers = { ...extraHeaders, 'cache-control': req.method==='GET'&&demoAssets.has(req.url.split('?')[0])&&extraHeaders?.['cache-control']==='public, max-age=3600'?'public, max-age=3600':'no-store', 'x-content-type-options': 'nosniff' };
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
