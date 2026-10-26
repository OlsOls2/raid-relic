// Dedicated local-only wrapper. Never imported by src/ or the production server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from './pilot-fixture.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
export const JUDGES_ORIGIN = 'http://127.0.0.1:5191';
const ids = [HOME, OTHER];
const actions = ['setup', 'mark', 'send', 'raid', 'offer', 'accept', 'forget', 'expire', 'closure', 'mymarks', 'echo', 'copycommand', 'reset'];
const assets = new Set(['/ritual-copy.js','/demo.js','/demo-state.js','/demo.css','/journey-map.js','/journey-map.css','/scoreboard.js', '/fonts.css', '/fonts/Cinzel.ttf', '/fonts/OFL-Cinzel.txt', '/control-view.js', '/atlas-hero.js', '/cinematic.js', '/relic3d.js', '/vendor/three.module.js', '/vendor/three.core.js', '/vendor/LICENSE-three.txt', '/claim-meter.js', '/forge.js', '/forge.css','/recap.js', '/recap.css','/atlas.css', '/atlas.js', '/overlay.css', '/overlay.js', '/overlay-client.js', '/overlay-audio.js', '/arrival.js', '/crystal.svg', '/relic.svg']);
const json = (status, value) => ({ status, type: 'application/json', body: JSON.stringify({ ...value, mode: 'simulator' }) });
const html = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SIMULATOR · Raid Relic judges</title><link rel="stylesheet" href="/judges/style.css"></head><body><header class="sim-label">SIMULATOR · LOCAL MEMORY ONLY · NO REAL TWITCH</header>${body}</body></html>`;
export async function createJudges({ intent = false, env = process.env } = {}) {
  if (intent !== true || env.NODE_ENV === 'production' || env.K_SERVICE !== undefined) throw new Error('Explicit local simulator intent required; cloud/production forbidden');
  // No env spread, credential lookup, SDK loader or real provider transport.
  const fresh = () => pilotFixture('memory', { chronicleEnv: { CHRONICLE_ENABLED: 'false', CHRONICLE_ALLOW_PAID: 'false' }, chronicleHTTP: () => { throw new Error('Provider forbidden'); }, forgeHTTP: () => { throw new Error('Provider forbidden'); } });
  let fixture = await fresh(), sockets, generation = 0, flags = {}, closed = false, queue = Promise.resolve(), tickAt = performance.now();
  const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, handler);
  const attach = () => attachOverlaySockets(server, fixture.runtime.overlayFeeds, { origins: [JUDGES_ORIGIN], allowRead: fixture.runtime.allowPublicRead });
  sockets = attach();
  const ordered = op => { const result = queue.then(op); queue = result.catch(() => {}); return result; };
  let ownSharePath = null;
  async function summary() {
    const registry = await fixture.runtime.state.getKeeperRegistry();
    const source = await fixture.runtime.pilot.status(HOME);
    const atlas = await fixture.runtime.state.getAtlasPage();
    const h = registry.pendingHop;
    return { ownSharePath, generation, flags: { ...flags }, source: `Simulated raidrelichq (${HOME})`, target: `Simulated olsols2 (${OTHER})`,
      holder: registry.holderId ? `Simulated ${registry.holderId}` : null, candidates: source.candidates.map(({ id, login }) => ({ id, label: `Simulated ${login}`, observedOnline: true })),
      intent: registry.send?.status ?? null, rings: atlas.rings, chronicle: 'Handwritten template · not AI · no key',
      handoff: h && (h.policy !== 'preclaim-v1' || h.verified) && !h.cancelled && fixture.now() < h.endsAt ? { completed: h.finalized === true, offers: h.offers?.length ?? h.threshold, accepts: h.accepts?.length ?? h.threshold, threshold: h.threshold } : null,
      clock: 'Synthetic receipt clock plus local elapsed time; explicit expiry advances it 180s, never Twitch synchronized.' };
  }
  async function step(action) {
    if (action === 'reset') { ownSharePath = null; const next = await fresh(); sockets.close(); fixture = next; generation++; flags = {}; tickAt = performance.now(); sockets = attach(); return; }
    if (action === 'setup') {
      if (flags.setup) throw Error('Already set up; reset for another run');
      for (const id of [BOT, HOME, OTHER]) await fixture.login(id);
      for (const id of ids) {
        const bootstrap = await fixture.control(id, 'bootstrap');
        if (bootstrap.status !== 200 || JSON.parse(bootstrap.body).ready !== true) throw Error('Mock bootstrap not ready');
        fixture.advance(); const keep = await fixture.control(id, 'keep');
        if (keep.status !== 200) throw Error('Mock Keep not processed'); fixture.advance();
      }
      flags.setup = true; return;
    }
    if (!flags.setup) throw Error('Run simulated setup first');
    if (action === 'mymarks') {
      if (!flags.accept || !flags.mark) throw Error('Complete the approved simulated carry first');
      await fixture.chat(HOME, '811', '!relic mymarks @VIEWER811');
      const doc = await fixture.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
      const row = doc.shares?.find(s => s.actor === '811'); if (!row) throw Error('No simulated share');
      ownSharePath = `/my-marks#${row.token}`; return;
    }
    if (action === 'echo' || action === 'copycommand') {
      const registry = await fixture.runtime.state.getKeeperRegistry();
      const view = await fixture.runtime.state.getOverlayState(OTHER, fixture.now());
      if (!flags.accept || !registry.pendingHop?.finalized || registry.holderId !== OTHER || !view.marks.length || view.status !== 'ready') throw Error('Complete an approved simulated carry first');
      flags.echoes = (flags.echoes ?? 0) + 1;
      if (flags.echoes > 8) throw Error('Reset to repeat the bounded demo');
      fixture.advance(10001);
      await fixture.signed('channel.chat.message', { broadcaster_user_id: OTHER, chatter_user_id: OTHER, message_id: `simulated-copy-${flags.echoes}`,
        source_broadcaster_user_id: HOME, source_message_id: `00000000-0000-4000-8000-${String(flags.echoes).padStart(12, '0')}`,
        badges: [{ set_id: 'moderator', id: '1' }], source_badges: [{ set_id: 'moderator', id: '1' }],
        message: { text: action === 'echo' ? 'moon' : '!relic pause', fragments: [] } }, OTHER, { broadcaster_user_id: OTHER, user_id: BOT });
      return;
    }
    if (action === 'closure') {
      if (!flags.accept || !(await fixture.runtime.state.getKeeperRegistry()).pendingHop?.finalized) throw Error('Complete the simulated two-chat carry first');
      flags.closures = (flags.closures ?? 0) + 1;
      if (flags.closures > 3) throw Error('Three simulated closures only; reset to repeat');
      fixture.advance(); await fixture.signed('stream.offline', { broadcaster_user_id: OTHER }, OTHER);
      fixture.advance(1000); await fixture.signed('stream.online', { broadcaster_user_id: OTHER, id: String(9500 + flags.closures), type: 'live', started_at: new Date(fixture.now()).toISOString() }, OTHER);
      return;
    }
    if (flags[action]) throw Error('Step already used; reset for another run');
    if (action === 'mark') {
      if (flags.send) throw Error('Add mark before Send Off');
      await fixture.chat(HOME, '811', '!mark moon'); await fixture.chat(HOME, HOME, '!relic approve m1');
    } else if (action === 'send') {
      const result = await fixture.control(HOME, `send:${OTHER}`);
      if (result.status !== 200 || JSON.parse(result.body).status !== 'accepted') throw Error('Mock Send Off not accepted');
    } else if (action === 'raid') {
      if (!flags.send) throw Error('Simulate API acceptance first'); fixture.advance(); await fixture.raid();
    } else if (action === 'offer' || action === 'accept') {
      if (!flags.raid || flags.expire) throw Error('Need unexpired simulated verified receipt');
      await fixture.chat(action === 'offer' ? HOME : OTHER, action === 'offer' ? HOME : OTHER, action === 'offer' ? '!offer' : '!accept');
    } else if (action === 'forget') {
      ownSharePath = null;
      if (!flags.mark) throw Error('Add the source mark first'); await fixture.chat(HOME, '811', '!relic forgetme');
    } else if (action === 'expire') {
      if (!flags.raid || flags.accept) throw Error('Expire before host acceptance');
      fixture.advance(180001); await fixture.chat(HOME, HOME, '!offer');
    }
    flags[action] = true; fixture.advance();
  }
  function labelPage(body, overlay = false) {
    let labelled = body.toString().replace(/<title>[^<]*<\/title>/, '<title>SIMULATOR · Raid Relic · local only</title>');
    if (overlay) return labelled.replace('id="simulator" hidden>Local simulator · test data', 'id="simulator">SIMULATOR · local only');
    labelled = labelled.replace(/<p class="note">.*?<\/p>/, '<p class="note">SIMULATOR: synthetic accounts and local memory only. No real consent, online assertion, raid, AI or cloud data.</p>').replace('Home Keeper private control', 'Simulated home control').replace('Second Keeper private control', 'Simulated second control');
    return labelled.replace('<body>', '<body><header style="background:#d5aa62;color:#101d30;padding:8px;font:700 13px system-ui;position:sticky;top:0;z-index:100">SIMULATOR · LOCAL MEMORY ONLY · NO REAL TWITCH</header>');
  }
  async function dispatch(input) {
    return ordered(async () => {
      const { method = 'GET', path = '/', headers = {}, rawBody = Buffer.alloc(0) } = input;
      const api = typeof path === 'string' && path.startsWith('/api/');
      const fail = (status, message) => api ? json(status, { error: message }) : { status, type: 'text/html; charset=utf-8', body: html(`<main><h1>Simulated request unavailable</h1><p>${message}</p><a href="/judges">Simulator console</a></main>`) };
      if (closed) return fail(503, 'Simulator stopped');
      if (headers.host !== '127.0.0.1:5191') return fail(421, 'Local host required');
      if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > 512) return fail(400, 'Invalid local path');
      if (method !== 'GET') {
        if (method !== 'POST' || !['/api/judges/action', '/api/atlas/search', '/api/my-marks', '/api/forge'].includes(path)) return fail(404, 'No such simulator action');
        if (headers.origin !== JUDGES_ORIGIN || headers['content-type'] !== 'application/json') return fail(403, 'Exact local Origin and JSON required');
        if (!Buffer.isBuffer(rawBody) || rawBody.length > 1024) return fail(400, 'Bounded JSON required');
      }
      const clock = performance.now(); fixture.advance(Math.max(0, Math.floor(clock - tickAt))); tickAt = clock;
      try {
        if (path === '/api/judges/action' && method === 'POST') {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody); const body = JSON.parse(text);
          if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || !actions.includes(body.action) || !/^\s*\{\s*"action"\s*:\s*"[a-z]+"\s*\}\s*$/.test(text)) return fail(400, 'Unknown fixed action');
          await step(body.action); return json(200, await summary());
        }
        if (path === '/api/judges/status' && method === 'GET') return json(200, await summary());
        if (path === '/judges' && method === 'GET') return { status: 200, type: 'text/html; charset=utf-8', body: await readFile(new URL('./judges/index.html', import.meta.url), 'utf8') };
        if (['/judges/app.js', '/judges/style.css'].includes(path) && method === 'GET') return { status: 200, type: path.endsWith('.js') ? 'text/javascript' : 'text/css', body: await readFile(new URL(`./judges/${path.endsWith('.js') ? 'app.js' : 'style.css'}`, import.meta.url), 'utf8') };
        if (/^\/control\/(1591805230|1591806023)$/.test(path) && method === 'GET') return { status: 200, type: 'text/html; charset=utf-8', body: html('<main><h1>Simulated Keeper control</h1><p>No real consent or online assertion. Fixed mock actors only; no browser tokens or actual OAuth.</p><a href="/judges">Open simulator step controls and observed eligible picker</a></main>') };
        const readable = /^\/demo\/?(?:\?.*)?$/.test(path) || /^\/atlas(?:\/embed)?\/?(?:\?.*)?$/.test(path) || assets.has(path) || ['/', '/atlas', '/atlas/', '/api/journey-map', '/api/atlas', '/api/scores', '/recap', '/api/recap', '/api/recap.svg', '/forge', '/api/forge'].includes(path) || /^\/stops\/[a-f0-9]{64}$/.test(path)
          || /^\/api\/atlas\/stops\/[a-f0-9]{64}(?:\?.*)?$/.test(path) || /^\/api\/atlas\?.*$/.test(path)
          || /^\/(?:api\/)?overlay\/(?:1591805230|1591806023)(?:\?.*)?$/.test(path) || ['/api/atlas/search', '/api/my-marks', '/my-marks', '/my-marks.js'].includes(path);
        if (!readable) return fail(404, 'Only local simulator pages are available');
        const response = await fixture.request(path, method, headers, rawBody);
        if (response.status >= 400) return fail(response.status, 'Simulated request rejected');
        if (response.type?.includes('application/json')) return json(response.status, JSON.parse(response.body));
        if (response.type?.includes('text/html')) return { ...response, body: /^\/demo\/?(?:\?.*)?$/.test(path)?response.body:labelPage(response.body, path.startsWith('/overlay/')) };
        if (path === '/atlas.js') return { ...response, body: response.body.toString().replace(/\b[Cc]hannel (?=\$\{)/g, 'Simulated channel ').replace('Owner-test raid pilot.', 'SIMULATOR · not live.') };
        return response;
      } catch { return fail(400, 'Simulated step unavailable; follow the console order or reset local memory'); }
    }).then(response => ({ ...response, headers: { ...response.headers, 'x-raid-relic-mode': 'simulator', 'cache-control': 'no-store' } }));
  }
  async function handler(req, res) {
    const headers = { 'x-raid-relic-mode': 'simulator', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; connect-src 'self' ws://127.0.0.1:5191; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; base-uri 'none'" };
    try {
      let size = 0; const chunks = []; for await (const chunk of req.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > 1024) break; chunks.push(chunk); }
      const response = await dispatch({ method: req.method, path: req.url, headers: req.headers, rawBody: size > 1024 ? Buffer.alloc(1025) : Buffer.concat(chunks) });
      res.writeHead(response.status, { ...headers, ...response.headers, 'content-type': response.type, 'content-length': Buffer.byteLength(response.body) }); res.end(response.body); if (size > 1024) req.resume();
    } catch { const error = req.url?.startsWith('/api/') ? json(500, { error: 'Simulator unavailable' }) : { type: 'text/html; charset=utf-8', body: html('<h1>SIMULATOR error · local only</h1>') }; res.writeHead(500, { ...headers, 'content-type': error.type }); res.end(error.body); }
  }
  return { dispatch, handler, server, async listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5191, '127.0.0.1', resolve); }); },
    async close() { await ordered(async () => { closed = true; sockets.close(); }); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); } };
}
