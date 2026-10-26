import { P7_SCOPES } from './p7-scopes.js';
import { boundedCall } from './bounded.js';
import { boundedResponse } from '../public/control-read.js';
import { createControl } from './control.js';
import { randomBytes } from 'node:crypto';
import { hash, createTokenCipher } from './crypto.js';

export const SCOPES = Object.freeze({
  streamer: Object.freeze(['channel:bot', 'channel:manage:raids']),
  bot: Object.freeze(['user:read:chat', 'user:write:chat', 'user:bot']),
});
const nonce = () => randomBytes(32).toString('base64url');
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export async function httpTransport(url, options) {
  try {
    const response = await boundedResponse(url, { ...options, redirect: 'error' }, { json: false });
    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      throw Error('Invalid upstream response');
    }
    return { status: response.status, data };
  } catch {
    throw new Error('Upstream request failed');
  }
}

export function createOAuth({
  clientId,
  clientSecret,
  redirectUri,
  redirectAllowlist,
  streamerId,
  botId,
  keeperIds = [streamerId],
  encryptionKey,
  store,
  transport = httpTransport,
  now = Date.now,
  production = false,
}) {
  if (
    !clientId ||
    !clientSecret ||
    !store ||
    !/^\d+$/.test(streamerId ?? '') ||
    !/^\d+$/.test(botId ?? '') ||
    streamerId === botId
  )
    throw new Error('OAuth configuration required');
  const redirect = new URL(redirectUri);
  if (
    !Array.isArray(redirectAllowlist) ||
    !redirectAllowlist.includes(redirectUri) ||
    redirect.href !== redirectUri ||
    !['/auth/callback', '/oauth/callback'].includes(redirect.pathname) ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    (redirect.protocol !== 'https:' &&
      !(redirect.protocol === 'http:' && redirect.hostname === 'localhost' && !production))
  )
    throw new Error('Invalid OAuth redirect configuration');
  const cipher = createTokenCipher(encryptionKey);
  if (
    !Array.isArray(keeperIds) ||
    !keeperIds.includes(streamerId) ||
    keeperIds.length > 4 ||
    new Set(keeperIds).size !== keeperIds.length ||
    !keeperIds.every((id) => typeof id === 'string' && /^\d{1,32}$/.test(id) && id !== botId)
  )
    throw new Error('Explicit Keeper accounts required');
  const accounts = {
    streamer: streamerId,
    bot: botId,
    ...Object.fromEntries(
      keeperIds.filter((id) => id !== streamerId).map((id) => [`keeper:${id}`, id]),
    ),
  };
  const scopes = (role) => (role === 'bot' ? SCOPES.bot : SCOPES.streamer);
  const validRole = (role) => Object.hasOwn(accounts, role);
  const secure = redirect.protocol === 'https:';
  const control = createControl({ store, keeperIds, origin: redirect.origin, secure, now });
  const cookieName = secure ? '__Host-rr_oauth' : 'rr_oauth';
  const cookie = (value, age) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const context = (role) => `${clientId}:${role}:${accounts[role]}`;
  const safeCall = async (url, options) => {
    try {
      return await boundedCall((signal) => transport(url, { ...options, signal }));
    } catch {
      throw Object.assign(new Error('Authorization temporarily unavailable'), {
        code: 'transient-unavailable',
      });
    }
  };
  async function exchange(parameters) {
    const response = await safeCall(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        ...parameters,
      }).toString(),
    });
    if (parameters.grant_type === 'refresh_token' && [400, 401].includes(response.status))
      throw Object.assign(new Error('Reconnect this account'), { code: 'reconsent-required' });
    const token = response.data;
    if (
      response.status !== 200 ||
      !token ||
      typeof token.access_token !== 'string' ||
      !token.access_token ||
      typeof token.refresh_token !== 'string' ||
      !token.refresh_token ||
      token.token_type?.toLowerCase() !== 'bearer'
    )
      throw Object.assign(new Error('Token exchange failed'), { code: 'transient-unavailable' });
    return { access_token: token.access_token, refresh_token: token.refresh_token };
  }
  async function validate(token, role, required = scopes(role)) {
    const response = await safeCall('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token.access_token}` },
    });
    if (response.status === 401) return false;
    if (response.status !== 200)
      throw Object.assign(Error('Authorization temporarily unavailable'), {
        code: 'transient-unavailable',
      });
    const data = response.data;
    if (
      response.status !== 200 ||
      data?.client_id !== clientId ||
      data.user_id !== accounts[role] ||
      !Array.isArray(data.scopes) ||
      !required.every((scope) => data.scopes.includes(scope)) ||
      !(Number.isFinite(data.expires_in) && data.expires_in >= 0)
    )
      throw new Error('Token identity or grants invalid');
    return { scopes: data.scopes, expiresIn: data.expires_in };
  }
  async function locked(role, operation) {
    const owner = nonce();
    let acquired = false;
    for (const delay of [0, 50, 100, 200, 400, 800, 800, 800]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (await store.acquire(role, owner, now())) {
        acquired = true;
        break;
      }
    }
    if (!acquired)
      throw Object.assign(new Error('Token operation busy; retry later'), {
        code: 'transient-unavailable',
      });
    try {
      return await operation(owner);
    } finally {
      await store.release(role, owner);
    }
  }
  const flights = new Map();
  async function accessToken(
    role,
    { refresh = false, scopeCheck, p7 = false, extraScopes = [] } = {},
  ) {
    if (
      !validRole(role) ||
      !Array.isArray(extraScopes) ||
      extraScopes.some((s) => s !== 'user:read:moderated_channels')
    )
      throw Error('Invalid role or scope');
    let flight = flights.get(role);
    if (!flight) {
      flight = { forceRequested: refresh, promise: null };
      flights.set(role, flight);
      const open = (record) => {
        if (!record)
          throw Object.assign(Error('Authorization required'), { code: 'authorization-required' });
        const token = cipher.open(record, context(role));
        if (
          typeof token?.access_token !== 'string' ||
          !token.access_token ||
          typeof token.refresh_token !== 'string' ||
          !token.refresh_token
        )
          throw Object.assign(Error('Stored authorization unavailable'), {
            code: 'transient-unavailable',
          });
        return token;
      };
      flight.promise = (async () => {
        const initial = await store.getToken(role);
        const original = open(initial);
        const initialProof = flight.forceRequested ? false : await validate(original, role);
        // Fresh ordinary use is read/validate only: no lease transaction/write.
        // Recheck the mutable force request after validation has completed.
        if (initialProof && initialProof.expiresIn > 120 && !flight.forceRequested)
          return { token: original.access_token, proof: initialProof };
        return locked(role, async (owner) => {
          const record = await store.getToken(role);
          let token = open(record);
          const force = flight.forceRequested && JSON.stringify(record) === JSON.stringify(initial);
          let proof = force ? false : await validate(token, role);
          if (flight.forceRequested && JSON.stringify(record) === JSON.stringify(initial))
            proof = false;
          if (!proof || proof.expiresIn <= 120) {
            token = await exchange({
              grant_type: 'refresh_token',
              refresh_token: token.refresh_token,
            });
            proof = await validate(token, role);
            if (!proof || proof.expiresIn <= 120)
              throw Object.assign(Error('Fresh authorization unavailable'), {
                code: 'transient-unavailable',
              });
            await store.saveToken(role, cipher.seal(token, context(role)), owner, now());
          }
          return { token: token.access_token, proof };
        });
      })();
      void flight.promise
        .finally(() => {
          if (flights.get(role) === flight) flights.delete(role);
        })
        .catch(() => {});
    } else if (refresh) flight.forceRequested = true;
    const { token, proof } = await flight.promise;
    const required = [...scopes(role), ...(p7 && role === 'bot' ? P7_SCOPES : []), ...extraScopes];
    if (!required.every((scope) => proof.scopes.includes(scope)))
      throw Object.assign(Error('Required permission unavailable'), {
        code: 'permission-unavailable',
      });
    return scopeCheck ? proof.scopes.includes(scopeCheck) : token;
  }
  async function route({ path, method, headers }) {
    const response = (status, body, extra = {}) => ({
      status,
      body,
      type: 'text/plain; charset=utf-8',
      headers: {
        'referrer-policy': 'no-referrer',
        'content-security-policy': "frame-ancestors 'none'; base-uri 'none'",
        'x-frame-options': 'DENY',
        ...extra,
      },
    });
    try {
      const url = new URL(path, redirect.origin);
      const keeperMatch = /^\/oauth\/keeper\/(\d{1,32})\/start$/.exec(url.pathname);
      const match = /^\/oauth\/(streamer|bot)\/start$/.exec(url.pathname);
      if (method !== 'GET') return response(405, 'Method not allowed');
      if (match || keeperMatch) {
        const p7 =
          match?.[1] === 'bot' &&
          url.searchParams.get('features') === 'p7' &&
          [...url.searchParams].length === 1;
        if (url.search && !p7) return response(400, 'Invalid authorization request');
        const id = keeperMatch?.[1];
        if (id && !keeperIds.includes(id)) return response(404, 'Not found');
        const role = id ? (id === streamerId ? 'streamer' : `keeper:${id}`) : match[1];
        const state = nonce();
        const browser = nonce();
        await store.createState(
          hash(state),
          { binding: hash(browser), role, ...(p7 ? { p7: true } : {}), expiresAt: now() + 300000 },
          now(),
        );
        const auth = new URL('https://id.twitch.tv/oauth2/authorize');
        auth.search = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: (p7 ? [...SCOPES.bot, ...P7_SCOPES] : scopes(role)).join(' '),
          state,
          force_verify: 'true',
        }).toString();
        return response(302, '', { location: auth.href, 'set-cookie': cookie(browser, 300) });
      }
      if (url.pathname !== redirect.pathname || path.split('?')[0] !== redirect.pathname)
        return response(404, 'Not found');
      const failure = () =>
        response(400, 'Authorization failed; start again', { 'set-cookie': cookie('', 0) });
      for (const key of url.searchParams.keys())
        if (
          !['state', 'code', 'error', 'error_description', 'scope'].includes(key) ||
          url.searchParams.getAll(key).length !== 1
        )
          return failure();
      const state = url.searchParams.get('state');
      const cookies = (typeof headers.cookie === 'string' ? headers.cookie : '')
        .split(';')
        .map((value) => value.trim())
        .filter((value) => value.startsWith(`${cookieName}=`));
      const browser = cookies.length === 1 ? cookies[0].slice(cookieName.length + 1) : '';
      if (!/^[\w-]{43}$/.test(state ?? '') || !/^[\w-]{43}$/.test(browser)) return failure();
      const stored = await store.consumeState(hash(state), hash(browser), now());
      if (!stored || !validRole(stored.role) || (stored.p7 && stored.role !== 'bot'))
        return failure();
      if (url.searchParams.has('error')) return failure();
      const code = url.searchParams.get('code');
      if (!code || code.length > 2048) return failure();
      await locked(stored.role, async (owner) => {
        const token = await exchange({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        });
        if (
          !(await validate(
            token,
            stored.role,
            stored.p7 ? [...SCOPES.bot, ...P7_SCOPES] : scopes(stored.role),
          ))
        )
          throw new Error('Authorization required');
        await store.saveToken(stored.role, cipher.seal(token, context(stored.role)), owner, now());
      });
      const responseCookies =
        stored.role === 'bot'
          ? cookie('', 0)
          : [cookie('', 0), await control.issue(accounts[stored.role])];
      return stored.role === 'bot'
        ? response(200, 'Authorization saved', { 'set-cookie': responseCookies })
        : {
            ...response(
              200,
              `<p>Authorization saved</p><a href="/control/${accounts[stored.role]}">Open Keeper control</a>`,
              { 'set-cookie': responseCookies },
            ),
            type: 'text/html; charset=utf-8',
          };
    } catch {
      return response(400, 'Authorization failed; start again', { 'set-cookie': cookie('', 0) });
    }
  }
  return {
    route,
    accessToken,
    // Compatibility name: receiving readiness now maintains existing grants.
    // It cannot consent, add scopes or perform a gameplay/provider action.
    readAccessToken(role, extraScopes = []) {
      return accessToken(role, { extraScopes });
    },
    ensureValidAccess: accessToken,
    // Explicit pure validation remains available for operator/read-only probes.
    async validateAccessToken(role, extraScopes = []) {
      if (
        !validRole(role) ||
        !Array.isArray(extraScopes) ||
        extraScopes.some((s) => s !== 'user:read:moderated_channels')
      )
        throw Error('Read grant rejected');
      const record = await store.getToken(role);
      if (!record)
        throw Object.assign(Error('Read grant unavailable'), { code: 'authorization-required' });
      const token = cipher.open(record, context(role));
      if (!(await validate(token, role, [...scopes(role), ...extraScopes])))
        throw Object.assign(Error('Read grant unavailable'), { code: 'grant-expired-or-invalid' });
      return token.access_token;
    },
    accessTokenForP7() {
      return accessToken('bot', { p7: true });
    },
    control,
    hasBanGrant(id) {
      if (!keeperIds.includes(id)) throw Error('Invalid Keeper');
      return accessToken(id === streamerId ? 'streamer' : `keeper:${id}`, {
        scopeCheck: 'channel:moderate',
      });
    },
    accessTokenForKeeper(id, options) {
      if (!keeperIds.includes(id)) throw new Error('Invalid Keeper');
      return accessToken(id === streamerId ? 'streamer' : `keeper:${id}`, options);
    },
    callbackPath: redirect.pathname,
  };
}
