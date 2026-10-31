import { RECEIVING_KEEPERS } from './receiving.js';
import { claimComplete, BOT_COPY } from '../public/ritual-copy.js';
import { ChatSendError } from './bot.js';
import { hash } from './crypto.js';
export const KEEPER_SETUP_HINT = BOT_COPY.keeperSetup;
const ownSetupHint = (row) =>
  /^\d{1,32}$/.test(row.keeperSetup ?? '') &&
  row.actorKey === hash(`${row.keeperSetup}:${row.keeperSetup}`) &&
  ['seek-on', 'seek-off', 'seek-status'].includes(row.scoreKind) &&
  row.message === KEEPER_SETUP_HINT;
export const ackKey = (chat) =>
  hash(JSON.stringify(['claim-ack-v1', chat.broadcasterId, chat.chatterId, chat.messageId]));
const actorKey = (host, actor) => hash(`${host}:${actor}`);
const noticeSlots = Object.freeze({
  sender: 1,
  progress1: 2,
  announcement: 4,
  arrival: 8,
  sourceComplete: 16,
  targetComplete: 32,
});
export const HOP_NOTICE_POLICY = 'six-chat-v2';
// Called only where the store observes send-state creating/replacing a hop.
// Existing/unbudgeted hops are never retrospectively certified.
export function trackHopNotices(previous, next) {
  const old = previous?.pendingHop,
    hop = next?.pendingHop;
  if (!hop || hop.eventId === old?.eventId) return;
  const landing =
    old?.policy === 'preclaim-v1' &&
    !old.verified &&
    old.intentId &&
    old.intentId === hop.intentId &&
    old.from === hop.from &&
    old.to === hop.to &&
    old.sourceStreamId === hop.sourceStreamId &&
    old.targetStreamId === hop.targetStreamId;
  if (landing) {
    if (old.noticeMask !== undefined) hop.noticeMask = old.noticeMask;
    if (old.noticePolicy === HOP_NOTICE_POLICY) hop.noticePolicy = HOP_NOTICE_POLICY;
  } else {
    hop.noticeMask = 0;
    hop.noticePolicy = HOP_NOTICE_POLICY;
  }
  if (Buffer.byteLength(JSON.stringify({ ...next, pendingHop: { ...hop, noticeMask: 63 } })) > 4096)
    throw Error('Relic registry capacity reached');
}
export function announcementBudgetAvailable(hop) {
  return (
    hop?.noticePolicy === HOP_NOTICE_POLICY &&
    Number.isInteger(hop.noticeMask) &&
    hop.noticeMask >= 0 &&
    hop.noticeMask <= 63 &&
    !(hop.noticeMask & 4)
  );
}
// Six fixed reservations live with the hop, across both rooms. Queued,
// cancelled and unknown deliveries all consume their slot permanently.
export function reserveHopNotice(hop, slot) {
  if (!hop || !Object.hasOwn(noticeSlots, slot)) return false;
  const bit = noticeSlots[slot];
  const used = hop.noticeMask === undefined ? 0 : hop.noticeMask;
  if (!Number.isInteger(used) || used < 0 || used > 63 || used & bit) return false;
  hop.noticeMask = used | bit;
  return true;
}

export function carriedApprovedCount(hop, lineage) {
  if (
    hop?.verified !== true ||
    hop.finalized !== true ||
    hop.cancelled ||
    typeof hop.eventId !== 'string' ||
    !Array.isArray(lineage?.stops)
  )
    return undefined;
  const matches = lineage.stops.filter(
    (s) =>
      s?.eventId === hop.eventId &&
      s.from === hop.from &&
      s.to === hop.to &&
      s.streamId === hop.sourceStreamId &&
      s.stopId === hash(hop.eventId) &&
      s.kind !== 'wander',
  );
  const stop = matches.length === 1 ? matches[0] : null;
  return stop &&
    Array.isArray(stop.marks) &&
    stop.marks.length <= 160 &&
    Array.from(stop.marks).every(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.userId === 'string' &&
        typeof m.text === 'string' &&
        (m.status === undefined || m.status === 'approved'),
    )
    ? stop.marks.length
    : undefined;
}

export function ackDocument(
  previous,
  chat,
  message,
  channel,
  marks,
  now,
  deadline = now + 90000,
  kind,
) {
  if (message?.quiet === true) message = null;
  // Generic command replies also use this helper. Vote replies may only come
  // from the transaction that reserved a hop slot, never from fallback errors.
  if (
    ['offer', 'accept'].includes(chat?.markAction?.type) &&
    !['hop-reserved', 'hop-sender'].includes(kind)
  )
    message = null;
  const doc = structuredClone(previous ?? { rows: [] });
  doc.rows = doc.rows.filter((r) => r.expiresAt > now);
  for (const row of doc.rows) if (row.completion || row.p7Proof) row.completionReceipt = true;
  for (const row of doc.rows)
    if (row.closedRateUntil <= now) {
      delete row.closedRateKey;
      delete row.closedRateUntil;
    }
  for (const row of doc.rows)
    if (
      row.status === 'queued' &&
      (now >= row.ackUntil ||
        (!channel?.online && !row.completion) ||
        (!channel?.optedIn && !ownSetupHint(row)) ||
        channel.paused ||
        channel.banned ||
        marks?.paused ||
        (!marks?.context?.optedIn && !ownSetupHint(row)) ||
        (chat?.markAction?.type === 'forgetme' && row.completion) ||
        (chat?.markAction?.type === 'forgetme' &&
          row.actorKey === actorKey(chat.broadcasterId, chat.chatterId)) ||
        channel.blockedUserIds?.length > 0 ||
        marks?.blocked?.length > 0 ||
        [...(channel.blockedUserIds ?? []), ...(marks?.blocked ?? [])].some(
          (id) => row.actorKey === actorKey(chat?.broadcasterId ?? '', id),
        ))
    ) {
      row.status = 'cancelled';
      delete row.message;
      delete row.actorKey;
      delete row.ackUntil;
      delete row.destinationLogin;
    }
  if (
    chat &&
    ['offer', 'accept', 'scores-on', 'scores-off', 'top', 'badges'].includes(
      chat.markAction?.type,
    ) &&
    !chat.isBot &&
    !chat.copied
  ) {
    const key = ackKey(chat);
    if (!doc.rows.some((r) => r.key === key)) {
      const actor = actorKey(chat.broadcasterId, chat.chatterId);
      if (doc.rows.filter((r) => r.requestActor === actor).length >= 8) return doc;
      if (
        kind === 'closed' &&
        doc.rows.some(
          (r) =>
            r.closedRateKey === actorKey(chat.broadcasterId, chat.chatterId) &&
            r.closedRateUntil > now,
        )
      )
        message = null;
      if (doc.rows.length >= 128) return doc;
      doc.rows.push({
        key,
        requestActor: actor,
        expiresAt: now + 600000,
        status: message ? 'queued' : 'ignored',
        ...(message && kind === 'closed'
          ? {
              closedRateKey: actorKey(chat.broadcasterId, chat.chatterId),
              closedRateUntil: now + 30000,
            }
          : {}),
        ...(message
          ? {
              message,
              ackUntil: deadline + 30000,
              actorKey: actorKey(chat.broadcasterId, chat.chatterId),
            }
          : {}),
      });
    }
  }
  if (Buffer.byteLength(JSON.stringify(doc)) > 65536) throw Error('Claim ACK capacity reached');
  return doc;
}
export function ackSeen(doc, chat, now) {
  return chat && doc?.rows?.some((r) => r.key === ackKey(chat) && r.expiresAt > now);
}
export function ackStep(previous, op, channel, marks, now, completionAllowed = false) {
  const doc = ackDocument(previous, null, null, channel, marks, now);
  const row = doc.rows.find((r) => r.key === op.key);
  let result = null;
  if (op.type === 'claim' && row?.status === 'queued' && row.completion && !completionAllowed) {
    row.status = 'cancelled';
    delete row.message;
    delete row.completion;
    delete row.destinationLogin;
  }
  if (op.type === 'claim' && row?.status === 'queued') {
    row.status = 'dispatching';
    result = { message: row.message };
    if (op.p7 && row.completion && row.completion.phase !== 'arrival')
      row.p7Proof = structuredClone(row.completion);
    delete row.message;
    delete row.actorKey;
    delete row.ackUntil;
    delete row.completion;
    delete row.destinationLogin;
    delete row.keeperSetup;
  }
  if (op.type === 'finish' && row?.status === 'dispatching')
    row.status = op.sent ? 'sent' : 'unknown';
  return { doc, result };
}
// One awaited in-process lane; gameplay jumps ahead of queued public reads.
export function createBotReplyQueue() {
  let active = false;
  const high = [],
    low = [];
  const pump = () => {
    if (active) return;
    const job = high.shift() ?? low.shift();
    if (!job) return;
    active = true;
    Promise.resolve()
      .then(job.operation)
      .then(job.resolve, job.reject)
      .finally(() => {
        active = false;
        pump();
      });
  };
  return (operation, priority = 0) =>
    new Promise((resolve, reject) => {
      const jobs = priority ? low : high;
      if (jobs.length >= (priority ? 16 : 64)) {
        reject(Error('Reply queue capacity'));
        return;
      }
      jobs.push({ operation, resolve, reject });
      pump();
    });
}
export function createClaimAcks({
  state,
  bots,
  now = Date.now,
  logger = (line) => console.warn(line),
  p7,
  commandReplies = false,
  schedule,
  resolveMessage,
}) {
  let queue = Promise.resolve();
  return {
    process(host, key) {
      const execute = async (targetHost = host, targetKey = key) => {
        const host = targetHost,
          key = targetKey;
        const row = await state.claimAckStep(
          host,
          { type: 'claim', key, ...(p7?.enabled ? { p7: true } : {}) },
          now(),
        );
        if (!row) return;
        let sent = false,
          messageId = null;
        let diagnostic = { stage: 'response', httpStatus: 200, dropKind: null, isSent: true };
        try {
          let message = row.message;
          if (row.queueStatus && resolveMessage) {
            try {
              message = await resolveMessage(host, row);
            } catch {
              /* Keep the closed, position-unconfirmed transactional reply. */
            }
          }
          const result = await bots[host].sendChat(message, { retryUnauthorized: false });
          messageId = result?.messageId;
          sent = true;
        } catch (error) {
          diagnostic =
            error instanceof ChatSendError
              ? error.diagnostic
              : { stage: 'unknown', httpStatus: null, dropKind: null, isSent: null };
        }
        let actions;
        try {
          actions = await state.claimAckStep(
            host,
            {
              type: 'finish',
              key,
              sent,
              ...(p7?.enabled ? { p7Finish: p7.config, messageId: messageId ?? null } : {}),
            },
            now(),
          );
        } catch {}
        if (Array.isArray(actions?.arrivalAcks))
          for (const notice of actions.arrivalAcks.slice(0, 1))
            await execute(notice.host, notice.key);
        if (p7?.enabled && Array.isArray(actions?.p7Keys))
          for (const action of actions.p7Keys.slice(0, 3)) {
            try {
              await p7.process(host, action);
            } catch {}
          }
        try {
          await logger(
            JSON.stringify(
              commandReplies
                ? {
                    severity: sent ? 'INFO' : 'WARNING',
                    event: 'command_reply',
                    host,
                    kind: [
                      'scores-on',
                      'scores-off',
                      'top',
                      'badges',
                      'help',
                      'offer',
                      'accept',
                      'forgetme',
                      'mymarks',
                      'mark',
                      'keep',
                      'pause',
                      'opt-out',
                      'approve',
                      'block',
                      'veto-last',
                      'pending',
                      'approve-last',
                      'reject-last',
                      'block-login',
                      'send',
                    ].includes(row.kind)
                      ? row.kind
                      : 'other',
                    outcome: sent ? 'sent' : 'unknown',
                    reason: row.reason === 'cooldown' ? 'cooldown' : 'normal',
                    httpStatus: diagnostic.httpStatus ?? null,
                  }
                : {
                    severity: sent ? 'INFO' : 'WARNING',
                    event: 'raid_relic_claim_ack',
                    host,
                    key,
                    outcome: sent ? 'sent' : 'unknown',
                    diagnostic,
                  },
            ),
          );
        } catch {}
      };
      const work = queue.then(() =>
        schedule ? schedule(execute, commandReplies ? 1 : 0) : execute(),
      );
      queue = work.catch(() => {});
      return work;
    },
  };
}

export const completionAckKey = (host, eventId) => hash(`claim-completion:${host}:${eventId}`);
export function completionAck(
  previous,
  host,
  eventId,
  deadline,
  now,
  hop,
  channels,
  names = RECEIVING_KEEPERS,
  phase = 'complete',
) {
  const doc = structuredClone(previous ?? { rows: [] });
  doc.rows = doc.rows.filter((r) => r.expiresAt > now);
  const key =
    phase === 'arrival'
      ? hash(`claim-arrival:${host}:${eventId}`)
      : completionAckKey(host, eventId);
  if (!doc.rows.some((r) => r.key === key)) {
    if (
      hop &&
      !reserveHopNotice(
        hop,
        phase === 'arrival' ? 'arrival' : host === hop.from ? 'sourceComplete' : 'targetComplete',
      )
    )
      return { doc, key: null };
    if (doc.rows.length >= 128) {
      // Earned notices outrank command bookkeeping; never evict another
      // completion's at-most-once receipt, including sent/unknown outcomes.
      const disposable = doc.rows.findIndex(
        (r) =>
          typeof r.requestActor === 'string' && !r.completionReceipt && !r.completion && !r.p7Proof,
      );
      if (disposable < 0) return { doc, key: null };
      doc.rows.splice(disposable, 1);
    }
    const row = {
      key,
      completionReceipt: true,
      ...(phase === 'arrival' ? { arrivalReceipt: true } : {}),
      expiresAt: now + 600000,
      status: 'queued',
      message: phase === 'arrival' ? BOT_COPY.arrival : claimComplete(names[hop?.to]),
      ...(phase !== 'arrival' && typeof names[hop?.to] === 'string'
        ? { destinationLogin: names[hop.to] }
        : {}),
      ackUntil: now + 30000,
      ...(hop
        ? {
            completion: {
              ...(phase === 'arrival' ? { phase } : {}),
              eventId,
              from: hop.from,
              to: hop.to,
              sourceStreamId: hop.sourceStreamId,
              targetStreamId: hop.targetStreamId,
              raidSentAt: hop.raidSentAt,
              sourceConsentAt: channels?.[hop.from]?.consentAt,
              targetConsentAt: channels?.[hop.to]?.consentAt,
            },
          }
        : {}),
    };
    doc.rows.push(row);
    if (Buffer.byteLength(JSON.stringify(doc)) > 65536) {
      doc.rows.pop();
      return { doc, key: null };
    }
  }
  return { doc, key };
}
export function completionEligible(doc, key, registry, channels, marks, now, lineage) {
  const row = doc?.rows?.find((r) => r.key === key),
    proof = row?.completion,
    hop = registry?.pendingHop;
  if (
    !proof ||
    !hop ||
    hop.cancelled ||
    (proof.phase === 'arrival' ? hop.finalized || now >= hop.endsAt : !hop.finalized) ||
    hop.verified !== true ||
    hop.eventId !== proof.eventId ||
    hop.from !== proof.from ||
    hop.to !== proof.to ||
    registry.holderId !== (proof.phase === 'arrival' ? hop.from : hop.to) ||
    registry.raidWatermark < hop.raidSentAt ||
    now >= row.ackUntil
  )
    return false;
  if (
    hop.sourceStreamId !== proof.sourceStreamId ||
    hop.targetStreamId !== proof.targetStreamId ||
    hop.raidSentAt !== proof.raidSentAt
  )
    return false;
  const allowed = [hop.from, hop.to].every((id) => {
    const c = channels[id],
      m = marks[id];
    const stream = id === hop.from ? hop.sourceStreamId : hop.targetStreamId;
    const retired =
      id === hop.from &&
      !c?.online &&
      c?.streamId === null &&
      c?.retiredStream?.streamId === stream &&
      hop.raidSentAt >= c.retiredStream.startedAt &&
      hop.raidSentAt <= c.retiredStream.offlineAt;
    return (
      ((c?.online && c.streamId === stream) || retired) &&
      c.consentAt === (id === hop.from ? proof.sourceConsentAt : proof.targetConsentAt) &&
      c.optedIn &&
      !c.paused &&
      !c.banned &&
      m?.context?.optedIn &&
      !m.paused &&
      m.context.streamId === stream &&
      [hop.from, hop.to].every(
        (actor) => !c.blockedUserIds.includes(actor) && !m.blocked.includes(actor),
      )
    );
  });
  if (
    allowed &&
    proof.phase !== 'arrival' &&
    (row.destinationLogin !== undefined || lineage !== undefined)
  )
    row.message = claimComplete(
      row.destinationLogin ?? RECEIVING_KEEPERS[hop.to],
      carriedApprovedCount(hop, lineage),
    );
  return allowed;
}

export function cancelCompletionNotices(previous) {
  const doc = structuredClone(previous ?? { rows: [] });
  for (const row of doc.rows) {
    delete row.p7Proof;
    if (row.status === 'queued' && row.completion) {
      row.status = 'cancelled';
      delete row.message;
      delete row.completion;
      delete row.destinationLogin;
      delete row.ackUntil;
    }
  }
  return doc;
}

const offerProofKey = (h) =>
  hash(
    JSON.stringify([
      'offer-prompt-v1',
      h.intentId ?? h.eventId,
      h.from,
      h.to,
      h.sourceStreamId,
      h.targetStreamId,
    ]),
  );
export function attachOfferProof(doc, chat, hop, counted) {
  const row = doc?.rows.find((r) => r.key === ackKey(chat));
  if (
    counted &&
    chat?.markAction?.type === 'offer' &&
    chat.broadcasterId === hop?.from &&
    row?.status === 'queued' &&
    !row.offerProof
  )
    row.offerProof = offerProofKey(hop);
  return doc;
}
export function arrivalNotice(previous, sourceAcks, registry, channels, marks, now, names) {
  const h = registry?.pendingHop;
  if (
    !h?.verified ||
    h.cancelled ||
    h.finalized ||
    !h.offers?.length ||
    now >= h.endsAt ||
    !sourceAcks?.rows.some(
      (r) => r.status === 'sent' && r.expiresAt > now && r.offerProof === offerProofKey(h),
    )
  )
    return null;
  const value = completionAck(
    previous,
    h.to,
    h.eventId,
    h.endsAt,
    now,
    h,
    channels,
    names,
    'arrival',
  );
  if (!value.key || !completionEligible(value.doc, value.key, registry, channels, marks, now))
    return null;
  return value;
}
