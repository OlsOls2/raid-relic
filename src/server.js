import { createServer } from 'node:http';
import { createRuntime } from './runtime.js';
import { attachOverlaySockets } from './overlay-sockets.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Preview admission only. Never grants application, OAuth, moderator or provider authority.

const COOKIE = '__Host-raid-preview';
const MAX_HEADERS = 16384;
const MAX_FORM = 128;
const MAX_APP_BODY = 65536;
const HOUR12 = 43200;
const MAX_PRIVATE_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private preview</title><body><main><h1>Private preview</h1><form method="post" action="/_preview/access"><label>Access code <input name="key" type="password" minlength="43" maxlength="43" required autocomplete="off"></label><button type="submit">Enter private preview</button></form></main></body></html>';
const safeHeaders = {
  'cache-control': 'private, no-store',
  'content-security-policy':
    "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
};
export function privatePreviewConfig(env, now = Date.now()) {
  const flag = env.P5_PREVIEW_PRIVATE_ENABLED;
  if (flag !== undefined && flag !== 'false' && flag !== 'true')
    throw Error('Invalid private preview configuration');
  if (flag !== 'true') return Object.freeze({ enabled: false });
  const digest = env.P5_PREVIEW_ACCESS_SHA256;
  const expiry = env.P5_PREVIEW_ACCESS_EXPIRES_AT;
  const expiresAt = typeof expiry === 'string' ? Date.parse(expiry) : NaN;
  if (
    env.P5_PREVIEW_READ_ONLY !== 'true' ||
    typeof digest !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(digest) ||
    typeof expiry !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry) ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > MAX_PRIVATE_TTL_MS ||
    new Date(expiresAt).toISOString() !==
      (expiry.includes('.') ? expiry : expiry.replace('Z', '.000Z'))
  )
    throw Error('Invalid private preview configuration');
  return Object.freeze({ enabled: true, digest: digest.toLowerCase(), expiresAt });
}
function target(req) {
  const raw = req.url;
  if (
    typeof raw !== 'string' ||
    raw.length > 2048 ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    /[\u0000-\u0020\u007f-\uffff\\#]/.test(raw) ||
    /%(?![a-f0-9]{2})/i.test(raw)
  )
    return null;
  const path = raw.split('?')[0];
  if (path.includes('%')) return null; // Owned routes never require encoded path segments.
  try {
    const parsed = new URL(raw, 'https://preview.invalid');
    if (parsed.origin !== 'https://preview.invalid' || parsed.pathname !== path) return null;
    return raw;
  } catch {
    return null;
  }
}
function credentials(req) {
  const raw = req.rawHeaders;
  if (
    !Array.isArray(raw) ||
    raw.length > 128 ||
    raw.length % 2 ||
    raw.some((v) => typeof v !== 'string') ||
    raw.reduce((n, v) => n + Buffer.byteLength(v), 0) > MAX_HEADERS
  )
    return { invalid: true };
  const counts = new Map();
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i].toLowerCase();
    if (!name || /[^!#$%&'*+.^_`|~0-9a-z-]/.test(name) || /[\r\n\u0000]/.test(raw[i + 1]))
      return { invalid: true };
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (
    [
      'x-preview-access',
      'cookie',
      'content-length',
      'content-type',
      'origin',
      'host',
      'transfer-encoding',
    ].some((k) => (counts.get(k) ?? 0) > 1)
  )
    return { invalid: true };
  const headers = req.headers;
  if (!headers || Object.values(headers).some((v) => Array.isArray(v))) return { invalid: true };
  const header = headers['x-preview-access'];
  const cookie = headers.cookie;
  if (header !== undefined && (typeof header !== 'string' || header.length !== 43))
    return { invalid: true };
  if (
    cookie !== undefined &&
    (typeof cookie !== 'string' || cookie.length > 8192 || /[^\x20-\x7e]/.test(cookie))
  )
    return { invalid: true };
  let value;
  const rest = [];
  for (const part of cookie?.split(';') ?? []) {
    const pair = part.trim();
    const at = pair.indexOf('=');
    if (at < 1) return { invalid: true };
    const name = pair.slice(0, at).trim();
    if (name === COOKIE) {
      if (value !== undefined) return { invalid: true };
      value = pair.slice(at + 1);
    } else rest.push(pair);
  }
  if (header !== undefined && value !== undefined) return { invalid: true };
  return { token: header ?? value, header: header !== undefined, cookie: rest.join('; ') };
}
function send(req, res, status, body = 'Private preview', extra = {}) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, {
    ...safeHeaders,
    'content-type': status === 200 ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    connection: 'close',
    ...extra,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
function removeCredential(req, info) {
  const headers = { ...req.headers };
  delete headers['x-preview-access'];
  if (info.cookie) headers.cookie = info.cookie;
  else delete headers.cookie;
  req.headers = headers;
  const raw = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase();
    if (name === 'x-preview-access') continue;
    if (name === 'cookie') {
      if (info.cookie) raw.push(req.rawHeaders[i], info.cookie);
    } else raw.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }
  req.rawHeaders = raw;
}
function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin);
    return (
      origin.protocol === 'https:' &&
      origin.origin === req.headers.origin &&
      !origin.username &&
      !origin.password &&
      origin.host === req.headers.host &&
      !['cross-site', 'none'].includes(req.headers['sec-fetch-site'])
    );
  } catch {
    return false;
  }
}
function formBody(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    let bytes = 0,
      settled = false;
    const chunks = [];
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('error', errorHandler);
      req.off('aborted', aborted);
      req.pause();
      if (error) reject(Error('Preview body rejected'));
      else resolve(Buffer.concat(chunks, bytes).toString('utf8'));
    };
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_FORM) finish(true);
      else chunks.push(chunk);
    };
    const end = () => finish(bytes !== Number(req.headers['content-length']));
    const errorHandler = () => finish(true),
      aborted = () => finish(true);
    const timer = setTimeout(() => finish(true), timeoutMs);
    req.on('data', data);
    req.once('end', end);
    req.once('error', errorHandler);
    req.once('aborted', aborted);
  });
}
export function createPrivatePreview(env, { now = Date.now, bodyTimeoutMs = 2000 } = {}) {
  const config = privatePreviewConfig(env, now());
  if (!config.enabled)
    return Object.freeze({
      enabled: false,
      wrapHandler: (handler) => handler,
      upgradeServer: (server) => server,
    });
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > 2000)
    throw Error('Invalid private preview bounds');
  const expected = Buffer.from(config.digest, 'hex');
  let windowAt = now(),
    failures = 0,
    inflight = 0,
    lastTime = windowAt,
    expired = false,
    expiryTimer = null;
  const admittedSockets = new Set();
  function live() {
    const time = now();
    if (!Number.isSafeInteger(time) || time < lastTime) return false;
    lastTime = time;
    if (time >= config.expiresAt) expired = true;
    return !expired;
  }
  function expireSockets() {
    expiryTimer = null;
    if (!live()) {
      for (const socket of admittedSockets) socket.destroy();
      admittedSockets.clear();
      return;
    }
    if (admittedSockets.size) {
      expiryTimer = setTimeout(
        expireSockets,
        Math.min(2147483647, Math.max(1, config.expiresAt - now())),
      );
      expiryTimer.unref();
    }
  }
  function verified(value) {
    if (!live() || typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length !== 32 || decoded.toString('base64url') !== value) return false;
    return timingSafeEqual(createHash('sha256').update(value, 'utf8').digest(), expected);
  }
  function limited() {
    const time = now();
    if (time >= windowAt + 60000) {
      windowAt = time;
      failures = 0;
    }
    return failures >= 32;
  }
  function deny(req, res, status = 401) {
    const blocked = limited();
    failures = Math.min(32, failures + 1);
    send(
      req,
      res,
      blocked ? 429 : status,
      'Private preview',
      blocked ? { 'retry-after': '60' } : {},
    );
  }
  function admitted(req) {
    if (!target(req)) return { invalid: true };
    const info = credentials(req);
    return { ...info, ok: !info.invalid && verified(info.token) };
  }
  return Object.freeze({
    enabled: true,
    wrapHandler(handler) {
      return async (req, res) => {
        const info = admitted(req);
        if (info.invalid) {
          deny(req, res, 400);
          return;
        }
        if (req.url === '/_preview/access') {
          if (
            req.method !== 'POST' ||
            info.header ||
            !sameOrigin(req) ||
            req.headers['content-type'] !== 'application/x-www-form-urlencoded' ||
            req.headers['transfer-encoding'] ||
            !/^(?:[1-9]\d{0,2})$/.test(req.headers['content-length'] ?? '') ||
            Number(req.headers['content-length']) > MAX_FORM
          ) {
            deny(req, res);
            return;
          }
          if (limited() || inflight >= 4) {
            send(req, res, 429, 'Private preview', { 'retry-after': '60' });
            return;
          }
          inflight++;
          try {
            const body = await formBody(req, bodyTimeoutMs);
            const match = /^key=([A-Za-z0-9_-]{43})$/.exec(body);
            if (!match || !verified(match[1])) {
              deny(req, res);
              return;
            }
            const age = Math.min(HOUR12, Math.floor((config.expiresAt - now()) / 1000));
            if (age < 1) {
              deny(req, res);
              return;
            }
            send(req, res, 303, 'Private preview', {
              location: '/',
              'set-cookie': `${COOKIE}=${match[1]}; Secure; HttpOnly; Path=/; SameSite=Strict; Max-Age=${age}`,
            });
          } catch {
            deny(req, res);
          } finally {
            inflight--;
          }
          return;
        }
        if (!info.ok) {
          // The credential form needs a same-origin Origin; never send referrers cross-origin.
          // All denial and authenticated product responses retain no-referrer.
          if (req.url === '/' && req.method === 'GET' && info.token === undefined)
            send(req, res, 200, PAGE, { 'referrer-policy': 'same-origin' });
          else deny(req, res);
          return;
        }
        if (
          req.headers['content-length'] &&
          (!/^\d{1,8}$/.test(req.headers['content-length']) ||
            Number(req.headers['content-length']) > MAX_APP_BODY)
        ) {
          send(req, res, 413);
          return;
        }
        removeCredential(req, info);
        // Preserve application CSP/auth headers, but never cache gated assets publicly.
        const writeHead = res.writeHead;
        res.writeHead = function (status, ...args) {
          const headers = typeof args[0] === 'string' ? args[1] : args[0];
          if (Array.isArray(headers)) throw Error('Private preview response rejected');
          const clean = Object.fromEntries(
            Object.entries(headers ?? {}).filter(
              ([key]) => !['cache-control', 'referrer-policy', 'vary'].includes(key.toLowerCase()),
            ),
          );
          const next = {
            ...clean,
            'cache-control': 'private, no-store',
            'referrer-policy': 'no-referrer',
            vary: 'Cookie, X-Preview-Access',
          };
          return typeof args[0] === 'string'
            ? writeHead.call(this, status, args[0], next)
            : writeHead.call(this, status, next);
        };
        return handler(req, res);
      };
    },
    upgradeServer(server) {
      const listeners = new Map();
      return {
        on(event, listener) {
          if (event !== 'upgrade' || listeners.size >= 16 || listeners.has(listener))
            throw Error('Private preview upgrade wiring rejected');
          const guarded = (req, socket, head) => {
            const info = admitted(req);
            if (!info.ok) {
              const status = limited() ? 429 : 401;
              failures = Math.min(32, failures + 1);
              socket.end(
                `HTTP/1.1 ${status} ${status === 429 ? 'Too Many Requests' : 'Unauthorized'}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`,
              );
              return;
            }
            if (admittedSockets.size >= 32) {
              socket.end(
                'HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
              );
              return;
            }
            admittedSockets.add(socket);
            socket.once('close', () => {
              admittedSockets.delete(socket);
              if (!admittedSockets.size) {
                clearTimeout(expiryTimer);
                expiryTimer = null;
              }
            });
            if (!expiryTimer) {
              expiryTimer = setTimeout(
                expireSockets,
                Math.min(2147483647, Math.max(1, config.expiresAt - now())),
              );
              expiryTimer.unref();
            }
            removeCredential(req, info);
            listener(req, socket, head);
          };
          listeners.set(listener, guarded);
          server.on(event, guarded);
        },
        off(event, listener) {
          const guarded = listeners.get(listener);
          if (guarded) {
            server.off(event, guarded);
            listeners.delete(listener);
          }
        },
      };
    },
  });
}

// Importing pure gate exports never constructs a runtime or starts listeners.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 5191);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  // Validate before runtime construction: a broken private config must never fall public.
  const preview = createPrivatePreview(process.env);
  const runtime = await createRuntime(process.env);
  const server = createServer(preview.wrapHandler(runtime.handler));
  const sockets = runtime.overlayFeed
    ? attachOverlaySockets(
        preview.upgradeServer(server),
        runtime.overlayFeeds ?? runtime.overlayFeed,
        {
          origins: runtime.overlayOrigins,
          allowRead: runtime.allowPublicRead,
        },
      )
    : null;
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(port, '0.0.0.0');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      sockets?.close();
      server.close();
    });
}
