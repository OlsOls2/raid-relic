import {streakView} from './streaks.js';
import { enqueueP7, p7Mutation, cancelP7 } from './p7.js';
import { journeyMap } from './journey-map.js';
import { reduceScores, retainedScores, scoreboard, scoreMessage, isScoreCommand, isReplyCommand, scoreAckDocument, scoreAckMutation } from './scoreboard.js';
import { updatePresence, presenceKey, revokePresenceActor } from './presence.js';
import { reserveShare, sharePage, shareStep } from './my-marks.js';
import { echoCandidate, reduceEcho, echoView } from './resonance.js';
import { forgeMutation } from './forge.js';
import { recapProjection } from './recap.js';
import { chronicleMutation } from './chronicle.js';
import { ackDocument, ackSeen, ackStep, completionAck, completionEligible, cancelCompletionNotices } from './claim-ack.js';
import { hash as observationHash } from './crypto.js';
import { atlasPage, atlasSearch, movedToView, claimMeterView, handoffView, withCarriedMarks, withIncomingPreview, keeperCandidates } from './public-view.js';
import { reduceClaims, emptyLineage, publicJourney } from './claims.js';
import { sendState } from './send-state.js';
import { lifecycleConfig, reduceLifecycle, emptyRegistry } from './lifecycle.js';
import { setMarkContext, reduceMark, publicMarks, publicOverlayState, privateMarks, isModerator, isChatIdentity, markPrivacyChange, trustedReviewPolicy } from './marks.js';

// Synchronous mutations are atomic within a single process; tests/dev only.
export function createMemoryState({ maxEvents = 10000, lifecycle, p7Enabled = false, reviewPolicy } = {}) {
  const config = lifecycleConfig(lifecycle);
  reviewPolicy=trustedReviewPolicy(reviewPolicy);
  p7Enabled=Boolean(p7Enabled&&config);
  let lineage = emptyLineage(); let scores;
  let registry = emptyRegistry(); const channels = new Map();
  const seen = new Map(); const completionReceipts = new Map();
  const rituals = new Map();const p7Docs=new Map();
  const chatReceipts = new Map();
  const markDocs = new Map(); const scoreAckDocs = new Map(); const ackDocs = new Map(); const presenceDocs = new Map();
  return {
    lifecycleEnabled: Boolean(config),
    accept({ id, expiresAt, now, raid, chat, lifecycle: providedEvent, observation, share, sentAt = now }) {
      for (const [key, expiry] of seen) if (expiry < now) seen.delete(key);
      for (const [key, ritual] of rituals) if (ritual.endsAt <= now) rituals.delete(key);
      for(const[key,value]of completionReceipts)if(value.until<now)completionReceipts.delete(key);
      if (seen.has(id)) return completionReceipts.has(id) ? {status:'duplicate',completionAcks:completionReceipts.get(id).rows} : 'duplicate';
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
      const transition = config && host ? reduceLifecycle({ reviewPolicy, registry, channel: channels.get(host), marks: markDocs.get(host), host, event, chat:proofSeen?null:chat, now, sentAt, observed: Boolean(observation) }) : null;
      const markDoc = transition ? transition.marks : !proofSeen&&chat?.markAction ? reduceMark(markDocs.get(chat.broadcasterId), chat.broadcasterId, chat, chat.markAction, now, reviewPolicy) : null;
      const privacyChanged=event?.type==='ban'||(!proofSeen&&markPrivacyChange(markDocs.get(host),markDoc,chat,host,chat?.markAction));
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
        claiming = reduceClaims(sending.registry, channelMap, markMap, lineage, (proofSeen || ackSeen(ackDocs.get(host), chat, now)) ? null : chat, now, sentAt, presenceNext, config?.streakEnabled);
      }
      if (claiming && chat?.markAction?.type === 'mymarks') claiming.marks[host] = reserveShare(claiming.marks[host], claiming.lineage, chat, share, now);
      let scoreNext;
      if (claiming) {
        const scoreChannels = Object.fromEntries(channels); if (transition) scoreChannels[host] = transition.channel;
        scoreNext = reduceScores(scores, { channels: scoreChannels, marks: claiming.marks, chat, now, autoApprove:reviewPolicy.autoApprove, vote: claiming.scoreVote, completion: claiming.completedScore, hop: claiming.registry.pendingHop, acknowledged:Boolean(proofSeen||claiming.acknowledgement||claiming.completedScore||(chat?.markAction?.type==='mymarks'&&share&&claiming.marks[host]?.shares?.some(row=>row.nonce===share.nonce&&row.status==='queued'))) });
        if (['top','badges'].includes(scoreNext.message)) scoreNext.message = scoreMessage(scoreNext.message, scoreboard(claiming.lineage, claiming.registry, scoreNext.doc, config, now), host);

      }
      const ackUpdates=new Map();
      if(claiming&&host) ackUpdates.set(host,ackDocument(ackDocs.get(host),isScoreCommand(chat)?null:chat,claiming.acknowledgement,transition?.channel,claiming.marks[host],now,claiming.ackDeadline,claiming.acknowledgementKind));
      if(config && privacyChanged)for(const target of config.channels){const c=target===host?transition.channel:channels.get(target),m=claiming.marks[target],d=ackDocs.get(target);ackUpdates.set(target,cancelCompletionNotices(ackDocument(ackUpdates.get(target)??d,chat,null,c,m,now)));}
      const completionAcks=[];let completionSkipped=0;
      if(claiming?.completedScore){const h=claiming.registry.pendingHop;for(const target of[h.from,h.to]){const value=completionAck(ackUpdates.get(target)??ackDocs.get(target),target,h.eventId,h.endsAt,now,h,Object.assign(Object.fromEntries(channels),transition?{[host]:transition.channel}:{}));ackUpdates.set(target,value.doc);if(value.key)completionAcks.push({host:target,key:value.key});else completionSkipped++;}}
      const scoreAckNext = isReplyCommand(chat) ? scoreAckDocument(scoreAckDocs.get(host), chat, scoreNext?.message, transition?.channel, claiming?.marks[host], now) : null;
      // No await between check and insertion: atomic within this process.
      if (pk && !proofSeen) seen.set(pk, now + 600000);
      for(const[target,doc]of ackUpdates)ackDocs.set(target,doc);
      if (presenceNext) for (const [key, value] of Object.entries(presenceNext)) presenceDocs.set(key, value);

      if (scoreNext) scores = scoreNext.doc;
      if (scoreAckNext) scoreAckDocs.set(host, scoreAckNext);
      seen.set(id, expiresAt);
      if(completionAcks.length){const receipt={until:expiresAt,rows:completionAcks};completionReceipts.set(id,receipt);if(pk)completionReceipts.set(pk,receipt);}
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
      if(p7Enabled&&privacyChanged)for(const target of config.channels)if(p7Docs.has(target))p7Docs.set(target,cancelP7(p7Docs.get(target)));
      if (chat?.markAction?.type === 'forgetme' && chatReceipts.get(chat.broadcasterId)?.chatterId === chat.chatterId) chatReceipts.delete(chat.broadcasterId);
      if (chat && !chat.markAction) chatReceipts.set(chat.broadcasterId, { broadcasterId: chat.broadcasterId, chatterId: chat.chatterId, messageId: chat.messageId, receivedAt: now });
      if(isReplyCommand(chat)&&!completionAcks.length&&!completionSkipped&&!sending?.result&&!(pk&&completionReceipts.has(pk)))return{status:'accepted',commandReply:{kind:chat.markAction.type,reason:scoreNext?.reason??'not-command'}};
      return (completionAcks.length||completionSkipped) ? {status:'accepted',completionAcks,completionSkipped} : (pk&&completionReceipts.has(pk)) ? {status:'accepted',completionAcks:completionReceipts.get(pk).rows} : observation ? (transition.channel.lifecycleAt === event.sentAt && transition.channel.lifecycleSource === 'helix-observation' ? 'applied' : 'no-change') : sending?.result ?? 'accepted';
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
      const transition = config ? reduceLifecycle({ reviewPolicy, registry, channel: channels.get(host), marks: markDocs.get(host), host, chat: { ...actor, markAction: action }, now, sentAt: now }) : null;
      const doc = transition ? transition.marks : reduceMark(markDocs.get(host), host, actor, action, now, reviewPolicy);
      const privacyChanged=markPrivacyChange(markDocs.get(host),doc,actor,host,action);
      if (transition) { registry = transition.registry; channels.set(host, transition.channel); }
      if (config) {
        for (const key of config.channels) { const c = key === host ? transition.channel : channels.get(key); const m = key === host ? doc : markDocs.get(key);
          const nextPresence = updatePresence(presenceDocs.get(key), key, c, m, null, now, now);
          if (action.type === 'forgetme') Object.assign(nextPresence, revokePresenceActor(nextPresence, key, actor.chatterId, now));
          presenceDocs.set(key, nextPresence); }
      }
      if(p7Enabled&&privacyChanged)for(const target of config.channels)if(p7Docs.has(target))p7Docs.set(target,cancelP7(p7Docs.get(target)));
      if(config&&privacyChanged)for(const target of config.channels)ackDocs.set(target,cancelCompletionNotices(ackDocs.get(target)));
      if (config) ackDocs.set(host, ackDocument(ackDocs.get(host), { ...actor, markAction: action }, null, transition.channel, doc, now));
      markDocs.set(host, doc);
      if (config) { const next = reduceClaims(registry, Object.fromEntries(channels), Object.fromEntries(markDocs), lineage, null, now, now, Object.fromEntries(presenceDocs), config?.streakEnabled); registry = next.registry; lineage = next.lineage; }
      if (config) scores = reduceScores(scores, { channels: Object.fromEntries(channels), marks: Object.fromEntries(markDocs), chat: { ...actor, markAction: action }, now }).doc;
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
    scoreAckStep(host, op, now) { if (!config?.channels.includes(host)) throw Error('Unconfigured score ACK'); const next=scoreAckMutation(scoreAckDocs.get(host),op,channels.get(host),markDocs.get(host),now,scores,lineage,registry,config,host);scoreAckDocs.set(host,next.doc);return next.result; },
    getPrivateClaimAcks(host) { return structuredClone(ackDocs.get(host)); },
    claimAckStep(host, op, now) {
      if (!config?.channels.includes(host)) throw Error('Unconfigured ACK');const previous=ackDocs.get(host),cs=Object.fromEntries(channels),ms=Object.fromEntries(markDocs);
      const next=ackStep(previous,op,channels.get(host),markDocs.get(host),now,completionEligible(previous,op.key,registry,cs,ms,now));let result=next.result;
      if(p7Enabled&&op.p7Finish&&previous?.rows?.some(r=>r.key===op.key&&r.status==='dispatching'&&r.p7Proof?.to===host)){try{const row=next.doc.rows.find(r=>r.key===op.key),jobs=enqueueP7(p7Docs.get(host),row,host,op.messageId,op.p7Finish,registry,lineage,cs,ms,now);if(jobs.doc)p7Docs.set(host,jobs.doc);result={p7Keys:jobs.keys};}catch{} }
      for(const r of next.doc.rows)if(r.status!=='dispatching')delete r.p7Proof;
      ackDocs.set(host,next.doc);return result;
    },
    p7Step(host,op,now){if(!p7Enabled||!op.flags?.enabled)return null;if(!config?.channels.includes(host))throw Error('Unconfigured P7');const n=p7Mutation(p7Docs.get(host),op,op.flags,registry,lineage,Object.fromEntries(channels),Object.fromEntries(markDocs),now);if(n.doc)p7Docs.set(host,n.doc);return n.result;},
    getPrivateP7(host){return structuredClone(p7Docs.get(host));},
    getKeeperRegistry() { return structuredClone(registry); },
    getStreamStatus(host) { return structuredClone(channels.get(host)); },
    setChannelPolicy(host, policy, now = Date.now()) {
      if (!config?.channels.includes(host)) throw new Error('Unconfigured lifecycle channel');
      if(p7Enabled)for(const target of config.channels)if(p7Docs.has(target))p7Docs.set(target,cancelP7(p7Docs.get(target)));
      const next = reduceLifecycle({ reviewPolicy, registry, channel: channels.get(host), marks: markDocs.get(host), host, policy, now, sentAt: now });
      presenceDocs.set(host, updatePresence(presenceDocs.get(host), host, next.channel, next.marks, null, now, now));
      ackDocs.set(host, ackDocument(ackDocs.get(host), { broadcasterId: host }, null, next.channel, next.marks, now));
      for(const target of config.channels)ackDocs.set(target,cancelCompletionNotices(ackDocs.get(target)));
      registry = next.registry; channels.set(host, next.channel); markDocs.set(host, next.marks);
      const checked = reduceClaims(registry, Object.fromEntries(channels), Object.fromEntries(markDocs), lineage, null, now, now, Object.fromEntries(presenceDocs), config?.streakEnabled); registry = checked.registry; lineage = checked.lineage;
      scores = reduceScores(scores, { channels: Object.fromEntries(channels), marks: Object.fromEntries(markDocs), now }).doc;
    },
    forgeStep(input) { const change = forgeMutation(lineage, input); if (change.next) lineage = change.next; return change.result; },
    chronicleStep(input) { const change = chronicleMutation(lineage, input); if (change.next) lineage = change.next; return change.result; },
    getScoreboard(now) {
      return scoreboard(lineage, registry, retainedScores(scores, Object.fromEntries(channels), Object.fromEntries(markDocs)), config ?? { channels: [], logins: {} }, now);
    },
    getRecap() { return recapProjection(lineage); },
    searchPublicMarks(options) { return atlasSearch(lineage, options); },
    getJourneyMap(now) { return journeyMap(lineage, config, now); },
    getAtlasPage(options) { return atlasPage(lineage, options); },
    getPublicPresentation(host, now) { return { rings: lineage.stops.length, ...(config?.streakEnabled?{streak:streakView(registry,now)}:{}), ...(movedToView(registry, lineage, host, channels.get(host)) ? { movedToLogin: movedToView(registry, lineage, host, channels.get(host)) } : {}), handoff: handoffView(registry, host, now, lineage), claimMeter: claimMeterView(registry, host, now), ...(echoView(registry, host, now) ? { resonance: echoView(registry, host, now) } : {}) }; },
    getPublicJourney() { return publicJourney(lineage); },
    getPublicMarks(host) { return publicMarks(markDocs.get(host), host); },
    getOverlayState(host, now = Date.now()) { return withIncomingPreview(withCarriedMarks(publicOverlayState(markDocs.get(host), host), lineage, registry, host), registry, host, Object.fromEntries(channels), Object.fromEntries(markDocs), now); },
    getPrivateMarks(host, actor) { return privateMarks(markDocs.get(host), host, actor); },
  };
}
