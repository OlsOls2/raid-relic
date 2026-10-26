import { hash } from './crypto.js';
export const presenceKey = (chat) =>
  chat &&
  !chat.isBot &&
  !chat.copied &&
  typeof chat.messageId === 'string' &&
  chat.messageId.length > 0 &&
  chat.messageId.length <= 256
    ? `presence:${hash(JSON.stringify([chat.broadcasterId, chat.chatterId, chat.messageId]))}`
    : null;
export function revokePresenceActor(previous, host, actor, now) {
  const doc = structuredClone(previous);
  doc.actors = doc.actors.filter((a) => a.id !== actor);
  doc.revocations = (doc.revocations ?? []).filter((r) => r.expiresAt > now);
  const key = hash(JSON.stringify([host, actor]));
  const existing = doc.revocations.find((r) => r.key === key);
  if (existing) {
    existing.through = Math.max(existing.through, now);
    existing.expiresAt = now + 600000;
  } else {
    if (doc.revocations.length >= 256) throw Error('Presence revocation capacity reached');
    doc.revocations.push({ key, through: now, expiresAt: now + 600000 });
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > 65536) throw Error('Presence capacity reached');
  return doc;
}
// Private, current authoritative stream only. No chat text/login or public identity index.
export function updatePresence(previous, host, channel, marks, chat, now, sentAt) {
  const streamId = channel?.online ? channel.streamId : channel?.retiredStream?.streamId;
  let doc = structuredClone(previous ?? { streamId: null, actors: [] });
  if (doc.streamId !== streamId)
    doc = {
      streamId: streamId ?? null,
      actors: [],
      revocations: doc.revocations ?? [],
      notBefore: previous ? Math.max(doc.notBefore ?? -1, channel?.lifecycleAt ?? now) : -1,
    };
  if (
    !channel?.optedIn ||
    channel.paused ||
    channel.banned ||
    marks?.paused ||
    !marks?.context?.optedIn
  ) {
    doc.actors = [];
    doc.notBefore = Math.max(doc.notBefore ?? -1, now);
  }
  doc.actors = doc.actors.filter(
    (a) =>
      !(channel?.blockedUserIds ?? []).includes(a.id) && !(marks?.blocked ?? []).includes(a.id),
  );
  doc.revocations = (doc.revocations ?? []).filter((r) => r.expiresAt > now);
  if (chat?.markAction?.type === 'forgetme')
    doc = revokePresenceActor(doc, host, chat.chatterId, now);
  else if (
    chat &&
    typeof chat.messageId === 'string' &&
    chat.messageId.length > 0 &&
    chat.messageId.length <= 256 &&
    chat.broadcasterId === host &&
    !chat.isBot &&
    !chat.copied &&
    channel?.online &&
    channel.optedIn &&
    !channel.paused &&
    !channel.banned &&
    !marks?.paused &&
    /^\d{1,32}$/.test(chat.chatterId) &&
    sentAt >= Math.max(channel.startedAt, channel.consentAt) &&
    sentAt <= now &&
    sentAt > (doc.notBefore ?? -1) &&
    !doc.revocations.some(
      (r) => r.key === hash(JSON.stringify([host, chat.chatterId])) && sentAt <= r.through,
    ) &&
    !channel.blockedUserIds.includes(chat.chatterId) &&
    !marks?.blocked.includes(chat.chatterId)
  ) {
    if (!doc.actors.some((a) => a.id === chat.chatterId)) {
      if (doc.actors.length >= 256) throw Error('Presence capacity reached');
      doc.actors.push({ id: chat.chatterId, seenAt: sentAt });
    }
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > 65536) throw Error('Presence capacity reached');
  return doc;
}
