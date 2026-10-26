import { createHmac, randomBytes } from 'node:crypto';
import { createTokenCipher, hash } from './crypto.js';
import { runeSvg } from './marks.js';
export const shareRequestHash = (chat) =>
  hash(JSON.stringify(['my-marks-request-v1', chat.broadcasterId, chat.chatterId, chat.messageId]));
export const canonicalLogin = (value) =>
  typeof value === 'string' && /^@?[a-zA-Z0-9_]{1,25}$/.test(value)
    ? value.replace(/^@/, '').toLowerCase()
    : null;
export const SHARE_TTL = 600000;
export function createMarkShares({ key, channels, origin, now = Date.now }) {
  const secret = Buffer.from(key ?? '', 'base64');
  if (secret.length !== 32 || !channels?.length || new URL(origin).origin !== origin)
    throw Error('Share configuration required');
  const cipher = createTokenCipher(
    createHmac('sha256', secret).update('raid-relic-own-marks-v1').digest('base64'),
  );
  function issue(host, actor, issuedAt = now(), login) {
    if (
      !login ||
      canonicalLogin(login) !== login ||
      !channels.includes(host) ||
      !/^\d{1,32}$/.test(actor)
    )
      throw Error('Invalid share scope');
    const payload = {
      l: login,
      h: host,
      u: actor,
      n: randomBytes(24).toString('base64url'),
      e: issuedAt + SHARE_TTL,
    };
    const sealed = cipher.seal(payload, 'my-marks-v1');
    const token = Buffer.concat([
      Buffer.from(sealed.iv, 'base64'),
      Buffer.from(sealed.tag, 'base64'),
      Buffer.from(sealed.ciphertext, 'base64'),
    ]).toString('base64url');
    return { host, actor, login, nonce: hash(payload.n), expiresAt: payload.e, token };
  }
  function open(token) {
    try {
      if (typeof token !== 'string' || token.length > 800 || !/^[A-Za-z0-9_-]+$/.test(token))
        throw Error();
      const b = Buffer.from(token, 'base64url');
      if (b.length < 29) throw Error();
      const x = cipher.open(
        {
          v: 1,
          iv: b.subarray(0, 12).toString('base64'),
          tag: b.subarray(12, 28).toString('base64'),
          ciphertext: b.subarray(28).toString('base64'),
        },
        'my-marks-v1',
      );
      const p = { login: x.l, host: x.h, actor: x.u, nonce: x.n, expiresAt: x.e };
      if (
        !p.login ||
        canonicalLogin(p.login) !== p.login ||
        !channels.includes(p.host) ||
        !/^\d{1,32}$/.test(p.actor) ||
        !/^[A-Za-z0-9_-]{32}$/.test(p.nonce) ||
        !Number.isFinite(p.expiresAt) ||
        p.expiresAt <= now() ||
        p.expiresAt > now() + SHARE_TTL
      )
        throw Error();
      return { ...p, nonce: hash(p.nonce) };
    } catch {
      throw Error('Share unavailable or expired');
    }
  }
  return { issue, open, link: (token) => `${origin}/my-marks#${token}` };
}
export function ownHistory(lineage, host, actor, offset = 0, limit = 20) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 2560 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    (lineage?.stops?.length ?? 0) > 16
  )
    throw Error('Invalid page');
  const entries = [];
  for (const s of lineage?.stops ?? []) {
    if (s.marks.length > 160) throw Error('Archive bound');
    if (s.from === host)
      for (const m of s.marks)
        if (m.userId === actor)
          entries.push({
            stopId: s.stopId,
            from: s.from,
            to: s.to,
            claimedAt: s.claimedAt,
            ringIndex: s.ringIndex,
            text: m.text,
            runeSvg: runeSvg(m.text),
          });
  }
  return {
    total: entries.length,
    offset,
    nextOffset: offset + limit < entries.length ? offset + limit : null,
    matches: entries.slice(offset, offset + limit),
  };
}
function approvedArchive(doc, lineage) {
  return {
    stops: (lineage?.stops ?? []).map((s) => ({
      ...s,
      marks: s.marks.filter((m) =>
        doc.sessions.some(
          (session) =>
            session.streamId === s.streamId &&
            session.marks.some(
              (current) =>
                current.id === m.id &&
                current.userId === m.userId &&
                current.text === m.text &&
                current.status === 'approved',
            ),
        ),
      ),
    })),
  };
}
export function reserveShare(doc, lineage, chat, share, now) {
  doc = structuredClone(doc);
  const requestHash = shareRequestHash(chat);
  // Identity grants are erasable; command idempotency must outlive their removal.
  // Check before alias invalidation, including commands previously rate-rejected.
  doc.shareReceipts = (doc.shareReceipts ?? []).filter((s) => s.expiresAt > now);
  if (doc.shareReceipts.some((s) => s.key === requestHash)) return doc;
  if (doc.shareReceipts.length >= 128) throw Error('Share receipt capacity reached');
  doc.shareReceipts.push({ key: requestHash, expiresAt: now + SHARE_TTL });
  if (Buffer.byteLength(JSON.stringify(doc)) > 131072) throw Error('Mark storage capacity reached');
  const rateKey = hash(`my-marks-rate:${chat.broadcasterId}:${chat.chatterId}`);
  doc.shareRates = (doc.shareRates ?? []).filter((s) => now - s.at < 60000);
  doc.shares = (doc.shares ?? []).filter((s) => s.expiresAt > now);
  // Only this explicit proven request can update ephemeral aliases; ordinary chat has no identity index.
  if (
    share &&
    chat.chatterLogin === share.login &&
    canonicalLogin(share.login) === share.login &&
    !chat.isBot &&
    !chat.copied
  ) {
    doc.shares = doc.shares.filter(
      (s) =>
        !(
          (s.actor === chat.chatterId && s.login !== share.login) ||
          (s.actor !== chat.chatterId && s.login === share.login)
        ),
    );
  }
  if (
    !share ||
    !share.login ||
    share.login !== chat.chatterLogin ||
    (chat.markAction.login && chat.markAction.login !== share.login) ||
    share.host !== chat.broadcasterId ||
    share.actor !== chat.chatterId ||
    share.expiresAt <= now ||
    share.expiresAt > now + SHARE_TTL ||
    chat.isBot ||
    !doc.context?.optedIn ||
    doc.paused ||
    doc.blocked.includes(chat.chatterId) ||
    doc.context.blockedUserIds.includes(chat.chatterId) ||
    doc.shares.some((s) => s.requestHash === shareRequestHash(chat)) ||
    doc.shares.length >= 8 ||
    doc.shareRates.length >= 128 ||
    doc.shareRates.some((s) => s.key === rateKey)
  )
    return doc;
  const count = ownHistory(approvedArchive(doc, lineage), share.host, share.actor).total;
  doc.shareRates.push({ key: rateKey, at: now });
  doc.shares.push({
    requestHash: shareRequestHash(chat),
    actor: share.actor,
    login: share.login,
    nonce: share.nonce,
    token: share.token,
    expiresAt: share.expiresAt,
    at: now,
    status: 'queued',
    count,
  });
  if (Buffer.byteLength(JSON.stringify(doc)) > 131072) throw Error('Mark storage capacity reached');
  return doc;
}
export function sharePage(doc, lineage, payload, now, offset, limit) {
  if (
    !doc?.context?.optedIn ||
    doc.paused ||
    doc.blocked.includes(payload.actor) ||
    doc.context.blockedUserIds.includes(payload.actor) ||
    !(doc.shares ?? []).some(
      (s) =>
        s.actor === payload.actor &&
        s.login === payload.login &&
        s.nonce === payload.nonce &&
        s.expiresAt === payload.expiresAt &&
        s.expiresAt > now,
    )
  )
    throw Error('Share unavailable');
  return {
    ...ownHistory(approvedArchive(doc, lineage), payload.host, payload.actor, offset, limit),
    login: payload.login,
  };
}
// Dispatch is marked BEFORE external chat HTTP. Ambiguous outcomes never retry.
export function shareStep(previous, op, now) {
  const doc = structuredClone(previous);
  const row = (doc?.shares ?? []).find((s) => s.nonce === op.nonce && s.expiresAt > now);
  let result = null;
  if (op.type === 'claim') {
    const next = (doc?.shares ?? []).find(
      (s) =>
        s.status === 'queued' &&
        s.expiresAt > now &&
        (op.requestHash === undefined || s.requestHash === op.requestHash),
    );
    if (next) {
      next.status = 'dispatching';
      result = structuredClone(next);
    }
  } else if (op.type === 'finish' && row?.status === 'dispatching')
    row.status = op.sent ? 'sent' : 'unknown';
  if (doc && Buffer.byteLength(JSON.stringify(doc)) > 131072)
    throw Error('Mark storage capacity reached');
  return { doc, result };
}
export function createShareReplies({ state, shares, bots, now = Date.now }) {
  return {
    async processPending(host, requestHash) {
      if (!bots[host]) throw Error('Unconfigured reply channel');
      const row = await state.shareReplyStep(
        host,
        { type: 'claim', ...(requestHash === undefined ? {} : { requestHash }) },
        now(),
      );
      if (!row) return { status: 'idle' };
      let sent = false;
      try {
        const page = await state.getOwnMarks(shares.open(row.token), now(), 0, 1);
        await bots[host].sendChat(
          `@${page.login}: ${page.total} approved retained entries. PUBLIC CHAT share; anyone can open (10min): ${shares.link(row.token)}`,
          { retryUnauthorized: false },
        );
        sent = true;
      } catch {
        /* Revoked/expired or ambiguous chat: never automatically retry. */
      }
      try {
        await state.shareReplyStep(host, { type: 'finish', nonce: row.nonce, sent }, now());
      } catch {
        /* Durable dispatching boundary remains non-retryable. */
      }
      return { status: sent ? 'sent' : 'unknown' };
    },
  };
}
