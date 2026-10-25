import { hash } from './crypto.js';
import { setMarkContext, reduceMark, publicMarks, privateMarks, isModerator, isChatIdentity } from './marks.js';

export function ritualFor(id, now, raid) {
  return { eventId: id, incomingBroadcasterId: raid.from_broadcaster_user_id,
    hostBroadcasterId: raid.to_broadcaster_user_id, startedAt: now, endsAt: now + 90000 };
}

// Generic auth records contain only state hashes, encrypted tokens and lease metadata.
export function createMemoryAuthStore() {
  const records = new Map();
  return {
    async createState(id, record, now) {
      for (const [key, value] of records) if (!key.includes(':') && value.expiresAt <= now) records.delete(key);
      if (records.has(id) || records.size >= 1024) throw new Error('OAuth state capacity reached');
      records.set(id, structuredClone(record));
    },
    async consumeState(id, binding, now) {
      const record = records.get(id);
      if (!record || record.binding !== binding || record.expiresAt <= now) return null;
      records.delete(id);
      return structuredClone(record);
    },
    async getToken(role) { return structuredClone(records.get(`token:${role}`)); },
    async acquire(role, owner, now) {
      const lease = records.get(`lease:${role}`);
      if (lease && lease.expiresAt > now) return false;
      records.set(`lease:${role}`, { owner, expiresAt: now + 30000 }); return true;
    },
    async saveToken(role, value, owner, now) {
      const lease = records.get(`lease:${role}`);
      if (lease?.owner !== owner || lease.expiresAt <= now) throw new Error('Token lease lost');
      records.set(`token:${role}`, structuredClone(value));
    },
    async release(role, owner) { if (records.get(`lease:${role}`)?.owner === owner) records.delete(`lease:${role}`); },
  };
}

export function createFirestoreStore(db) {
  const ref = (collection, key) => db.collection(collection).doc(hash(key));
  return {
    async accept({ id, expiresAt, now, raid, chat }) {
      return db.runTransaction(async tx => {
        const eventRef = ref('events', id);
        const existing = await tx.get(eventRef);
        if (existing.exists && existing.data().expiresAt >= now) return 'duplicate';
        const markRef = chat?.markAction ? ref('markChannels', chat.broadcasterId) : null;
        const markDoc = markRef ? (await tx.get(markRef)).data() : null;
        const receiptRef = chat?.markAction?.type === 'forgetme' ? ref('chatReceipts', chat.broadcasterId) : null;
        const receipt = receiptRef ? (await tx.get(receiptRef)).data() : null;
        const next = markRef ? reduceMark(markDoc, chat.broadcasterId, chat, chat.markAction, now) : null;
        tx.set(eventRef, { expiresAt });
        if (raid) tx.set(ref('rituals', raid.to_broadcaster_user_id), ritualFor(id, now, raid));
        // Store only bounded metadata, never raw chat text or proof of membership.
        if (next) tx.set(markRef, next);
        if (receipt && receipt.chatterId === chat?.chatterId) tx.delete(receiptRef);
        if (chat && !chat.markAction) tx.set(ref('chatReceipts', chat.broadcasterId), { messageId: chat.messageId, chatterId: chat.chatterId, receivedAt: now });
        return 'accepted';
      });
    },
    async getRitual(hostId) { return (await ref('rituals', hostId).get()).data(); },
    async setKeeperContext(host, context) {
      await db.runTransaction(async tx => {
        const doc = ref('markChannels', host); const previous = (await tx.get(doc)).data();
        tx.set(doc, setMarkContext(previous, host, context));
      });
    },
    async controlMarks(host, actor, action, now) {
      if (!isChatIdentity(actor, host)) throw new Error('Authenticated chat identity required');
      if (action.type !== 'forgetme' && !isModerator(actor, host)) throw new Error('Moderator identity required');
      await db.runTransaction(async tx => {
        const doc = ref('markChannels', host); const previous = (await tx.get(doc)).data();
        const receiptRef = ref('chatReceipts', host);
        const receipt = action.type === 'forgetme' ? (await tx.get(receiptRef)).data() : null;
        tx.set(doc, reduceMark(previous, host, actor, action, now));
        if (receipt && receipt.chatterId === actor?.chatterId) tx.delete(receiptRef);
      });
    },
    async getPublicMarks(host) { return publicMarks((await ref('markChannels', host).get()).data(), host); },
    async getPrivateMarks(host, actor) {
      if (!isModerator(actor, host)) throw new Error('Moderator identity required');
      return privateMarks((await ref('markChannels', host).get()).data(), host, actor);
    },
    async createState(id, record) { await ref('oauthStates', id).create(record); },
    async consumeState(id, binding, now) {
      return db.runTransaction(async tx => {
        const doc = ref('oauthStates', id); const snap = await tx.get(doc); const record = snap.data();
        if (!snap.exists || record.binding !== binding || record.expiresAt <= now) return null;
        tx.delete(doc); return record;
      });
    },
    async getToken(role) { return (await ref('oauthTokens', role).get()).data(); },
    async acquire(role, owner, now) {
      return db.runTransaction(async tx => {
        const doc = ref('tokenLeases', role); const snap = await tx.get(doc);
        if (snap.exists && snap.data().expiresAt > now) return false;
        tx.set(doc, { owner, expiresAt: now + 30000 }); return true;
      });
    },
    async saveToken(role, value, owner, now) {
      await db.runTransaction(async tx => {
        const lease = (await tx.get(ref('tokenLeases', role))).data();
        if (lease?.owner !== owner || lease.expiresAt <= now) throw new Error('Token lease lost');
        tx.set(ref('oauthTokens', role), value);
      });
    },
    async release(role, owner) {
      await db.runTransaction(async tx => {
        const doc = ref('tokenLeases', role); const snap = await tx.get(doc);
        if (snap.data()?.owner === owner) tx.delete(doc);
      });
    },
  };
}
