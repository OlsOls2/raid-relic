import { setMarkContext, reduceMark, publicMarks, publicOverlayState, privateMarks, isModerator, isChatIdentity } from './marks.js';

// Synchronous mutations are atomic within a single process; tests/dev only.
export function createMemoryState({ maxEvents = 10000 } = {}) {
  const seen = new Map();
  const rituals = new Map();
  const chatReceipts = new Map();
  const markDocs = new Map();
  return {
    accept({ id, expiresAt, now, raid, chat }) {
      for (const [key, expiry] of seen) if (expiry < now) seen.delete(key);
      for (const [key, ritual] of rituals) if (ritual.endsAt <= now) rituals.delete(key);
      if (seen.has(id)) return 'duplicate';
      if (seen.size >= maxEvents) return 'full';
      const markDoc = chat?.markAction ? reduceMark(markDocs.get(chat.broadcasterId), chat.broadcasterId, chat, chat.markAction, now) : null;
      // No await between check and insertion: atomic within this process.
      seen.set(id, expiresAt);
      if (raid) rituals.set(raid.to_broadcaster_user_id, {
        eventId: id,
        incomingBroadcasterId: raid.from_broadcaster_user_id,
        hostBroadcasterId: raid.to_broadcaster_user_id,
        startedAt: now,
        endsAt: now + 90000,
      });
      if (markDoc) markDocs.set(chat.broadcasterId, markDoc);
      if (chat?.markAction?.type === 'forgetme' && chatReceipts.get(chat.broadcasterId)?.chatterId === chat.chatterId) chatReceipts.delete(chat.broadcasterId);
      if (chat && !chat.markAction) chatReceipts.set(chat.broadcasterId, { broadcasterId: chat.broadcasterId, chatterId: chat.chatterId, messageId: chat.messageId, receivedAt: now });
      return 'accepted';
    },
    getRitual(hostId) {
      const ritual = rituals.get(hostId);
      return ritual ? { ...ritual } : undefined;
    },
    getChatReceipt(hostId) { return structuredClone(chatReceipts.get(hostId)); },
    setKeeperContext(host, context) { markDocs.set(host, setMarkContext(markDocs.get(host), host, context)); },
    controlMarks(host, actor, action, now) {
      if (!isChatIdentity(actor, host)) throw new Error('Authenticated chat identity required');
      if (action.type !== 'forgetme' && !isModerator(actor, host)) throw new Error('Moderator identity required');
      const doc = reduceMark(markDocs.get(host), host, actor, action, now);
      markDocs.set(host, doc);
      if (action.type === 'forgetme' && chatReceipts.get(host)?.chatterId === actor.chatterId) chatReceipts.delete(host);
    },
    getPublicMarks(host) { return publicMarks(markDocs.get(host), host); },
    getOverlayState(host) { return publicOverlayState(markDocs.get(host), host); },
    getPrivateMarks(host, actor) { return privateMarks(markDocs.get(host), host, actor); },
  };
}
