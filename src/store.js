import { publicKeeperProfiles } from './scoreboard.js';
import { wanderMutation, wanderActivity } from './wander-state.js';
import { receivingView } from './receiving.js';
import { streakView } from './streaks.js';
import { enqueueP7, p7Mutation, cancelP7 } from './p7.js';
import { journeyMap } from './journey-map.js';
import {
  reduceScores,
  retainedScores,
  scoreboard,
  scoreMessage,
  isScoreCommand,
  isReplyCommand,
  scoreAckDocument,
  scoreAckMutation,
} from './scoreboard.js';
import { updatePresence, presenceKey, revokePresenceActor } from './presence.js';
import { reserveShare, sharePage, shareStep } from './my-marks.js';
import { echoCandidate, reduceEcho, echoView } from './resonance.js';
import { forgeMutation } from './forge.js';
import { recapProjection } from './recap.js';
import { chronicleMutation } from './chronicle.js';
import {
  ackDocument,
  ackSeen,
  ackStep,
  completionAck,
  attachOfferProof,
  arrivalNotice,
  completionEligible,
  cancelCompletionNotices,
  trackHopNotices,
} from './claim-ack.js';
import { hash as observationHash } from './crypto.js';
import {
  atlasPage,
  atlasSearch,
  holderLoginView,
  wanderArrivalView,
  movedToView,
  claimMeterView,
  handoffView,
  withCarriedMarks,
  withIncomingPreview,
  keeperCandidates,
} from './public-view.js';
import { reduceClaims, publicJourney } from './claims.js';
import { sendState } from './send-state.js';
import { lifecycleConfig, reduceLifecycle } from './lifecycle.js';
import { hash } from './crypto.js';
import {
  setMarkContext,
  reduceMark,
  publicMarks,
  publicOverlayState,
  privateMarks,
  isModerator,
  isChatIdentity,
  markPrivacyChange,
  markCommandOutcome,
  trustedReviewPolicy,
} from './marks.js';

export function ritualFor(id, now, raid) {
  return {
    eventId: id,
    incomingBroadcasterId: raid.from_broadcaster_user_id,
    hostBroadcasterId: raid.to_broadcaster_user_id,
    startedAt: now,
    endsAt: now + 90000,
  };
}

// Generic auth records contain only state hashes, encrypted tokens and lease metadata.
export const OAUTH_STATE_LIMITS = Object.freeze({ slots: 256, probes: 8 });
export function oauthStateSlots(id) {
  const first = parseInt(hash(id).slice(0, 8), 16) % OAUTH_STATE_LIMITS.slots;
  return Array.from(
    { length: OAUTH_STATE_LIMITS.probes },
    (_, i) => `oauth-state-slot-v1:${(first + i) % OAUTH_STATE_LIMITS.slots}`,
  );
}
export function createMemoryAuthStore() {
  const records = new Map();
  return {
    async acquireJob(id, owner, now) {
      const previous = records.get(`job:${id}`);
      if (previous?.expiresAt > now) return false;
      records.set(`job:${id}`, { owner, expiresAt: now + 300000, status: 'running' });
      return true;
    },
    async finishJob(id, owner, result) {
      const job = records.get(`job:${id}`);
      if (job?.owner === owner) records.set(`job:${id}`, { expiresAt: 0, result });
    },
    async getJob(id) {
      return structuredClone(records.get(`job:${id}`)?.result ?? null);
    },
    async createControlSession(id, record) {
      records.set(`control:${id}`, structuredClone(record));
    },
    async getControlSession(id, sessionHash, now) {
      const r = records.get(`control:${id}`);
      return r?.sessionHash === sessionHash && r.expiresAt > now ? structuredClone(r) : null;
    },
    async renewControlSession(id, sessionHash, expectedExpiry, now, { signal } = {}) {
      const r = records.get(`control:${id}`);
      if (
        signal?.aborted ||
        r?.keeperId !== id ||
        r.role !== 'keeper' ||
        r.sessionHash !== sessionHash ||
        r.expiresAt !== expectedExpiry ||
        r.expiresAt <= now
      )
        return null;
      const next = { ...r, renewedAt: now, expiresAt: now + 43200000 };
      records.set(`control:${id}`, next);
      return structuredClone(next);
    },
    async revokeControlSession(id, sessionHash, now) {
      const r = records.get(`control:${id}`);
      if (r?.sessionHash !== sessionHash || r.expiresAt <= now) return false;
      records.delete(`control:${id}`);
      return true;
    },
    async createState(id, record, now = 0) {
      const slots = oauthStateSlots(id);
      if (
        slots.some((key) => records.get(key)?.stateHash === id && records.get(key).expiresAt > now)
      )
        return false;
      const slot = slots.find((key) => !records.has(key) || records.get(key).expiresAt <= now);
      if (!slot) return false;
      records.set(slot, { ...structuredClone(record), stateHash: id });
      return true;
    },
    async consumeState(id, binding, now) {
      const slot = oauthStateSlots(id).find((key) => {
        const r = records.get(key);
        return r?.stateHash === id && r.binding === binding && r.expiresAt > now;
      });
      if (!slot) return null;
      const { stateHash, ...record } = records.get(slot);
      records.delete(slot);
      return structuredClone(record);
    },
    async getToken(role) {
      return structuredClone(records.get(`token:${role}`));
    },
    async acquire(role, owner, now) {
      const lease = records.get(`lease:${role}`);
      if (lease && lease.expiresAt > now) return false;
      records.set(`lease:${role}`, { owner, expiresAt: now + 30000 });
      return true;
    },
    async saveToken(role, value, owner, now) {
      const lease = records.get(`lease:${role}`);
      if (lease?.owner !== owner || lease.expiresAt <= now) throw new Error('Token lease lost');
      records.set(`token:${role}`, structuredClone(value));
    },
    async release(role, owner) {
      if (records.get(`lease:${role}`)?.owner === owner) records.delete(`lease:${role}`);
    },
  };
}

export function createFirestoreStore(
  db,
  { lifecycle, p7Enabled = false, reviewPolicy, wander } = {},
) {
  const config = lifecycleConfig(lifecycle);
  const keeperNames = config?.logins
    ? Object.fromEntries(Object.entries(config.logins).map(([login, id]) => [id, login]))
    : undefined;
  reviewPolicy = trustedReviewPolicy(reviewPolicy);
  p7Enabled = Boolean(p7Enabled && config);
  const ref = (collection, key) => db.collection(collection).doc(hash(key));
  return {
    lifecycleEnabled: Boolean(config),
    async accept({
      id,
      expiresAt,
      now,
      raid,
      chat,
      lifecycle: providedEvent,
      observation,
      share,
      sentAt = now,
    }) {
      return db.runTransaction(async (tx) => {
        const eventRef = ref('events', id);
        const existing = await tx.get(eventRef);
        if (existing.exists && existing.data().expiresAt >= now)
          return existing.data().completionAcks
            ? { status: 'duplicate', completionAcks: existing.data().completionAcks }
            : 'duplicate';
        const pk = presenceKey(chat);
        const proofRef = pk ? ref('events', pk) : null;
        const previousProof = proofRef ? (await tx.get(proofRef)).data() : null;
        const proofSeen = previousProof && previousProof.expiresAt >= now;
        const event = observation?.event ?? providedEvent;
        const host = event?.host ?? chat?.broadcasterId;
        if (config && host && !config.channels.includes(host))
          throw new Error('Unconfigured lifecycle channel');
        if (chat?.copied && !echoCandidate(chat, config, now, sentAt)) {
          tx.set(eventRef, { expiresAt });
          return 'accepted';
        }
        if (config && chat && !chat.copied && !chat.markAction && !raid && !event && !observation) {
          if (!isChatIdentity(chat, host)) throw new Error('Authenticated chat identity required');
          const c = (await tx.get(ref('streamChannels', host))).data(),
            m = (await tx.get(ref('markChannels', host))).data();
          const pr = ref('presence', host),
            pd = (await tx.get(pr)).data();
          const updated = updatePresence(pd, host, c, m, proofSeen ? null : chat, now, sentAt);
          tx.set(pr, updated);
          if (proofRef && !proofSeen) tx.set(proofRef, { expiresAt: now + 600000 });
          tx.set(eventRef, { expiresAt });
          tx.set(ref('chatReceipts', host), {
            messageId: chat.messageId,
            chatterId: chat.chatterId,
            receivedAt: now,
          });
          return 'accepted';
        }
        const managed = config && (host || raid);
        const registry = managed ? (await tx.get(ref('keeperRegistry', 'single'))).data() : null;
        const channelMap = {};
        const markMap = {};
        const presenceNext = {};
        if (managed)
          for (const channelId of config.channels) {
            channelMap[channelId] = (await tx.get(ref('streamChannels', channelId))).data();
            markMap[channelId] = (await tx.get(ref('markChannels', channelId))).data();
            presenceNext[channelId] = (await tx.get(ref('presence', channelId))).data();
          }
        const scoreRef = managed ? ref('scoreboard', 'single') : null;
        const scores = scoreRef ? (await tx.get(scoreRef)).data() : null;
        const lineage = managed ? (await tx.get(ref('lineage', 'single'))).data() : null;
        if (chat?.copied) {
          const next = reduceEcho(registry, channelMap, markMap, lineage, chat, now);
          tx.set(eventRef, { expiresAt });
          if (next) tx.set(ref('keeperRegistry', 'single'), next);
          return next ? 'resonance' : 'accepted';
        }
        const ackMap = {};
        if (managed)
          for (const target of config.channels)
            ackMap[target] = (await tx.get(ref('claimAcks', target))).data();
        const ackRef = managed && host ? ref('claimAcks', host) : null,
          ackDoc = ackMap[host];
        const p7Cancel = {};
        if (
          p7Enabled &&
          managed &&
          ([
            'forgetme',
            'pause',
            'opt-out',
            'block',
            'veto-last',
            'reject-last',
            'block-login',
          ].includes(chat?.markAction?.type) ||
            event?.type === 'ban')
        )
          for (const id of config.channels)
            p7Cancel[id] = (await tx.get(ref('p7Actions', id))).data();
        const scoreAckRef = managed && isReplyCommand(chat) ? ref('scoreAcks', host) : null;
        const scoreAckPrevious = scoreAckRef ? (await tx.get(scoreAckRef)).data() : null;
        const channel = channelMap[host];
        if (observation) {
          if (!managed || observationHash(JSON.stringify(channel ?? null)) !== observation.baseline)
            return 'superseded';
          if (event.type === 'online' && channel?.closedIds.includes(event.streamId))
            return 'closed';
        }
        const markRef = host && (managed || chat?.markAction) ? ref('markChannels', host) : null;
        const markDoc = managed ? markMap[host] : markRef ? (await tx.get(markRef)).data() : null;
        const receiptRef =
          chat?.markAction?.type === 'forgetme' ? ref('chatReceipts', chat.broadcasterId) : null;
        const receipt = receiptRef ? (await tx.get(receiptRef)).data() : null;
        const transition =
          managed && host
            ? reduceLifecycle({
                seekersEnabled: config?.seekersEnabled,
                wanderEnabled: wander?.enabled,
                reviewPolicy,
                registry,
                channel,
                marks: markDoc,
                host,
                event,
                chat: proofSeen ? null : chat,
                now,
                sentAt,
                observed: Boolean(observation),
              })
            : null;
        const next = transition
          ? transition.marks
          : markRef && !proofSeen
            ? reduceMark(markDoc, chat.broadcasterId, chat, chat.markAction, now, reviewPolicy)
            : null;
        const markOutcome = markCommandOutcome(markDoc, next, host, chat, chat?.markAction);
        const privacyChanged =
          event?.type === 'ban' ||
          (!proofSeen && markPrivacyChange(markDoc, next, chat, host, chat?.markAction));
        let claiming;
        let sending;
        if (managed) {
          if (transition) {
            channelMap[host] = transition.channel;
            markMap[host] = transition.marks;
          }
          for (const key of config.channels) {
            presenceNext[key] = updatePresence(
              presenceNext[key],
              key,
              channelMap[key],
              markMap[key],
              key === host && !proofSeen ? chat : null,
              now,
              sentAt,
            );
            if (chat?.markAction?.type === 'forgetme')
              presenceNext[key] = revokePresenceActor(presenceNext[key], key, chat.chatterId, now);
          }
          const op = raid
            ? { type: 'raid', raid, id, sentAt }
            : chat?.markAction?.type === 'send'
              ? {
                  type: 'reserve',
                  source: host,
                  actor: chat.chatterId,
                  login: chat.markAction.login,
                  id,
                  sentAt,
                }
              : { type: 'noop' };
          sending = sendState(
            transition?.registry ?? registry,
            channelMap,
            markMap,
            config,
            op,
            now,
          );
          trackHopNotices(transition?.registry ?? registry, sending.registry);
          claiming = reduceClaims(
            sending.registry,
            channelMap,
            markMap,
            lineage,
            proofSeen || ackSeen(ackDoc, chat, now) ? null : chat,
            now,
            sentAt,
            presenceNext,
            config?.streakEnabled,
            keeperNames,
          );
        }
        if (claiming && !proofSeen && chat?.markAction?.type === 'mymarks')
          claiming.marks[host] = reserveShare(
            claiming.marks[host],
            claiming.lineage,
            chat,
            share,
            now,
          );
        if (claiming && (claiming.completedScore || sending?.result?.status === 'reserved'))
          wanderActivity(claiming.registry, now, wander?.enabled);
        let commandReply;
        if (claiming) {
          const scoreNext = reduceScores(scores, {
            names: keeperNames,
            channels: channelMap,
            marks: claiming.marks,
            chat,
            now,
            awaitingRaid: claiming.awaitingRaid,
            registry: claiming.registry,
            lineage: claiming.lineage,
            holderSince:
              claiming.lineage?.stops?.at(-1)?.to === claiming.registry.holderId
                ? claiming.lineage.stops.at(-1).claimedAt
                : null,
            seekersEnabled: config?.seekersEnabled,
            wanderEnabled: wander?.enabled,
            markOutcome,
            sentAt,
            autoApprove: reviewPolicy.autoApprove,
            vote: claiming.scoreVote,
            completion: claiming.completedScore,
            hop: claiming.registry.pendingHop,
            acknowledged: Boolean(
              proofSeen ||
              claiming.acknowledgement ||
              claiming.completedScore ||
              (chat?.markAction?.type === 'mymarks' &&
                share &&
                claiming.marks[host]?.shares?.some(
                  (row) => row.nonce === share.nonce && row.status === 'queued',
                )),
            ),
          });
          if (isReplyCommand(chat))
            commandReply = {
              kind: chat.markAction.type,
              reason: scoreNext.reason,
              ...(markOutcome ? { outcome: markOutcome } : {}),
            };
          if (['top', 'badges'].includes(scoreNext.message))
            scoreNext.message = scoreMessage(
              scoreNext.message,
              scoreboard(claiming.lineage, claiming.registry, scoreNext.doc, config, now),
              host,
            );
          if (scoreAckRef)
            tx.set(
              scoreAckRef,
              scoreAckDocument(
                scoreAckPrevious,
                chat,
                scoreNext.message,
                transition?.channel,
                claiming.marks[host],
                now,
              ),
            );
          if (scores || scoreNext.doc.players.length || scoreNext.doc.receipts.length)
            tx.set(scoreRef, scoreNext.doc);
        }
        if (proofRef && !proofSeen) tx.set(proofRef, { expiresAt: now + 600000 });
        const ackUpdates = new Map();
        if (claiming && ackRef)
          ackUpdates.set(
            host,
            ackDocument(
              ackDoc,
              isScoreCommand(chat) ? null : chat,
              claiming.acknowledgement,
              transition?.channel,
              claiming.marks[host],
              now,
              claiming.ackDeadline,
              claiming.acknowledgementKind,
            ),
          );
        if (managed && privacyChanged)
          for (const target of config.channels) {
            const c = channelMap[target],
              m = claiming.marks[target],
              d = ackMap[target];
            ackUpdates.set(
              target,
              cancelCompletionNotices(
                ackDocument(ackUpdates.get(target) ?? d, chat, null, c, m, now),
              ),
            );
          }
        const completionAcks = [];
        let completionSkipped = 0;
        if (claiming?.completedScore) {
          const h = claiming.registry.pendingHop;
          for (const target of [h.from, h.to]) {
            const value = completionAck(
              ackUpdates.get(target) ?? ackMap[target],
              target,
              h.eventId,
              h.endsAt,
              now,
              h,
              channelMap,
              keeperNames,
            );
            ackUpdates.set(target, value.doc);
            if (value.key) completionAcks.push({ host: target, key: value.key });
            else completionSkipped++;
          }
        }
        if (claiming && host && chat)
          attachOfferProof(
            ackUpdates.get(host),
            chat,
            claiming.registry.pendingHop,
            claiming.scoreVote === chat.chatterId,
          );
        if (raid && claiming?.registry.pendingHop) {
          const h = claiming.registry.pendingHop;
          const notice = arrivalNotice(
            ackUpdates.get(h.to) ?? ackMap[h.to],
            ackUpdates.get(h.from) ?? ackMap[h.from],
            claiming.registry,
            channelMap,
            claiming.marks,
            now,
            keeperNames,
          );
          if (notice) {
            ackUpdates.set(h.to, notice.doc);
            completionAcks.push({ host: h.to, key: notice.key });
          }
        }
        if (privacyChanged)
          for (const [target, doc] of Object.entries(p7Cancel))
            if (doc) tx.set(ref('p7Actions', target), cancelP7(doc));
        for (const [target, doc] of ackUpdates) tx.set(ref('claimAcks', target), doc);
        if (managed)
          for (const [key, doc] of Object.entries(presenceNext)) tx.set(ref('presence', key), doc);
        tx.set(eventRef, { expiresAt, ...(completionAcks.length ? { completionAcks } : {}) });
        if (proofRef && !proofSeen)
          tx.set(proofRef, {
            expiresAt: now + 600000,
            ...(completionAcks.length ? { completionAcks } : {}),
          });
        if (transition) {
          tx.set(ref('keeperRegistry', 'single'), transition.registry);
          tx.set(ref('streamChannels', host), transition.channel);
        }
        if (raid && !config)
          tx.set(ref('rituals', raid.to_broadcaster_user_id), ritualFor(id, now, raid));
        if (sending) {
          tx.set(ref('keeperRegistry', 'single'), sending.registry);
          if (sending.ritual) tx.set(ref('rituals', raid.to_broadcaster_user_id), sending.ritual);
        }
        // Store only bounded metadata, never raw chat text or proof of membership.
        if (next) tx.set(markRef, next);
        if (claiming) {
          if (claiming.dequeued)
            tx.set(ref('streamChannels', claiming.dequeued.id), claiming.dequeued.channel);
          tx.set(ref('keeperRegistry', 'single'), claiming.registry);
          tx.set(ref('lineage', 'single'), claiming.lineage);
          for (const [key, doc] of Object.entries(claiming.marks))
            if (doc) tx.set(ref('markChannels', key), doc);
        }
        if (receipt && receipt.chatterId === chat?.chatterId) tx.delete(receiptRef);
        if (chat && !chat.markAction)
          tx.set(ref('chatReceipts', chat.broadcasterId), {
            messageId: chat.messageId,
            chatterId: chat.chatterId,
            receivedAt: now,
          });
        if (
          commandReply &&
          !completionAcks.length &&
          !completionSkipped &&
          !sending?.result &&
          !(proofSeen && previousProof?.completionAcks)
        )
          return { status: 'accepted', commandReply };
        return completionAcks.length || completionSkipped
          ? { status: 'accepted', completionAcks, completionSkipped }
          : proofSeen && previousProof?.completionAcks
            ? { status: 'accepted', completionAcks: previousProof.completionAcks }
            : observation
              ? transition.channel.lifecycleAt === event.sentAt &&
                transition.channel.lifecycleSource === 'helix-observation'
                ? 'applied'
                : 'no-change'
              : (sending?.result ?? 'accepted');
      });
    },
    async scoreAckStep(host, op, now) {
      if (!config?.channels.includes(host)) throw Error('Unconfigured score ACK');
      return db.runTransaction(async (tx) => {
        const r = ref('scoreAcks', host),
          doc = (await tx.get(r)).data(),
          c = (await tx.get(ref('streamChannels', host))).data(),
          m = (await tx.get(ref('markChannels', host))).data();
        const scores = (await tx.get(ref('scoreboard', 'single'))).data(),
          lineage = (await tx.get(ref('lineage', 'single'))).data(),
          registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const next = scoreAckMutation(doc, op, c, m, now, scores, lineage, registry, config, host);
        tx.set(r, next.doc);
        return next.result;
      });
    },
    async getPrivateClaimAcks(host) {
      return (await ref('claimAcks', host).get()).data();
    },
    async claimAckStep(host, op, now) {
      if (!config?.channels.includes(host)) throw Error('Unconfigured ACK');
      return db.runTransaction(async (tx) => {
        const doc = ref('claimAcks', host),
          previous = (await tx.get(doc)).data();
        const channel = (await tx.get(ref('streamChannels', host))).data(),
          marks = (await tx.get(ref('markChannels', host))).data();
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data(),
          channels = {},
          markMap = {};
        for (const id of config.channels) {
          channels[id] = (await tx.get(ref('streamChannels', id))).data();
          markMap[id] = (await tx.get(ref('markChannels', id))).data();
        }
        const active =
          p7Enabled &&
          op.p7Finish &&
          previous?.rows?.some(
            (r) => r.key === op.key && r.status === 'dispatching' && r.p7Proof?.to === host,
          );
        const history = (active || (op.type === 'claim' && previous?.rows?.some((r) => r.key === op.key && r.completion)))
            ? (await tx.get(ref('lineage', 'single'))).data() : null,
          jobs = active ? (await tx.get(ref('p7Actions', host))).data() : null;
        const promptTarget = registry?.pendingHop?.to;
        const receiverRef =
          promptTarget && promptTarget !== host ? ref('claimAcks', promptTarget) : null;
        const receiverAcks = receiverRef ? (await tx.get(receiverRef)).data() : previous;
        const next = ackStep(
          previous,
          op,
          channel,
          marks,
          now,
          completionEligible(previous, op.key, registry, channels, markMap, now, history),
        );
        let result = next.result,
          queued;
        if (active) {
          try {
            queued = enqueueP7(
              jobs,
              next.doc.rows.find((r) => r.key === op.key),
              host,
              op.messageId,
              op.p7Finish,
              registry,
              history,
              channels,
              markMap,
              now,
            );
            result = { p7Keys: queued.keys };
          } catch {}
        }
        if (op.type === 'finish' && op.sent && registry?.pendingHop?.from === host && receiverRef) {
          const notice = arrivalNotice(
            receiverAcks,
            next.doc,
            registry,
            channels,
            markMap,
            now,
            keeperNames,
          );
          if (notice) {
            tx.set(receiverRef, notice.doc);
            tx.set(ref('keeperRegistry', 'single'), registry);
            result = { ...result, arrivalAcks: [{ host: promptTarget, key: notice.key }] };
          }
        }
        for (const r of next.doc.rows) if (r.status !== 'dispatching') delete r.p7Proof;
        if (queued?.doc) tx.set(ref('p7Actions', host), queued.doc);
        tx.set(doc, next.doc);
        return result;
      });
    },
    async p7Step(host, op, now) {
      if (!p7Enabled || !op.flags?.enabled) return null;
      if (!config?.channels.includes(host)) throw Error('Unconfigured P7');
      return db.runTransaction(async (tx) => {
        const r = ref('p7Actions', host),
          previous = (await tx.get(r)).data(),
          registry = (await tx.get(ref('keeperRegistry', 'single'))).data(),
          history = (await tx.get(ref('lineage', 'single'))).data(),
          channels = {},
          marks = {};
        for (const id of config.channels) {
          channels[id] = (await tx.get(ref('streamChannels', id))).data();
          marks[id] = (await tx.get(ref('markChannels', id))).data();
        }
        const n = p7Mutation(previous, op, op.flags, registry, history, channels, marks, now);
        if (op.type === 'claim' && n.result?.kind === 'announcement')
          tx.set(ref('keeperRegistry', 'single'), registry);
        if (n.doc) tx.set(r, n.doc);
        return n.result;
      });
    },
    async getPrivateP7(host) {
      return (await ref('p7Actions', host).get()).data();
    },
    async getRitual(hostId) {
      return (await ref('rituals', hostId).get()).data();
    },
    async setKeeperContext(host, context) {
      if (config) throw new Error('Use signed lifecycle; raw context injection disabled');
      await db.runTransaction(async (tx) => {
        const doc = ref('markChannels', host);
        const previous = (await tx.get(doc)).data();
        tx.set(doc, setMarkContext(previous, host, context));
      });
    },
    async controlMarks(host, actor, action, now) {
      if (!isChatIdentity(actor, host)) throw new Error('Authenticated chat identity required');
      if (action.type !== 'forgetme' && !isModerator(actor, host))
        throw new Error('Moderator identity required');
      return db.runTransaction(async (tx) => {
        const doc = ref('markChannels', host);
        const previous = (await tx.get(doc)).data();
        const receiptRef = ref('chatReceipts', host);
        const receipt = action.type === 'forgetme' ? (await tx.get(receiptRef)).data() : null;
        let next;
        if (config) {
          if (!config.channels.includes(host)) throw new Error('Unconfigured lifecycle channel');
          const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
          const channel = (await tx.get(ref('streamChannels', host))).data();
          const history = (await tx.get(ref('lineage', 'single'))).data();
          const channelMap = {};
          const markMap = {};
          const presenceMap = {};
          for (const key of config.channels) {
            channelMap[key] = (await tx.get(ref('streamChannels', key))).data();
            markMap[key] = (await tx.get(ref('markChannels', key))).data();
            presenceMap[key] = (await tx.get(ref('presence', key))).data();
          }
          const ackRef = ref('claimAcks', host),
            ackDoc = (await tx.get(ackRef)).data();
          const otherAcks = {};
          for (const target of config.channels)
            if (target !== host)
              otherAcks[target] = (await tx.get(ref('claimAcks', target))).data();
          const p7Cancel = {};
          if (
            p7Enabled &&
            [
              'forgetme',
              'pause',
              'opt-out',
              'block',
              'veto-last',
              'reject-last',
              'block-login',
            ].includes(action.type)
          )
            for (const id of config.channels)
              p7Cancel[id] = (await tx.get(ref('p7Actions', id))).data();
          const scoreRef = ref('scoreboard', 'single'),
            scores = (await tx.get(scoreRef)).data();
          const transition = reduceLifecycle({
            seekersEnabled: config?.seekersEnabled,
            wanderEnabled: wander?.enabled,
            reviewPolicy,
            registry,
            channel,
            marks: previous,
            host,
            chat: { ...actor, markAction: action },
            now,
            sentAt: now,
          });
          const privacyChanged = markPrivacyChange(previous, transition.marks, actor, host, action);
          if (privacyChanged)
            for (const [id, doc] of Object.entries(p7Cancel))
              if (doc) tx.set(ref('p7Actions', id), cancelP7(doc));
          channelMap[host] = transition.channel;
          markMap[host] = transition.marks;
          for (const key of config.channels) {
            presenceMap[key] = updatePresence(
              presenceMap[key],
              key,
              channelMap[key],
              markMap[key],
              null,
              now,
              now,
            );
            if (action.type === 'forgetme')
              presenceMap[key] = revokePresenceActor(presenceMap[key], key, actor.chatterId, now);
          }
          const checked = reduceClaims(
            transition.registry,
            channelMap,
            markMap,
            history,
            null,
            now,
            now,
            presenceMap,
            config?.streakEnabled,
            keeperNames,
          );
          if (scores)
            tx.set(
              scoreRef,
              reduceScores(scores, {
                names: keeperNames,
                channels: channelMap,
                marks: checked.marks,
                chat: { ...actor, markAction: action },
                now,
              }).doc,
            );
          for (const [key, doc] of Object.entries(presenceMap)) tx.set(ref('presence', key), doc);
          if (privacyChanged)
            for (const [target, doc] of Object.entries(otherAcks))
              tx.set(ref('claimAcks', target), cancelCompletionNotices(doc));
          tx.set(
            ackRef,
            ackDocument(
              privacyChanged ? cancelCompletionNotices(ackDoc) : ackDoc,
              { ...actor, markAction: action },
              null,
              transition.channel,
              transition.marks,
              now,
            ),
          );
          tx.set(ref('lineage', 'single'), checked.lineage);
          tx.set(ref('keeperRegistry', 'single'), checked.registry);
          tx.set(ref('streamChannels', host), transition.channel);
          next = transition.marks;
        } else next = reduceMark(previous, host, actor, action, now, reviewPolicy);
        const commandOutcome = markCommandOutcome(previous, next, host, actor, action);
        tx.set(doc, next);
        if (receipt && receipt.chatterId === actor?.chatterId) tx.delete(receiptRef);
        return commandOutcome;
      });
    },
    async sendOffStep(op, now) {
      if (!config) throw new Error('Lifecycle required');
      return db.runTransaction(async (tx) => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const channels = {};
        const marks = {};
        for (const host of config.channels) {
          channels[host] = (await tx.get(ref('streamChannels', host))).data();
          marks[host] = (await tx.get(ref('markChannels', host))).data();
        }
        const next = sendState(registry, channels, marks, config, op, now);
        trackHopNotices(registry, next.registry);
        if (next.result?.status === 'reserved') wanderActivity(next.registry, now, wander?.enabled);
        tx.set(ref('keeperRegistry', 'single'), next.registry);
        return next.result;
      });
    },
    async getOwnMarks(payload, now, offset, limit) {
      return db.runTransaction(async (tx) => {
        const doc = (await tx.get(ref('markChannels', payload.host))).data();
        const lineage = (await tx.get(ref('lineage', 'single'))).data();
        return sharePage(doc, lineage, payload, now, offset, limit);
      });
    },
    async shareReplyStep(host, op, now) {
      return db.runTransaction(async (tx) => {
        const doc = ref('markChannels', host);
        const previous = (await tx.get(doc)).data();
        const next = shareStep(previous, op, now);
        if (next.doc) tx.set(doc, next.doc);
        return next.result;
      });
    },
    async getWanderInput() {
      if (!wander?.enabled) return null;
      return db.runTransaction(async (tx) => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data() ?? {
          holderId: null,
          originated: false,
        };
        const lineage = (await tx.get(ref('lineage', 'single'))).data() ?? { stops: [] };
        const channels = {},
          marks = {};
        for (const id of config.channels) {
          channels[id] = (await tx.get(ref('streamChannels', id))).data();
          marks[id] = (await tx.get(ref('markChannels', id))).data();
        }
        return { registry, lineage, channels, marks };
      });
    },
    async wanderStep(op, now) {
      if (!wander?.enabled) return { status: 'disabled' };
      return db.runTransaction(async (tx) => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data() ?? {
          holderId: null,
          originated: false,
        };
        const lineage = (await tx.get(ref('lineage', 'single'))).data() ?? { stops: [] };
        const channels = {},
          marks = {};
        for (const id of config.channels) {
          channels[id] = (await tx.get(ref('streamChannels', id))).data();
          marks[id] = (await tx.get(ref('markChannels', id))).data();
        }
        const input = { registry, lineage, channels, marks };
        const next = wanderMutation(input, config, wander, op, now);
        if (next.result.status === 'wandered') {
          const target = next.registry.holderId;
          tx.set(ref('streamChannels', target), next.channels[target]);
        }
        if (JSON.stringify(next.registry) !== JSON.stringify(registry))
          tx.set(ref('keeperRegistry', 'single'), next.registry);
        if (JSON.stringify(next.lineage) !== JSON.stringify(lineage))
          tx.set(ref('lineage', 'single'), next.lineage);
        for (const [id, doc] of Object.entries(next.marks))
          if (doc && JSON.stringify(doc) !== JSON.stringify(marks[id]))
            tx.set(ref('markChannels', id), doc);
        return next.result;
      });
    },
    async getReceivingView(now) {
      return db.runTransaction(async (tx) => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const lineage = (await tx.get(ref('lineage', 'single'))).data();
        const channels = {},
          marks = {};
        for (const id of config?.channels ?? []) {
          channels[id] = (await tx.get(ref('streamChannels', id))).data();
          marks[id] = (await tx.get(ref('markChannels', id))).data();
        }
        return receivingView(registry, channels, marks, lineage, config, now);
      });
    },
    async getKeeperCandidates(host) {
      if (!config?.channels.includes(host)) return [];
      return db.runTransaction(async (tx) => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const channels = {},
          docs = {};
        for (const id of config.channels) {
          channels[id] = (await tx.get(ref('streamChannels', id))).data();
          docs[id] = (await tx.get(ref('markChannels', id))).data();
        }
        return keeperCandidates(registry, channels, docs, config, host);
      });
    },
    async getKeeperRegistry() {
      return (
        (await ref('keeperRegistry', 'single').get()).data() ?? {
          holderId: null,
          originated: false,
        }
      );
    },
    async getStreamStatus(host) {
      return (await ref('streamChannels', host).get()).data();
    },
    async setChannelPolicy(host, policy, now = Date.now()) {
      if (!config?.channels.includes(host)) throw new Error('Unconfigured lifecycle channel');
      await db.runTransaction(async (tx) => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const channel = (await tx.get(ref('streamChannels', host))).data();
        const marks = (await tx.get(ref('markChannels', host))).data();
        const history = (await tx.get(ref('lineage', 'single'))).data();
        const channelMap = {};
        const markMap = {};
        const presenceMap = {};
        for (const key of config.channels) {
          channelMap[key] = (await tx.get(ref('streamChannels', key))).data();
          markMap[key] = (await tx.get(ref('markChannels', key))).data();
          presenceMap[key] = (await tx.get(ref('presence', key))).data();
        }
        const ackRef = ref('claimAcks', host),
          ackDoc = (await tx.get(ackRef)).data();
        const otherAcks = {};
        for (const target of config.channels)
          if (target !== host) otherAcks[target] = (await tx.get(ref('claimAcks', target))).data();
        const p7Cancel = {};
        if (p7Enabled)
          for (const id of config.channels)
            p7Cancel[id] = (await tx.get(ref('p7Actions', id))).data();
        const scoreRef = ref('scoreboard', 'single'),
          scores = (await tx.get(scoreRef)).data();
        for (const [id, doc] of Object.entries(p7Cancel))
          if (doc) tx.set(ref('p7Actions', id), cancelP7(doc));

        const next = reduceLifecycle({
          seekersEnabled: config?.seekersEnabled,
          wanderEnabled: wander?.enabled,
          reviewPolicy,
          registry,
          channel,
          marks,
          host,
          policy,
          now,
          sentAt: now,
        });
        channelMap[host] = next.channel;
        markMap[host] = next.marks;
        for (const key of config.channels)
          presenceMap[key] = updatePresence(
            presenceMap[key],
            key,
            channelMap[key],
            markMap[key],
            null,
            now,
            now,
          );
        const checked = reduceClaims(
          next.registry,
          channelMap,
          markMap,
          history,
          null,
          now,
          now,
          presenceMap,
          config?.streakEnabled,
          keeperNames,
        );
        if (scores)
          tx.set(
            scoreRef,
            reduceScores(scores, {
              names: keeperNames,
              channels: channelMap,
              marks: checked.marks,
              now,
            }).doc,
          );
        for (const [key, doc] of Object.entries(presenceMap)) tx.set(ref('presence', key), doc);
        for (const [target, doc] of Object.entries(otherAcks))
          tx.set(ref('claimAcks', target), cancelCompletionNotices(doc));
        tx.set(
          ackRef,
          ackDocument(
            cancelCompletionNotices(ackDoc),
            { broadcasterId: host },
            null,
            next.channel,
            next.marks,
            now,
          ),
        );
        tx.set(ref('lineage', 'single'), checked.lineage);
        tx.set(ref('keeperRegistry', 'single'), checked.registry);
        tx.set(ref('streamChannels', host), next.channel);
        tx.set(ref('markChannels', host), next.marks);
      });
    },
    async forgeStep(input) {
      return db.runTransaction(async (tx) => {
        const r = ref('lineage', 'single');
        const change = forgeMutation((await tx.get(r)).data(), input);
        if (change.next) tx.set(r, change.next);
        return change.result;
      });
    },
    async chronicleStep(input) {
      return db.runTransaction(async (tx) => {
        const r = ref('lineage', 'single');
        const change = chronicleMutation((await tx.get(r)).data(), input);
        if (change.next) tx.set(r, change.next);
        return change.result;
      });
    },
    async getScoreboard(now) {
      return db.runTransaction(async (tx) => {
        const lineage = (await tx.get(ref('lineage', 'single'))).data(),
          registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const scores = (await tx.get(ref('scoreboard', 'single'))).data();
        const channels = {},
          marks = {};
        for (const id of config?.channels ?? []) {
          channels[id] = (await tx.get(ref('streamChannels', id))).data();
          marks[id] = (await tx.get(ref('markChannels', id))).data();
        }
        return scoreboard(
          lineage,
          registry,
          retainedScores(scores, channels, marks),
          config ?? { channels: [], logins: {} },
          now,
          publicKeeperProfiles(config, channels, marks),
        );
      });
    },
    async getRecap() {
      return recapProjection((await ref('lineage', 'single').get()).data());
    },
    async searchPublicMarks(options) {
      return atlasSearch((await ref('lineage', 'single').get()).data(), options);
    },
    async getJourneyMap(now) {
      return journeyMap((await ref('lineage', 'single').get()).data(), config, now);
    },
    async getAtlasPage(options) {
      return atlasPage((await ref('lineage', 'single').get()).data(), options);
    },
    async getPublicPresentation(host, now) {
      return db.runTransaction(async (tx) => {
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const lineage = (await tx.get(ref('lineage', 'single'))).data();
        const channel = (await tx.get(ref('streamChannels', host))).data();
        return {
          ...(holderLoginView(registry, keeperNames)
            ? { holderLogin: holderLoginView(registry, keeperNames) }
            : {}),
          ...(wanderArrivalView(registry, lineage, host)
            ? { wanderArrival: wanderArrivalView(registry, lineage, host) }
            : {}),
          rings: lineage?.stops?.length ?? 0,
          ...(config?.streakEnabled ? { streak: streakView(registry, now) } : {}),
          ...(movedToView(registry, lineage, host, channel, keeperNames)
            ? { movedToLogin: movedToView(registry, lineage, host, channel, keeperNames) }
            : {}),
          handoff: handoffView(registry, host, now, lineage, keeperNames),
          claimMeter: claimMeterView(registry, host, now),
          ...(echoView(registry, host, now) ? { resonance: echoView(registry, host, now) } : {}),
        };
      });
    },
    async getPublicJourney() {
      return publicJourney((await ref('lineage', 'single').get()).data());
    },
    async getPublicMarks(host) {
      return publicMarks((await ref('markChannels', host).get()).data(), host);
    },
    async getOverlayState(host, now = Date.now()) {
      return db.runTransaction(async (tx) => {
        const doc = (await tx.get(ref('markChannels', host))).data();
        const registry = (await tx.get(ref('keeperRegistry', 'single'))).data();
        const lineage = (await tx.get(ref('lineage', 'single'))).data();
        const channels = {},
          docs = { [host]: doc };
        if (
          registry?.pendingHop?.to === host &&
          !registry.pendingHop.finalized &&
          !registry.pendingHop.cancelled &&
          now < registry.pendingHop.endsAt
        ) {
          for (const id of [registry.pendingHop.from, host]) {
            channels[id] = (await tx.get(ref('streamChannels', id))).data();
            if (id !== host) docs[id] = (await tx.get(ref('markChannels', id))).data();
          }
        }
        return withIncomingPreview(
          withCarriedMarks(publicOverlayState(doc, host), lineage, registry, host),
          registry,
          host,
          channels,
          docs,
          now,
        );
      });
    },
    async getPrivateMarks(host, actor) {
      if (!isModerator(actor, host)) throw new Error('Moderator identity required');
      return privateMarks((await ref('markChannels', host).get()).data(), host, actor);
    },
    async acquireJob(id, owner, now) {
      return db.runTransaction(async (tx) => {
        const doc = ref('bootstrapJobs', id);
        const job = (await tx.get(doc)).data();
        if (job?.expiresAt > now) return false;
        tx.set(doc, { owner, expiresAt: now + 300000, status: 'running' });
        return true;
      });
    },
    async finishJob(id, owner, result) {
      await db.runTransaction(async (tx) => {
        const doc = ref('bootstrapJobs', id);
        const job = (await tx.get(doc)).data();
        if (job?.owner === owner) tx.set(doc, { expiresAt: 0, result });
      });
    },
    async getJob(id) {
      return (await ref('bootstrapJobs', id).get()).data()?.result ?? null;
    },
    async createControlSession(id, record) {
      await db.runTransaction(async (tx) => {
        const doc = ref('controlSessions', id);
        await tx.get(doc);
        tx.set(doc, record);
      });
    },
    async getControlSession(id, sessionHash, now) {
      return db.runTransaction(async (tx) => {
        const r = (await tx.get(ref('controlSessions', id))).data();
        return r?.sessionHash === sessionHash && r.expiresAt > now ? r : null;
      });
    },
    async renewControlSession(id, sessionHash, expectedExpiry, now, { signal } = {}) {
      return db.runTransaction(async (tx) => {
        const doc = ref('controlSessions', id);
        const r = (await tx.get(doc)).data();
        if (
          signal?.aborted ||
          r?.keeperId !== id ||
          r.role !== 'keeper' ||
          r.sessionHash !== sessionHash ||
          r.expiresAt !== expectedExpiry ||
          r.expiresAt <= now
        )
          return null;
        const next = { ...r, renewedAt: now, expiresAt: now + 43200000 };
        tx.set(doc, next);
        return next;
      });
    },
    async revokeControlSession(id, sessionHash, now) {
      return db.runTransaction(async (tx) => {
        const doc = ref('controlSessions', id);
        const r = (await tx.get(doc)).data();
        if (r?.sessionHash !== sessionHash || r.expiresAt <= now) return false;
        tx.delete(doc);
        return true;
      });
    },
    async createState(id, record, now = 0) {
      return db.runTransaction(async (tx) => {
        const refs = oauthStateSlots(id).map((key) => ref('oauthStates', key));
        const rows = [];
        for (const doc of refs) rows.push((await tx.get(doc)).data());
        if (rows.some((r) => r?.stateHash === id && r.expiresAt > now)) return false;
        const index = rows.findIndex((r) => !r || r.expiresAt <= now);
        if (index < 0) return false;
        tx.set(refs[index], { ...record, stateHash: id });
        return true;
      });
    },
    async consumeState(id, binding, now) {
      return db.runTransaction(async (tx) => {
        const refs = oauthStateSlots(id).map((key) => ref('oauthStates', key));
        // One bounded legacy lookup preserves already-issued five-minute flows.
        // Legacy orphans are not scanned, migrated or reissued by new starts.
        const legacy = ref('oauthStates', id);
        const rows = [];
        for (const doc of [...refs, legacy]) rows.push((await tx.get(doc)).data());
        const index = rows.findIndex(
          (r, i) =>
            r &&
            (i === refs.length ? r.stateHash === undefined : r.stateHash === id) &&
            r.binding === binding &&
            r.expiresAt > now,
        );
        if (index < 0) return null;
        tx.delete(index === refs.length ? legacy : refs[index]);
        const { stateHash, ...record } = rows[index];
        return record;
      });
    },
    async getToken(role) {
      return (await ref('oauthTokens', role).get()).data();
    },
    async acquire(role, owner, now) {
      return db.runTransaction(async (tx) => {
        const doc = ref('tokenLeases', role);
        const snap = await tx.get(doc);
        if (snap.exists && snap.data().expiresAt > now) return false;
        tx.set(doc, { owner, expiresAt: now + 30000 });
        return true;
      });
    },
    async saveToken(role, value, owner, now) {
      await db.runTransaction(async (tx) => {
        const lease = (await tx.get(ref('tokenLeases', role))).data();
        if (lease?.owner !== owner || lease.expiresAt <= now) throw new Error('Token lease lost');
        tx.set(ref('oauthTokens', role), value);
      });
    },
    async release(role, owner) {
      await db.runTransaction(async (tx) => {
        const doc = ref('tokenLeases', role);
        const snap = await tx.get(doc);
        if (snap.data()?.owner === owner) tx.delete(doc);
      });
    },
  };
}
