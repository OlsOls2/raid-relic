import { updatePresence, presenceKey, revokePresenceActor } from './presence.js';
import { reserveShare, sharePage, shareStep } from './my-marks.js';
import { echoCandidate, reduceEcho, echoView } from './resonance.js';
import { forgeMutation } from './forge.js';
import { recapProjection } from './recap.js';
import { chronicleMutation } from './chronicle.js';
import { ackDocument, ackSeen, ackStep, completionAck } from './claim-ack.js';
import { hash as observationHash } from './crypto.js';
import { atlasPage, atlasSearch, claimMeterView, handoffView, withCarriedMarks, withIncomingPreview, keeperCandidates } from './public-view.js';
import { reduceClaims, emptyLineage, publicJourney } from './claims.js';
import { sendState } from './send-state.js';
import { lifecycleConfig, reduceLifecycle, emptyRegistry } from './lifecycle.js';
import { setMarkContext, reduceMark, publicMarks, publicOverlayState, privateMarks, isModerator, isChatIdentity } from './marks.js';

// Synchronous mutations are atomic within a single process; tests/dev only.
export function createMemoryState({ maxEvents = 10000, lifecycle } = {}) {
  const config = lifecycleConfig(lifecycle);
  let lineage = emptyLineage();
  let registry = emptyRegistry(); const channels = new Map();
  const seen = new Map();
  const rituals = new Map();
  const chatReceipts = new Map();
  const markDocs = new Map(); const ackDocs = new Map(); const presenceDocs = new Map();
  return {
    lifecycleEnabled: Boolean(config),
    accept({ id, expiresAt, now, raid, chat, lifecycle: providedEvent, observation, share, sentAt = now }) {
      for (const [key, expiry] of seen) if (expiry < now) seen.delete(key);
      for (const [key, ritual] of rituals) if (ritual.endsAt <= now) rituals.delete(key);
      if (seen.has(id)) return 'duplicate';
      if (seen.size >= maxEvents) return 'full';
      const pk = presenceKey(chat); const proofSeen = pk && seen.has(pk);
      if (pk && !proofSeen && seen.size + 2 > maxEvents) return 'full';
      const event = observation?.event ?? providedEvent;
      const host = event?.host ?? chat?.broadcasterId;
      if (config && host && !config.channels.includes(host)) throw new Error('Unconfigured lifecycle channel');
      if (chat?.copied && !echoCandidate(chat, config, now, sentAt)) {
        seen.set(id, expiresAt); return 'accepted';
      }
      if (config && chat && !chat.copied && !chat.markAction && !raid && !event && !observation) {
        if (!isChatIdentity(chat, host)) throw new Error('Authenticated chat identity required');
        presenceDocs.set(host, updatePresence(presenceDocs.get(host), host, channels.get(host), markDocs.get(host), proofSeen ? null : chat, now, sentAt));
        if (pk && !proofSeen) seen.set(pk, now + 600000);
        seen.set(id, expiresAt); chatReceipts.set(host, { broadcasterId: host, chatterId: chat.chatterId, messageId: chat.messageId, receivedAt: now }); return 'accepted';
      }
      if (chat?.copied) {
        const next = reduceEcho(registry, Object.fromEntries(channels), Object.fromEntries(markDocs), lineage, chat, now);
        seen.set(id, expiresAt); if (next) registry = next; return next ? 'resonance' : 'accepted';
      }
      if (observation) {
        if (!config || observationHash(JSON.stringify(channels.get(host) ?? null)) !== observation.baseline) return 'superseded';
        if (event.type === 'online' && channels.get(host)?.closedIds.includes(event.streamId)) return 'closed';
      }
      const transition = config && host ? reduceLifecycle({ registry, channel: channels.get(host), marks: markDocs.get(host), host, event, chat, now, sentAt, observed: Boolean(observation) }) : null;
      const markDoc = transition ? transition.marks : chat?.markAction ? reduceMark(markDocs.get(chat.broadcasterId), chat.broadcasterId, chat, chat.markAction, now) : null;
      let claiming; let sending; let presenceNext;
      if (config) {
        const channelMap = Object.fromEntries(channels); const markMap = Object.fromEntries(markDocs);
        if (transition) { channelMap[host] = transition.channel; markMap[host] = transition.marks; }
        presenceNext = Object.fromEntries(presenceDocs);
        for (const key of config.channels) {
          presenceNext[key] = updatePresence(presenceNext[key], key, channelMap[key], markMap[key], key === host && !proofSeen ? chat : null, now, sentAt);
          if (chat?.markAction?.type === 'forgetme') presenceNext[key] = revokePresenceActor(presenceNext[key], key, chat.chatterId, now);
        }
        const op = raid ? { type: 'raid', raid, id, sentAt } : chat?.markAction?.type === 'send'
          ? { type: 'reserve', source: host, actor: chat.chatterId, login: chat.markAction.login, id, sentAt } : { type: 'noop' };
        sending = sendState(transition?.registry ?? registry, channelMap, markMap, config, op, now);
        claiming = reduceClaims(sending.registry, channelMap, markMap, lineage, ackSeen(ackDocs.get(host), chat, now) ? null : chat, now, sentAt, presenceNext);
      }
      if (claiming && chat?.markAction?.type === 'mymarks') claiming.marks[host] = reserveShare(claiming.marks[host], claiming.lineage, chat, share, now);
      let raidAck;
      if (raid && claiming?.registry.pendingHop?.finalized && !registry.pendingHop?.finalized) {
        const h = claiming.registry.pendingHop; raidAck = completionAck(ackDocs.get(h.to), h.to, id, h.endsAt, now); raidAck.host = h.to;
      }
      const ackNext = claiming && host ? ackDocument(ackDocs.get(host), chat, claiming.acknowledgement, transition?.channel, claiming.marks[host], now, claiming.ackDeadline) : null;
      // No await between check and insertion: atomic within this process.
      if (pk && !proofSeen) seen.set(pk, now + 600000);
      if (raidAck) ackDocs.set(raidAck.host, raidAck.doc);
      if (presenceNext) for (const [key, value] of Object.entries(presenceNext)) presenceDocs.set(key, value);
      if (ackNext) ackDocs.set(host, ackNext);
      seen.set(id, expiresAt);
      if (raid && !config) rituals.set(raid.to_broadcaster_user_id, {
        eventId: id,
        incomingBroadcasterId: raid.from_broadcaster_user_id,
        hostBroadcasterId: raid.to_broadcaster_user_id,
        startedAt: now,
        endsAt: now + 90000,
      });
      if (transition) { registry = transition.registry; channels.set(host, transition.channel); }
      if (sending) { registry = sending.registry; if (sending.ritual) rituals.set(raid.to_broadcaster_user_id, sending.ritual); }
      if (markDoc) markDocs.set(host, markDoc);
      if (claiming) { registry = claiming.registry; lineage = claiming.lineage; for (const [key, doc] of Object.entries(claiming.marks)) markDocs.set(key, doc); }
      if (chat?.markAction?.type === 'forgetme' && chatReceipts.get(chat.broadcasterId)?.chatterId === chat.chatterId) chatReceipts.delete(chat.broadcasterId);
      if (chat && !chat.markAction) chatReceipts.set(chat.broadcasterId, { broadcasterId: chat.broadcasterId, chatterId: chat.chatterId, messageId: chat.messageId, receivedAt: now });
      return raidAck ? { status: 'accepted', completionAck: { host: raidAck.host, key: raidAck.key } } : observation ? (transition.channel.lifecycleAt === event.sentAt && transition.channel.lifecycleSource === 'helix-observation' ? 'applied' : 'no-change') : sending?.result ?? 'accepted';
    },
    getRitual(hostId) {
      const ritual = rituals.get(hostId);
      return ritual ? { ...ritual } : undefined;
    },
    getChatReceipt(hostId) { return structuredClone(chatReceipts.get(hostId)); },
    setKeeperContext(host, context) { if (config) throw new Error('Use signed lifecycle; raw context injection disabled'); markDocs.set(host, setMarkContext(markDocs.get(host), host, context)); },
    controlMarks(host, actor, action, now) {
      if (!isChatIdentity(actor, host)) throw new Error('Authenticated chat identity required');
      if (action.type !== 'forgetme' && !isModerator(actor, host)) throw new Error('Moderator identity required');
      if (config && !config.channels.includes(host)) throw new Error('Unconfigured lifecycle channel');
      const transition = config ? reduceLifecycle({ registry, channel: channels.get(host), marks: markDocs.get(host), host, chat: { ...actor, markAction: action }, now, sentAt: now }) : null;
      const doc = transition ? transition.marks : reduceMark(markDocs.get(host), host, actor, action, now);
      if (transition) { registry = transition.registry; channels.set(host, transition.channel); }
      if (config) {
        for (const key of config.channels) { const c = key === host ? transition.channel : channels.get(key); const m = key === host ? doc : markDocs.get(key);
          const nextPresence = updatePresence(presenceDocs.get(key), key, c, m, null, now, now);
          if (action.type === 'forgetme') Object.assign(nextPresence, revokePresenceActor(nextPresence, key, actor.chatterId, now));
          presenceDocs.set(key, nextPresence); }
      }
      if (config) ackDocs.set(host, ackDocument(ackDocs.get(host), { ...actor, markAction: action }, null, transition.channel, doc, now));
      markDocs.set(host, doc);
      if (config) { const next = reduceClaims(registry, Object.fromEntries(channels), Object.fromEntries(markDocs), lineage, null, now, now, Object.fromEntries(presenceDocs)); registry = next.registry; lineage = next.lineage; }
      if (action.type === 'forgetme' && chatReceipts.get(host)?.chatterId === actor.chatterId) chatReceipts.delete(host);
    },
    sendOffStep(op, now) {
      if (!config) throw new Error('Lifecycle required');
      const next = sendState(registry, Object.fromEntries(channels), Object.fromEntries(markDocs), config, op, now);
      registry = next.registry; return next.result;
    },
    getOwnMarks(payload, now, offset, limit) { return sharePage(markDocs.get(payload.host), lineage, payload, now, offset, limit); },
    shareReplyStep(host, op, now) { const next = shareStep(markDocs.get(host), op, now); if (next.doc) markDocs.set(host, next.doc); return next.result; },
    getKeeperCandidates(host) { return keeperCandidates(registry, Object.fromEntries(channels), Object.fromEntries(markDocs), config, host); },
    getPrivateClaimAcks(host) { return structuredClone(ackDocs.get(host)); },
    claimAckStep(host, op, now) { if (!config?.channels.includes(host)) throw Error('Unconfigured ACK'); const next = ackStep(ackDocs.get(host), op, channels.get(host), markDocs.get(host), now); ackDocs.set(host, next.doc); return next.result; },
    getKeeperRegistry() { return structuredClone(registry); },
    getStreamStatus(host) { return structuredClone(channels.get(host)); },
    setChannelPolicy(host, policy, now = Date.now()) {
      if (!config?.channels.includes(host)) throw new Error('Unconfigured lifecycle channel');
      const next = reduceLifecycle({ registry, channel: channels.get(host), marks: markDocs.get(host), host, policy, now, sentAt: now });
      presenceDocs.set(host, updatePresence(presenceDocs.get(host), host, next.channel, next.marks, null, now, now));
      ackDocs.set(host, ackDocument(ackDocs.get(host), { broadcasterId: host }, null, next.channel, next.marks, now));
      registry = next.registry; channels.set(host, next.channel); markDocs.set(host, next.marks);
      const checked = reduceClaims(registry, Object.fromEntries(channels), Object.fromEntries(markDocs), lineage, null, now, now, Object.fromEntries(presenceDocs)); registry = checked.registry; lineage = checked.lineage;
    },
    forgeStep(input) { const change = forgeMutation(lineage, input); if (change.next) lineage = change.next; return change.result; },
    chronicleStep(input) { const change = chronicleMutation(lineage, input); if (change.next) lineage = change.next; return change.result; },
    getRecap() { return recapProjection(lineage); },
    searchPublicMarks(options) { return atlasSearch(lineage, options); },
    getAtlasPage(options) { return atlasPage(lineage, options); },
    getPublicPresentation(host, now) { return { rings: lineage.stops.length, handoff: handoffView(registry, host, now, lineage), claimMeter: claimMeterView(registry, host, now), ...(echoView(registry, host, now) ? { resonance: echoView(registry, host, now) } : {}) }; },
    getPublicJourney() { return publicJourney(lineage); },
    getPublicMarks(host) { return publicMarks(markDocs.get(host), host); },
    getOverlayState(host, now = Date.now()) { return withIncomingPreview(withCarriedMarks(publicOverlayState(markDocs.get(host), host), lineage, registry, host), registry, host, Object.fromEntries(channels), Object.fromEntries(markDocs), now); },
    getPrivateMarks(host, actor) { return privateMarks(markDocs.get(host), host, actor); },
  };
}
