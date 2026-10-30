import { boundedCall } from './bounded.js';
import { strictJSON, forgeDescription } from './forge.js';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { hash } from './crypto.js';

export function createControl({
  store,
  keeperIds,
  origin,
  secure,
  now = Date.now,
  activityTimeoutMs = 8000,
}) {
  let pilot;
  const name = (id) => `${secure ? '__Host-' : ''}rr_control_${id}`;
  const cookie = (id, value, age) =>
    `${name(id)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const csrf = (secret) => hash(`control-csrf:${secret}`);
  async function session(id, headers) {
    if (!keeperIds.includes(id)) return null;
    const entries = (headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(`${name(id)}=`));
    const secret = entries.length === 1 ? entries[0].slice(name(id).length + 1) : '';
    if (!/^[\w-]{43}$/.test(secret)) return null;
    const record = await store.getControlSession(id, hash(secret), now());
    return record?.keeperId === id && record.role === 'keeper' ? { ...record, secret } : null;
  }
  async function authorizePost({ keeperId, headers = {}, rawBody }, allowedActions = []) {
    if (
      headers.origin !== origin ||
      headers['content-type'] !== 'application/json' ||
      !Buffer.isBuffer(rawBody) ||
      rawBody.length > 1024
    )
      return null;
    const record = await session(keeperId, headers);
    if (!record) return null;
    let body;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
      if ((text.match(/"(?:action|csrf)"\s*:/g) ?? []).length !== 2) return null;
      body = JSON.parse(text);
    } catch {
      return null;
    }
    if (
      !body ||
      Object.keys(body).sort().join(',') !== 'action,csrf' ||
      !allowedActions.includes(body.action) ||
      typeof body.csrf !== 'string' ||
      hash(body.csrf) !== record.csrfHash
    )
      return null;
    return { keeperId, action: body.action, sessionHash: hash(record.secret) };
  }
  const baseReply = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => ({
    status,
    body,
    type,
    headers: {
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "frame-ancestors 'none'; base-uri 'none'",
      'x-frame-options': 'DENY',
      ...extra,
    },
  });
  return {
    bindPilot(service) {
      if (pilot) throw new Error('Control already bound');
      pilot = service;
    },
    async issue(id) {
      if (!keeperIds.includes(id)) throw new Error('Control authorization failed');
      const secret = randomBytes(32).toString('base64url');
      await store.createControlSession(id, {
        keeperId: id,
        role: 'keeper',
        sessionHash: hash(secret),
        csrfHash: hash(csrf(secret)),
        renewedAt: now(),
        expiresAt: now() + 43200000,
      });
      return cookie(id, secret, 43200);
    },
    authorizePost,
    async route({ path, method, headers = {}, rawBody }) {
      const match =
        /^\/control\/(\d{1,32})(\/(?:status|forge|cancel-queued|expire-handoff))?$/.exec(path);
      if (!match || !keeperIds.includes(match[1])) return baseReply(404, 'Not found');
      const id = match[1];
      let renewedCookie;
      const reply = (...args) => {
        const result = baseReply(...args);
        if (renewedCookie && !Object.hasOwn(result.headers, 'set-cookie'))
          result.headers['set-cookie'] = renewedCookie;
        return result;
      };
      async function activity(record) {
        const time = now(),
          sessionHash = hash(record.secret);
        const fresh = await boundedCall(
          async (signal) => {
            let current;
            if (time - (record.renewedAt ?? 0) >= 300000)
              current = await store.renewControlSession(id, sessionHash, record.expiresAt, time, {
                signal,
              });
            if (signal.aborted) throw Error('Session unavailable');
            // One shared deadline covers CAS and fallback, with no retries.
            current ??= await store.getControlSession(id, sessionHash, time);
            if (
              signal.aborted ||
              current?.keeperId !== id ||
              current.role !== 'keeper' ||
              current.expiresAt <= time
            )
              throw Error('Session unavailable');
            return current;
          },
          Math.min(8000, Math.max(1, activityTimeoutMs)),
        );
        // Only the winning, completed await may issue a cookie or permit action.
        renewedCookie = cookie(
          id,
          record.secret,
          Math.max(0, Math.floor((fresh.expiresAt - time) / 1000)),
        );
        return fresh;
      }

      try {
        if (method === 'POST' && match[2] === '/cancel-queued') {
          if (!pilot || headers.origin !== origin || headers['content-type'] !== 'application/json')
            return reply(403, 'Control authorization required');
          let body;
          try {
            body = strictJSON(rawBody);
          } catch {
            return reply(403, 'Control authorization required');
          }
          if (
            !body ||
            Object.keys(body).sort().join(',') !== 'csrf,generation,intentId' ||
            !/^[a-f0-9]{64}$/.test(body.intentId ?? '') ||
            !/^[a-f0-9]{64}$/.test(body.generation ?? '')
          )
            return reply(403, 'Control authorization required');
          const record = await boundedCall(
            () => session(id, headers),
            Math.min(8000, Math.max(1, activityTimeoutMs)),
          );
          if (!record || typeof body.csrf !== 'string' || hash(body.csrf) !== record.csrfHash)
            return reply(403, 'Control authorization required');
          await activity(record);
          return reply(
            200,
            JSON.stringify(await pilot.cancelQueued(id, body.intentId, body.generation)),
            'application/json',
          );
        }
        if (method === 'POST' && match[2] === '/forge') {
          if (!pilot || headers.origin !== origin || headers['content-type'] !== 'application/json')
            return reply(403, 'Control authorization required');
          let body;
          try {
            body = strictJSON(rawBody);
          } catch {
            return reply(403, 'Control authorization required');
          }
          if (
            !body ||
            Object.keys(body).sort().join(',') !== 'acknowledge,csrf,description' ||
            typeof body.acknowledge !== 'boolean'
          )
            return reply(403, 'Control authorization required');
          const record = await boundedCall(
            () => session(id, headers),
            Math.min(8000, Math.max(1, activityTimeoutMs)),
          );
          if (!record || typeof body.csrf !== 'string' || hash(body.csrf) !== record.csrfHash)
            return reply(403, 'Control authorization required');
          const description = forgeDescription(body.description);
          await activity(record);
          return reply(
            200,
            JSON.stringify(await pilot.forgeDesign(id, description, body.acknowledge)),
            'application/json',
          );
        }
        if (match[2] === '/expire-handoff') {
          if (method !== 'POST') return reply(405, 'Method not allowed');
          let body;
          try {
            if (rawBody.length > 1024) throw Error();
            const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
            if ((text.match(/"(?:csrf|intentId|hopId)"\s*:/g) ?? []).length !== 3) throw Error();
            body = JSON.parse(text);
            if (
              Object.keys(body).sort().join(',') !== 'csrf,hopId,intentId' ||
              !/^[a-f0-9]{64}$/.test(body.intentId) ||
              !/^[a-f0-9]{64}$/.test(body.hopId)
            )
              throw Error();
          } catch {
            return reply(403, 'Control authorization required');
          }
          const auth = await authorizePost(
            {
              keeperId: id,
              headers,
              rawBody: Buffer.from(JSON.stringify({ action: 'expire-handoff', csrf: body.csrf })),
            },
            ['expire-handoff'],
          );
          if (!auth || !pilot) return reply(403, 'Control authorization required');
          await activity(
            await boundedCall(
              () => session(id, headers),
              Math.min(8000, Math.max(1, activityTimeoutMs)),
            ),
          );
          return reply(
            200,
            JSON.stringify(await pilot.expireHandoff(id, body.intentId, body.hopId)),
            'application/json',
          );
        }
        if (method === 'POST' && !match[2]) {
          const auth = await authorizePost({ keeperId: id, headers, rawBody }, [
            'logout',
            ...(pilot?.actions(id) ?? []),
          ]);
          if (!auth) return reply(403, 'Control authorization required');
          if (auth.action !== 'logout') {
            await activity(
              await boundedCall(
                () => session(id, headers),
                Math.min(8000, Math.max(1, activityTimeoutMs)),
              ),
            );
            const result = await pilot.execute(id, auth.action);
            return reply(
              result.status === 'failed' ? 502 : result.status === 'busy' ? 409 : 200,
              JSON.stringify(result),
              'application/json',
            );
          }
          if (!(await store.revokeControlSession(id, auth.sessionHash, now())))
            return reply(403, 'Control authorization required');
          return reply(200, 'Control session ended; Twitch authorization unchanged', undefined, {
            'set-cookie': cookie(id, '', 0),
          });
        }
        if (method !== 'GET') return reply(405, 'Method not allowed');
        const record = await boundedCall(
          () => session(id, headers),
          Math.min(8000, Math.max(1, activityTimeoutMs)),
        );
        if (!record)
          return reply(
            401,
            `<p>Keeper authorization required.</p><a href="/oauth/keeper/${id}/start">Connect this Keeper</a>`,
            'text/html; charset=utf-8',
          );
        if (match[2] === '/cancel-queued') return reply(405, 'Use authenticated confirmation');
        if (match[2] === '/forge')
          return pilot
            ? reply(
                200,
                await readFile(new URL('../public/forge-owner.html', import.meta.url)),
                'text/html; charset=utf-8',
              )
            : reply(404, 'Not found');
        if (match[2]) {
          let pilotStatus;
          try {
            pilotStatus = pilot ? await boundedCall(() => pilot.status(id)) : undefined;
          } catch {
            return reply(503, JSON.stringify({ error: 'Status unavailable' }), 'application/json');
          }
          // Status reads do not renew sessions, grants, subscriptions or gameplay.
          const fresh = record;
          return reply(
            200,
            JSON.stringify({
              canonicalBotConsentStartURL: new URL('/oauth/bot/start?features=p7', origin).href,
              forgeEnabled: pilot?.forgeEnabled === true,
              keeperId: id,
              expiresAt: fresh.expiresAt,
              csrf: csrf(record.secret),
              actions: ['logout', ...(pilot?.actions(id) ?? [])],
              ...(pilot ? { pilot: pilotStatus } : {}),
            }),
            'application/json',
          );
        }
        if (pilot)
          return reply(
            200,
            await readFile(new URL('../public/control.html', import.meta.url)),
            'text/html; charset=utf-8',
            {
              'content-security-policy':
                "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'",
            },
          );
        return reply(
          200,
          `<h1>Keeper control</h1><p>Authenticated Keeper ${id}.</p><p>Worker and subscription bootstrap actions are not available yet.</p><a href="/control/${id}/status">Private session status</a>`,
          'text/html; charset=utf-8',
        );
      } catch {
        return reply(403, 'Control authorization required');
      }
    },
  };
}
