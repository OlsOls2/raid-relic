import { randomBytes } from 'node:crypto';
import { hash } from './crypto.js';

export function createControl({ store, keeperIds, origin, secure, now = Date.now }) {
  const name = id => `${secure ? '__Host-' : ''}rr_control_${id}`;
  const cookie = (id, value, age) => `${name(id)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const csrf = secret => hash(`control-csrf:${secret}`);
  async function session(id, headers) {
    if (!keeperIds.includes(id)) return null;
    const entries = (headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name(id)}=`));
    const secret = entries.length === 1 ? entries[0].slice(name(id).length + 1) : '';
    if (!/^[\w-]{43}$/.test(secret)) return null;
    const record = await store.getControlSession(id, hash(secret), now());
    return record?.keeperId === id && record.role === 'keeper' ? { ...record, secret } : null;
  }
  async function authorizePost({ keeperId, headers = {}, rawBody }, allowedActions = []) {
    if (headers.origin !== origin || headers['content-type'] !== 'application/json' || !Buffer.isBuffer(rawBody) || rawBody.length > 1024) return null;
    const record = await session(keeperId, headers); if (!record) return null;
    let body; try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)); } catch { return null; }
    if (!body || Object.keys(body).sort().join(',') !== 'action,csrf' || !allowedActions.includes(body.action)
      || typeof body.csrf !== 'string' || hash(body.csrf) !== record.csrfHash) return null;
    return { keeperId, action: body.action, sessionHash: hash(record.secret) };
  }
  const reply = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => ({ status, body, type,
    headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...extra } });
  return {
    async issue(id) {
      if (!keeperIds.includes(id)) throw new Error('Control authorization failed');
      const secret = randomBytes(32).toString('base64url');
      await store.createControlSession(id, { keeperId: id, role: 'keeper', sessionHash: hash(secret), csrfHash: hash(csrf(secret)), expiresAt: now() + 3600000 });
      return cookie(id, secret, 3600);
    }, authorizePost,
    async route({ path, method, headers = {}, rawBody }) {
      const match = /^\/control\/(\d{1,32})(\/status)?$/.exec(path);
      if (!match || !keeperIds.includes(match[1])) return reply(404, 'Not found');
      const id = match[1];
      try {
        if (method === 'POST' && !match[2]) {
          const auth = await authorizePost({ keeperId: id, headers, rawBody }, ['logout']);
          if (!auth || !await store.revokeControlSession(id, auth.sessionHash, now())) return reply(403, 'Control authorization required');
          return reply(200, 'Control session ended; Twitch authorization unchanged', undefined, { 'set-cookie': cookie(id, '', 0) });
        }
        if (method !== 'GET') return reply(405, 'Method not allowed');
        const record = await session(id, headers);
        if (!record) return reply(401, `<p>Keeper authorization required.</p><a href="/oauth/keeper/${id}/start">Connect this Keeper</a>`, 'text/html; charset=utf-8');
        if (match[2]) return reply(200, JSON.stringify({ keeperId: id, expiresAt: record.expiresAt, csrf: csrf(record.secret), actions: ['logout'] }), 'application/json');
        return reply(200, `<h1>Keeper control</h1><p>Authenticated Keeper ${id}.</p><p>Worker and subscription bootstrap actions are not available yet.</p><a href="/control/${id}/status">Private session status</a>`, 'text/html; charset=utf-8');
      } catch { return reply(403, 'Control authorization required'); }
    },
  };
}
