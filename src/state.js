// Single-process test adapter. Firestore must make deduplication and ritual
// creation one transaction before any multi-instance deployment.
export function createMemoryState({ maxEvents = 10000 } = {}) {
  const seen = new Map();
  const rituals = new Map();
  const chatReceipts = new Map();
  return {
    accept({ id, expiresAt, now, raid, chat }) {
      for (const [key, expiry] of seen) if (expiry < now) seen.delete(key);
      for (const [key, ritual] of rituals) if (ritual.endsAt <= now) rituals.delete(key);
      if (seen.has(id)) return 'duplicate';
      if (seen.size >= maxEvents) return 'full';
      // No await between check and insertion: atomic within this process.
      seen.set(id, expiresAt);
      if (raid) rituals.set(raid.to_broadcaster_user_id, {
        eventId: id,
        incomingBroadcasterId: raid.from_broadcaster_user_id,
        hostBroadcasterId: raid.to_broadcaster_user_id,
        startedAt: now,
        endsAt: now + 90000,
      });
      if (chat) chatReceipts.set(chat.broadcasterId, { ...chat, receivedAt: now });
      return 'accepted';
    },
    getRitual(hostId) {
      const ritual = rituals.get(hostId);
      return ritual ? { ...ritual } : undefined;
    },
    getChatReceipt(hostId) { return structuredClone(chatReceipts.get(hostId)); },
  };
}
