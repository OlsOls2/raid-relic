import { createControl } from './control.js';
import { randomBytes } from 'node:crypto';
import { hash, createTokenCipher } from './crypto.js';

export const SCOPES = Object.freeze({ streamer: Object.freeze(['channel:bot', 'channel:manage:raids']), bot: Object.freeze(['user:read:chat', 'user:write:chat', 'user:bot']) });
const nonce = () => randomBytes(32).toString('base64url');
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export async function httpTransport(url, options) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000), redirect: 'error' });
    return { status: response.status, data: await response.json() };
  } catch { throw new Error('Upstream request failed'); }
}

export function createOAuth({ clientId, clientSecret, redirectUri, redirectAllowlist, streamerId, botId, keeperIds = [streamerId], encryptionKey, store,
  transport = httpTransport, now = Date.now, production = false }) {
  if (!clientId || !clientSecret || !store || !/^\d+$/.test(streamerId ?? '') || !/^\d+$/.test(botId ?? '') || streamerId === botId) throw new Error('OAuth configuration required');
  const redirect = new URL(redirectUri);
  if (!Array.isArray(redirectAllowlist) || !redirectAllowlist.includes(redirectUri) || redirect.href !== redirectUri || !['/auth/callback', '/oauth/callback'].includes(redirect.pathname)
    || redirect.search || redirect.hash || redirect.username || redirect.password
    || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && redirect.hostname === 'localhost' && !production))) throw new Error('Invalid OAuth redirect configuration');
  const cipher = createTokenCipher(encryptionKey);
  if (!Array.isArray(keeperIds) || !keeperIds.includes(streamerId) || keeperIds.length > 2 || new Set(keeperIds).size !== keeperIds.length
    || (keeperIds.length > 1 && (streamerId !== '1591805230' || botId !== '1591804828' || !keeperIds.every(id => ['1591805230', '1591806023'].includes(id))))
    || !keeperIds.every(id => typeof id === 'string' && /^\d{1,32}$/.test(id) && id !== botId)) throw new Error('Explicit Keeper accounts required');
  const accounts = { streamer: streamerId, bot: botId, ...Object.fromEntries(keeperIds.filter(id => id !== streamerId).map(id => [`keeper:${id}`, id])) };
  const scopes = role => role === 'bot' ? SCOPES.bot : SCOPES.streamer;
  const validRole = role => Object.hasOwn(accounts, role);
  const secure = redirect.protocol === 'https:';
  const control = createControl({ store, keeperIds, origin: redirect.origin, secure, now });
  const cookieName = secure ? '__Host-rr_oauth' : 'rr_oauth';
  const cookie = (value, age) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const context = role => `${clientId}:${role}:${accounts[role]}`;
  const safeCall = async (url, options) => {
    try { return await transport(url, options); } catch { throw new Error('Twitch request failed'); }
  };
  async function exchange(parameters) {
    const response = await safeCall(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...parameters }).toString() });
    const token = response.data;
    if (response.status !== 200 || !token || typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' || !token.refresh_token
      || token.token_type?.toLowerCase() !== 'bearer') throw new Error('Token exchange failed');
    return { access_token: token.access_token, refresh_token: token.refresh_token };
  }
  async function validate(token, role) {
    const response = await safeCall('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token.access_token}` } });
    if (response.status === 401) return false;
    const data = response.data;
    if (response.status !== 200 || data?.client_id !== clientId || data.user_id !== accounts[role] || !Array.isArray(data.scopes)
      || !scopes(role).every(scope => data.scopes.includes(scope)) || !(data.expires_in > 0)) throw new Error('Token identity or grants invalid');
    return true;
  }
  async function locked(role, operation) {
    const owner = nonce();
    if (!await store.acquire(role, owner, now())) throw new Error('Token operation busy; retry later');
    try { return await operation(owner); } finally { await store.release(role, owner); }
  }
  async function accessToken(role, { refresh = false } = {}) {
    if (!validRole(role)) throw new Error('Invalid role');
    // A distributed lease serializes rotated refresh tokens across instances.
    return locked(role, async owner => {
      const record = await store.getToken(role);
      if (!record) throw new Error('Authorization required');
      let token = cipher.open(record, context(role));
      if (refresh || !await validate(token, role)) {
        token = await exchange({ grant_type: 'refresh_token', refresh_token: token.refresh_token });
        if (!await validate(token, role)) throw new Error('Authorization required');
        await store.saveToken(role, cipher.seal(token, context(role)), owner, now());
      }
      return token.access_token;
    });
  }
  async function route({ path, method, headers }) {
    const response = (status, body, extra = {}) => ({ status, body, type: 'text/plain; charset=utf-8', headers: { 'referrer-policy': 'no-referrer', 'content-security-policy': "frame-ancestors 'none'; base-uri 'none'", 'x-frame-options': 'DENY', ...extra } });
    try {
      const url = new URL(path, redirect.origin);
      const keeperMatch = /^\/oauth\/keeper\/(\d{1,32})\/start$/.exec(url.pathname);
      const match = /^\/oauth\/(streamer|bot)\/start$/.exec(url.pathname);
      if (method !== 'GET') return response(405, 'Method not allowed');
      if (match || keeperMatch) {
        if (url.search) return response(400, 'Invalid authorization request');
        const id = keeperMatch?.[1];
        if (id && !keeperIds.includes(id)) return response(404, 'Not found');
        const role = id ? (id === streamerId ? 'streamer' : `keeper:${id}`) : match[1]; const state = nonce(); const browser = nonce();
        await store.createState(hash(state), { binding: hash(browser), role, expiresAt: now() + 300000 }, now());
        const auth = new URL('https://id.twitch.tv/oauth2/authorize');
        auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: scopes(role).join(' '), state, force_verify: 'true' }).toString();
        return response(302, '', { location: auth.href, 'set-cookie': cookie(browser, 300) });
      }
      if (url.pathname !== redirect.pathname || path.split('?')[0] !== redirect.pathname) return response(404, 'Not found');
      const failure = () => response(400, 'Authorization failed; start again', { 'set-cookie': cookie('', 0) });
      for (const key of url.searchParams.keys()) if (!['state', 'code', 'error', 'error_description', 'scope'].includes(key) || url.searchParams.getAll(key).length !== 1) return failure();
      const state = url.searchParams.get('state');
      const cookies = (typeof headers.cookie === 'string' ? headers.cookie : '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
      const browser = cookies.length === 1 ? cookies[0].slice(cookieName.length + 1) : '';
      if (!/^[\w-]{43}$/.test(state ?? '') || !/^[\w-]{43}$/.test(browser)) return failure();
      const stored = await store.consumeState(hash(state), hash(browser), now());
      if (!stored || !validRole(stored.role)) return failure();
      if (url.searchParams.has('error')) return failure();
      const code = url.searchParams.get('code');
      if (!code || code.length > 2048) return failure();
      await locked(stored.role, async owner => {
        const token = await exchange({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
        if (!await validate(token, stored.role)) throw new Error('Authorization required');
        await store.saveToken(stored.role, cipher.seal(token, context(stored.role)), owner, now());
      });
      const responseCookies = stored.role === 'bot' ? cookie('', 0) : [cookie('', 0), await control.issue(accounts[stored.role])];
      return stored.role === 'bot' ? response(200, 'Authorization saved', { 'set-cookie': responseCookies })
        : { ...response(200, `<p>Authorization saved</p><a href="/control/${accounts[stored.role]}">Open Keeper control</a>`, { 'set-cookie': responseCookies }), type: 'text/html; charset=utf-8' };
    } catch {
      return response(400, 'Authorization failed; start again', { 'set-cookie': cookie('', 0) });
    }
  }
  return { route, accessToken, control, accessTokenForKeeper(id, options) {
    if (!keeperIds.includes(id)) throw new Error('Invalid Keeper');
    return accessToken(id === streamerId ? 'streamer' : `keeper:${id}`, options);
  }, callbackPath: redirect.pathname };
}
