import { ackDocument, ackSeen, ackStep } from './claim-ack.js';
import { hash as observationHash } from './crypto.js';
import { atlasPage, handoffView, withCarriedMarks, withIncomingPreview } from './public-view.js';
import { reduceClaims, publicJourney } from './claims.js';
import { sendState } from './send-state.js';
import { lifecycleConfig, reduceLifecycle } from './lifecycle.js';
import { hash } from './crypto.js';
import { setMarkContext, reduceMark, publicMarks, publicOverlayState, privateMarks, isModerator, isChatIdentity } from './marks.js';

export function ritualFor(id, now, raid) {
  return { eventId: id, incomingBroadcasterId: raid.from_broadcaster_user_id,
    hostBroadcasterId: raid.to_broadcaster_user_id, startedAt: now, endsAt: now + 90000 };
}

// Generic auth records contain only state hashes, encrypted tokens and lease metadata.
export function createMemoryAuthStore() {
  const records = new Map();
  return {
    async acquireJob(id, owner, now) { const previous = records.get(`job:${id}`); if (previous?.expiresAt > now) return false;
      records.set(`job:${id}`, { owner, expiresAt: now + 300000, status: 'running' }); return true; },
    async finishJob(id, owner, result) { const job = records.get(`job:${id}`); if (job?.owner === owner) records.set(`job:${id}`, { expiresAt: 0, result }); },
    async getJob(id) { return structuredClone(records.get(`job:${id}`)?.result ?? null); },
    async createControlSession(id, record) { records.set(`control:${id}`, structuredClone(record)); },
    async getControlSession(id, sessionHash, now) { const r = records.get(`control:${id}`); return r?.sessionHash === sessionHash && r.expiresAt > now ? structuredClone(r) : null; },
    async revokeControlSession(id, sessionHash, now) { const r = records.get(`control:${id}`); if (r?.sessionHash !== sessionHash || r.expiresAt <= now) return false; records.delete(`control:${id}`); return true; },
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

export function createFirestoreStore(db, { lifecycle } = {}) {
  const config = lifecycleConfig(lifecycle);
  const ref = (collection, key) => db.collection(collection).doc(hash(key));
  return {
    lifecycleEnabled: Boolean(config),
    async accept({ id, expiresAt, now, raid, chat, lifecycle: providedEvent, observation, sentAt = now }) {
      return db.runTransaction(async tx => {
        const eventRef = ref('events', id);
        const existing = await tx.get(eventRef);
        if (existing.exists && existing.data().expiresAt >= now) return 'duplicate';
        const event = observation?.event ?? providedEvent;
        const host = event?.host ?? chat?.broadcasterId;
        if (config && host && !config.channels.includes(host)) throw new Error('Unconfigured lifecycle channel');
        if (config && chat && !chat.markAction && !raid && !event && !observation) {
          if (!isChatIdentity(chat, host)) throw new Error('Authenticated chat identity required');
          tx.set(eventRef, { expiresAt }); tx.set(ref('chatReceipts', host), { messageId: chat.messageId, chatterId: chat.chatterId, receivedAt: now }); return 'accepted';
        }
        const managed = config && (host || raid);
        const registry = managed ? (await tx.get(ref('keeperRegistry', 'single'))).data() : null;
        const channelMap = {}; const markMap = {};
        if (managed) for (const channelId of config.channels) {
          channelMap[channelId] = (await tx.get(ref('streamChannels', channelId))).data();
          markMap[channelId] = (await tx.get(ref('markChannels', channelId))).data();
        }
        const lineage = managed ? (await tx.get(ref('lineage', 'single'))).data() : null;
        const ackRef = managed && host ? ref('claimAcks', host) : null;
        const ackDoc = ackRef ? (await tx.get(ackRef)).data() : null;
        const channel = channelMap[host];
        if (observation) {
          if (!managed || observationHash(JSON.stringify(channel ?? null)) !== observation.baseline) return 'superseded';
          if (event.type === 'online' && channel?.closedIds.includes(event.streamId)) return 'closed';
        }
        const markRef = host && (managed || chat?.markAction) ? ref('markChannels', host) : null;
        const markDoc = managed ? markMap[host] : markRef ? (await tx.get(markRef)).data() : null;
        const receiptRef = chat?.markAction?.type === 'forgetme' ? ref('chatReceipts', chat.broadcasterId) : null;
        const receipt = receiptRef ? (await tx.get(receiptRef)).data() : null;
        const transition = managed && host ? reduceLifecycle({ registry, channel, marks: markDoc, host, event, chat, now, sentAt, observed: Boolean(observation) }) : null;
        const next = transition ? transition.marks : markRef ? reduceMark(markDoc, chat.broadcasterId, chat, chat.markAction, now) : null;
        let claiming; let sending;
        if (managed) {
          if (transition) { channelMap[host] = transition.channel; markMap[host] = transition.marks; }
          const op = raid ? { type: 'raid', raid, id, sentAt } : chat?.markAction?.type === 'send'
            ? { type: 'reserve', source: host, actor: chat.chatterId, login: chat.markAction.login, id, sentAt } : { type: 'noop' };
          sending = sendState(transition?.registry ?? registry, channelMap, markMap, config, op, now);
          claiming = reduceClaims(sending.registry, channelMap, markMap, lineage, ackSeen(ackDoc, chat, now) ? null : chat, now, sentAt);
        }
        if (claiming && ackRef) tx.set(ackRef, ackDocument(ackDoc, chat, claiming.acknowledgement, transition?.channel, claiming.marks[host], now, claiming.ackDeadline));
        tx.set(eventRef, { expiresAt });
        if (transition) { tx.set(ref('keeperRegistry', 'single'), transition.registry); tx.set(ref('streamChannels', host), transition.channel); }
        if (raid && !config) tx.set(ref('rituals', raid.to_broadcaster_user_id), ritualFor(id, now, raid));
        if (sending) { tx.set(ref('keeperRegistry', 'single'), sending.registry); if (sending.ritual) tx.set(ref('rituals', raid.to_broadcaster_user_id), sending.ritual); }
        // Store only bounded metadata, never raw chat text or proof of membership.
        if (next) tx.set(markRef, next);
        if (claiming) {
          tx.set(ref('keeperRegistry', 'single'), claiming.registry); tx.set(ref('lineage', 'single'), claiming.lineage);
          for (const [key, doc] of Object.entries(claiming.marks)) if (doc) tx.set(ref('markChannels', key), doc);
        }
        if (receipt && receipt.chatterId === chat?.chatterId) tx.delete(receiptRef);
        if (chat && !chat.markAction) tx.set(ref('chatReceipts', chat.broadcasterId), { messageId: chat.messageId, chatterId: chat.chatterId, receivedAt: now });
        return observation ? (transition.channel.lifecycleAt === event.sentAt && transition.channel.lifecycleSource === 'helix-observation' ? 'applied' : 'no-change') : sending?.result ?? 'accepted';
      });
    },
    async getPrivateClaimAcks(host) { return (await ref('claimAcks', host).get()).data(); },
    async claimAckStep(host, op, now) {
      if (!config?.channels.includes(host)) throw Error('Unconfigured ACK');
      return db.runTransaction(async tx => {
        const doc = ref('claimAcks', host), previous = (await tx.get(doc)).data();
        const channel = (await tx.get(ref('streamChannels', host))).data(), marks = (await tx.get(ref('markChannels', host))).data();
        const next = ackStep(previous, op, channel, marks, now); tx.set(doc, next.doc); return next.result;
      });
    },
    async getRitual(hostId) { return (await ref('rituals', hostId).get()).data(); },
    async setKeeperContext(host, context) {
      if (config) throw new Error('Use signed lifecycle; raw context injection disabled');
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
        let next;
        if (config) {
          if (!config.channels.includes(host)) throw new Error('Unconfigured lifecycle channel');
          const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
          const channel = (await tx.get(ref('streamChannels', host))).data();
          const history = (await tx.get(ref('lineage', 'single'))).data(); const channelMap = {}; const markMap = {};
          for (const key of config.channels) { channelMap[key] = (await tx.get(ref('streamChannels', key))).data(); markMap[key] = (await tx.get(ref('markChannels', key))).data(); }
          const ackRef = ref('claimAcks', host), ackDoc = (await tx.get(ackRef)).data();
          const transition = reduceLifecycle({ registry, channel, marks: previous, host, chat: { ...actor, markAction: action }, now, sentAt: now });
          channelMap[host] = transition.channel; markMap[host] = transition.marks;
          const checked = reduceClaims(transition.registry, channelMap, markMap, history, null, now);
          tx.set(ackRef, ackDocument(ackDoc, { ...actor, markAction: action }, null, transition.channel, transition.marks, now));
          tx.set(ref('lineage', 'single'), checked.lineage);
          tx.set(ref('keeperRegistry', 'single'), checked.registry); tx.set(ref('streamChannels', host), transition.channel); next = transition.marks;
        } else next = reduceMark(previous, host, actor, action, now);
        tx.set(doc, next);
        if (receipt && receipt.chatterId === actor?.chatterId) tx.delete(receiptRef);
      });
    },
    async sendOffStep(op, now) {
      if (!config) throw new Error('Lifecycle required');
      return db.runTransaction(async tx => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data(); const channels = {}; const marks = {};
        for (const host of config.channels) {
          channels[host] = (await tx.get(ref('streamChannels', host))).data(); marks[host] = (await tx.get(ref('markChannels', host))).data();
        }
        const next = sendState(registry, channels, marks, config, op, now);
        tx.set(ref('keeperRegistry', 'single'), next.registry); return next.result;
      });
    },
    async getKeeperRegistry() { return (await ref('keeperRegistry', 'single').get()).data() ?? { holderId: null, originated: false }; },
    async getStreamStatus(host) { return (await ref('streamChannels', host).get()).data(); },
    async setChannelPolicy(host, policy, now = Date.now()) {
      if (!config?.channels.includes(host)) throw new Error('Unconfigured lifecycle channel');
      await db.runTransaction(async tx => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const channel = (await tx.get(ref('streamChannels', host))).data();
        const marks = (await tx.get(ref('markChannels', host))).data();
        const history = (await tx.get(ref('lineage', 'single'))).data(); const channelMap = {}; const markMap = {};
        for (const key of config.channels) { channelMap[key] = (await tx.get(ref('streamChannels', key))).data(); markMap[key] = (await tx.get(ref('markChannels', key))).data(); }
        const ackRef = ref('claimAcks', host), ackDoc = (await tx.get(ackRef)).data();
        const next = reduceLifecycle({ registry, channel, marks, host, policy, now, sentAt: now });
        channelMap[host] = next.channel; markMap[host] = next.marks;
        const checked = reduceClaims(next.registry, channelMap, markMap, history, null, now);
        tx.set(ackRef, ackDocument(ackDoc, { broadcasterId: host }, null, next.channel, next.marks, now));
        tx.set(ref('lineage', 'single'), checked.lineage);
        tx.set(ref('keeperRegistry', 'single'), checked.registry); tx.set(ref('streamChannels', host), next.channel); tx.set(ref('markChannels', host), next.marks);
      });
    },
    async getAtlasPage(options) { return atlasPage((await ref('lineage', 'single').get()).data(), options); },
    async getPublicPresentation(host, now) {
      return db.runTransaction(async tx => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const lineage = (await tx.get(ref('lineage', 'single'))).data();
        return { rings: lineage?.stops?.length ?? 0, handoff: handoffView(registry, host, now) };
      });
    },
    async getPublicJourney() { return publicJourney((await ref('lineage', 'single').get()).data()); },
    async getPublicMarks(host) { return publicMarks((await ref('markChannels', host).get()).data(), host); },
    async getOverlayState(host, now = Date.now()) {
      return db.runTransaction(async tx => {
        const doc = (await tx.get(ref('markChannels', host))).data();
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const lineage = (await tx.get(ref('lineage', 'single'))).data();
        const channels = {}, docs = { [host]: doc };
        if (registry?.pendingHop?.to === host && !registry.pendingHop.finalized && !registry.pendingHop.cancelled && now < registry.pendingHop.endsAt) {
          for (const id of [registry.pendingHop.from, host]) {
            channels[id] = (await tx.get(ref('streamChannels', id))).data();
            if (id !== host) docs[id] = (await tx.get(ref('markChannels', id))).data();
          }
        }
        return withIncomingPreview(withCarriedMarks(publicOverlayState(doc, host), lineage, registry, host), registry, host, channels, docs, now);
      });
    },
    async getPrivateMarks(host, actor) {
      if (!isModerator(actor, host)) throw new Error('Moderator identity required');
      return privateMarks((await ref('markChannels', host).get()).data(), host, actor);
    },
    async acquireJob(id, owner, now) {
      return db.runTransaction(async tx => { const doc = ref('bootstrapJobs', id); const job = (await tx.get(doc)).data();
        if (job?.expiresAt > now) return false; tx.set(doc, { owner, expiresAt: now + 300000, status: 'running' }); return true; });
    },
    async finishJob(id, owner, result) {
      await db.runTransaction(async tx => { const doc = ref('bootstrapJobs', id); const job = (await tx.get(doc)).data();
        if (job?.owner === owner) tx.set(doc, { expiresAt: 0, result }); });
    },
    async getJob(id) { return (await ref('bootstrapJobs', id).get()).data()?.result ?? null; },
    async createControlSession(id, record) {
      await db.runTransaction(async tx => { const doc = ref('controlSessions', id); await tx.get(doc); tx.set(doc, record); });
    },
    async getControlSession(id, sessionHash, now) {
      return db.runTransaction(async tx => { const r = (await tx.get(ref('controlSessions', id))).data(); return r?.sessionHash === sessionHash && r.expiresAt > now ? r : null; });
    },
    async revokeControlSession(id, sessionHash, now) {
      return db.runTransaction(async tx => { const doc = ref('controlSessions', id); const r = (await tx.get(doc)).data();
        if (r?.sessionHash !== sessionHash || r.expiresAt <= now) return false; tx.delete(doc); return true; });
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
