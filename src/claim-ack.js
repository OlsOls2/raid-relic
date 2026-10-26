import { RECEIVING_KEEPERS } from './receiving.js';
import { claimComplete } from '../public/ritual-copy.js';
import { ChatSendError } from './bot.js';
import { hash } from './crypto.js';
export const ackKey = (chat) =>
  hash(JSON.stringify(['claim-ack-v1', chat.broadcasterId, chat.chatterId, chat.messageId]));
const actorKey = (host, actor) => hash(`${host}:${actor}`);
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
  const doc = structuredClone(previous ?? { rows: [] });
  doc.rows = doc.rows.filter((r) => r.expiresAt > now);
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
        !channel?.optedIn ||
        channel.paused ||
        channel.banned ||
        marks?.paused ||
        !marks?.context?.optedIn ||
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
  }
  if (op.type === 'claim' && row?.status === 'queued') {
    row.status = 'dispatching';
    result = { message: row.message };
    if (op.p7 && row.completion) row.p7Proof = structuredClone(row.completion);
    delete row.message;
    delete row.actorKey;
    delete row.ackUntil;
    delete row.completion;
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
}) {
  let queue = Promise.resolve();
  return {
    process(host, key) {
      const execute = async () => {
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
          const result = await bots[host].sendChat(row.message, { retryUnauthorized: false });
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
) {
  const doc = structuredClone(previous ?? { rows: [] });
  doc.rows = doc.rows.filter((r) => r.expiresAt > now);
  const key = completionAckKey(host, eventId);
  if (!doc.rows.some((r) => r.key === key)) {
    if (doc.rows.length >= 128) return { doc, key: null };
    const row = {
      key,
      expiresAt: now + 600000,
      status: 'queued',
      message: claimComplete(names[hop?.to]),
      ackUntil: now + 30000,
      ...(hop
        ? {
            completion: {
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
export function completionEligible(doc, key, registry, channels, marks, now) {
  const row = doc?.rows?.find((r) => r.key === key),
    proof = row?.completion,
    hop = registry?.pendingHop;
  if (
    !proof ||
    !hop?.finalized ||
    hop.verified !== true ||
    hop.eventId !== proof.eventId ||
    hop.from !== proof.from ||
    hop.to !== proof.to ||
    registry.holderId !== hop.to ||
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
  return [hop.from, hop.to].every((id) => {
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
}

export function cancelCompletionNotices(previous) {
  const doc = structuredClone(previous ?? { rows: [] });
  for (const row of doc.rows) {
    delete row.p7Proof;
    if (row.status === 'queued' && row.completion) {
      row.status = 'cancelled';
      delete row.message;
      delete row.completion;
      delete row.ackUntil;
    }
  }
  return doc;
}
