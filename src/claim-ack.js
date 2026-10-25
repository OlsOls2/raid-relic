import { ChatSendError } from './bot.js';
import { hash } from './crypto.js';
export const ackKey = chat => hash(JSON.stringify(['claim-ack-v1', chat.broadcasterId, chat.chatterId, chat.messageId]));
const actorKey = (host, actor) => hash(`${host}:${actor}`);
export function ackDocument(previous, chat, message, channel, marks, now, deadline = now + 90000) {
  const doc = structuredClone(previous ?? { rows: [] }); doc.rows = doc.rows.filter(r => r.expiresAt > now);
  for (const row of doc.rows) if (row.status === 'queued' && (now >= row.ackUntil || !channel?.online || !channel?.optedIn || channel.paused || channel.banned || marks?.paused
    || !marks?.context?.optedIn || (chat?.markAction?.type === 'forgetme' && row.actorKey === actorKey(chat.broadcasterId, chat.chatterId))
    || (channel.blockedUserIds?.length > 0 || marks?.blocked?.length > 0)
    || [...(channel.blockedUserIds ?? []), ...(marks?.blocked ?? [])].some(id => row.actorKey === actorKey(chat?.broadcasterId ?? '', id)))) {
    row.status = 'cancelled'; delete row.message; delete row.actorKey; delete row.ackUntil;
  }
  if (chat && ['offer', 'accept'].includes(chat.markAction?.type) && !chat.isBot && !chat.copied) {
    const key = ackKey(chat);
    if (!doc.rows.some(r => r.key === key)) {
      if (doc.rows.length >= 128) throw Error('Claim ACK capacity reached');
      doc.rows.push({ key, expiresAt: now + 600000, status: message ? 'queued' : 'ignored', ...(message ? { message, ackUntil: deadline + 30000, actorKey: actorKey(chat.broadcasterId, chat.chatterId) } : {}) });
    }
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > 65536) throw Error('Claim ACK capacity reached');
  return doc;
}
export function ackSeen(doc, chat, now) { return chat && doc?.rows?.some(r => r.key === ackKey(chat) && r.expiresAt > now); }
export function ackStep(previous, op, channel, marks, now) {
  const doc = ackDocument(previous, null, null, channel, marks, now); const row = doc.rows.find(r => r.key === op.key); let result = null;
  if (op.type === 'claim' && row?.status === 'queued') { row.status = 'dispatching'; result = { message: row.message }; delete row.message; delete row.actorKey; delete row.ackUntil; }
  if (op.type === 'finish' && row?.status === 'dispatching') row.status = op.sent ? 'sent' : 'unknown';
  return { doc, result };
}
export function createClaimAcks({ state, bots, now = Date.now, logger = line => console.warn(line) }) {
  let queue = Promise.resolve();
  return { process(host, key) {
    const work = queue.then(async () => {
      const row = await state.claimAckStep(host, { type: 'claim', key }, now()); if (!row) return;
      let sent = false; let diagnostic = { stage: 'response', httpStatus: 200, dropKind: null, isSent: true };
      try { await bots[host].sendChat(row.message, { retryUnauthorized: false }); sent = true; } catch (error) { diagnostic = error instanceof ChatSendError ? error.diagnostic : { stage: 'unknown', httpStatus: null, dropKind: null, isSent: null }; }
      try { await state.claimAckStep(host, { type: 'finish', key, sent }, now()); } catch {}
      try { await logger(JSON.stringify({ severity: sent ? 'INFO' : 'WARNING', event: 'raid_relic_claim_ack', host, key, outcome: sent ? 'sent' : 'unknown', diagnostic })); } catch {}
    }); queue = work.catch(() => {}); return work;
  } };
}

export const completionAckKey = (host, eventId) => hash(`claim-completion:${host}:${eventId}`);
export function completionAck(previous, host, eventId, deadline, now) {
  const doc = structuredClone(previous ?? { rows: [] }); doc.rows = doc.rows.filter(r => r.expiresAt > now);
  const key = completionAckKey(host, eventId);
  if (!doc.rows.some(r => r.key === key)) {
    if (doc.rows.length >= 128) throw Error('Claim ACK capacity reached');
    doc.rows.push({ key, expiresAt: now + 600000, status: 'queued', message: 'Claim complete: verified raid and both chats reached the threshold. Relic transferred; one growth ring recorded.', ackUntil: deadline + 30000 });
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > 65536) throw Error('Claim ACK capacity reached');
  return { doc, key };
}
