import { createHmac, randomBytes } from 'node:crypto';
import { createTokenCipher, hash } from './crypto.js';
import { runeSvg } from './marks.js';
export const SHARE_TTL = 600000;
export function createMarkShares({ key, channels, origin, now = Date.now }) {
  const secret = Buffer.from(key ?? '', 'base64'); if (secret.length !== 32 || !channels?.length || new URL(origin).origin !== origin) throw Error('Share configuration required');
  const cipher = createTokenCipher(createHmac('sha256', secret).update('raid-relic-own-marks-v1').digest('base64'));
  function issue(host, actor, issuedAt = now()) {
    if (!channels.includes(host) || !/^\d{1,32}$/.test(actor)) throw Error('Invalid share scope');
    const payload = { h: host, u: actor, n: randomBytes(24).toString('base64url'), e: issuedAt + SHARE_TTL };
    const sealed = cipher.seal(payload, 'my-marks-v1');
    const token = Buffer.concat([Buffer.from(sealed.iv, 'base64'), Buffer.from(sealed.tag, 'base64'), Buffer.from(sealed.ciphertext, 'base64')]).toString('base64url');
    return { host, actor, nonce: hash(payload.n), expiresAt: payload.e, token };
  }
  function open(token) {
    try {
      if (typeof token !== 'string' || token.length > 800 || !/^[A-Za-z0-9_-]+$/.test(token)) throw Error();
      const b = Buffer.from(token, 'base64url'); if (b.length < 29) throw Error();
      const x = cipher.open({ v: 1, iv: b.subarray(0, 12).toString('base64'), tag: b.subarray(12, 28).toString('base64'), ciphertext: b.subarray(28).toString('base64') }, 'my-marks-v1');
      const p = { host: x.h, actor: x.u, nonce: x.n, expiresAt: x.e };
      if (!channels.includes(p.host) || !/^\d{1,32}$/.test(p.actor) || !/^[A-Za-z0-9_-]{32}$/.test(p.nonce) || !Number.isFinite(p.expiresAt) || p.expiresAt <= now() || p.expiresAt > now() + SHARE_TTL) throw Error();
      return { ...p, nonce: hash(p.nonce) };
    } catch { throw Error('Share unavailable or expired'); }
  }
  return { issue, open, link: token => `${origin}/my-marks#${token}` };
}
export function ownHistory(lineage, host, actor, offset = 0, limit = 20) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 2560 || !Number.isInteger(limit) || limit < 1 || limit > 20 || (lineage?.stops?.length ?? 0) > 16) throw Error('Invalid page');
  const entries = [];
  for (const s of lineage?.stops ?? []) {
    if (s.marks.length > 160) throw Error('Archive bound');
    if (s.from === host) for (const m of s.marks) if (m.userId === actor) entries.push({ stopId: s.stopId, from: s.from, to: s.to, claimedAt: s.claimedAt, ringIndex: s.ringIndex, text: m.text, runeSvg: runeSvg(m.text) });
  }
  return { total: entries.length, offset, nextOffset: offset + limit < entries.length ? offset + limit : null, matches: entries.slice(offset, offset + limit) };
}
function approvedArchive(doc, lineage) {
  return { stops: (lineage?.stops ?? []).map(s => ({ ...s, marks: s.marks.filter(m => doc.sessions.some(session => session.streamId === s.streamId && session.marks.some(current => current.id === m.id && current.userId === m.userId && current.text === m.text && current.status === 'approved'))) })) };
}
export function reserveShare(doc, lineage, chat, share, now) {
  doc = structuredClone(doc);
  const rateKey = hash(`my-marks-rate:${chat.broadcasterId}:${chat.chatterId}`);
  doc.shareRates = (doc.shareRates ?? []).filter(s => now - s.at < 60000);
  doc.shares = (doc.shares ?? []).filter(s => s.expiresAt > now);
  if (!share || share.host !== chat.broadcasterId || share.actor !== chat.chatterId || share.expiresAt <= now || share.expiresAt > now + SHARE_TTL || chat.isBot
    || !doc.context?.optedIn || doc.paused || doc.blocked.includes(chat.chatterId) || doc.context.blockedUserIds.includes(chat.chatterId)
    || doc.shares.length >= 8 || doc.shareRates.length >= 128 || doc.shareRates.some(s => s.key === rateKey)) return doc;
  const count = ownHistory(approvedArchive(doc, lineage), share.host, share.actor).total;
  doc.shareRates.push({ key: rateKey, at: now });
  doc.shares.push({ actor: share.actor, nonce: share.nonce, token: share.token, expiresAt: share.expiresAt, at: now, status: 'queued', count });
  if (Buffer.byteLength(JSON.stringify(doc)) > 131072) throw Error('Mark storage capacity reached');
  return doc;
}
export function sharePage(doc, lineage, payload, now, offset, limit) {
  if (!doc?.context?.optedIn || doc.paused || doc.blocked.includes(payload.actor) || doc.context.blockedUserIds.includes(payload.actor)
    || !(doc.shares ?? []).some(s => s.actor === payload.actor && s.nonce === payload.nonce && s.expiresAt === payload.expiresAt && s.expiresAt > now)) throw Error('Share unavailable');
  return ownHistory(approvedArchive(doc, lineage), payload.host, payload.actor, offset, limit);
}
// Dispatch is marked BEFORE external chat HTTP. Ambiguous outcomes never retry.
export function shareStep(previous, op, now) {
  const doc = structuredClone(previous); const row = (doc?.shares ?? []).find(s => s.nonce === op.nonce && s.expiresAt > now);
  let result = null;
  if (op.type === 'claim') {
    const next = (doc?.shares ?? []).find(s => s.status === 'queued' && s.expiresAt > now);
    if (next) { next.status = 'dispatching'; result = structuredClone(next); }
  } else if (op.type === 'finish' && row?.status === 'dispatching') row.status = op.sent ? 'sent' : 'unknown';
  if (doc && Buffer.byteLength(JSON.stringify(doc)) > 131072) throw Error('Mark storage capacity reached');
  return { doc, result };
}
export function createShareReplies({ state, shares, bots, now = Date.now }) {
  return { async processPending(host) {
    if (!bots[host]) throw Error('Unconfigured reply channel');
    const row = await state.shareReplyStep(host, { type: 'claim' }, now());
    if (!row) return { status: 'idle' };
    let sent = false;
    try {
      const page = await state.getOwnMarks(shares.open(row.token), now(), 0, 1);
      await bots[host].sendChat(`${page.total} retained approved mark entries. You opted to share this history in PUBLIC CHAT; anyone can open (10min): ${shares.link(row.token)}`);
      sent = true;
    } catch { /* Revoked/expired or ambiguous chat: never automatically retry. */ }
    await state.shareReplyStep(host, { type: 'finish', nonce: row.nonce, sent }, now());
    return { status: sent ? 'sent' : 'unknown' };
  } };
}
