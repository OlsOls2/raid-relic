import { isReviewCommand } from './marks.js';
import {
  BOT_COPY,
  scoreMessage,
  ownScoreStatus,
  whereReply,
  scoreConsentReply,
  pendingReviewReply,
} from '../public/ritual-copy.js';
import { seekerState, seekerStatusMessage } from './seeker-state.js';
import { RECEIVING_KEEPERS } from './receiving.js';
import { streakView, stopStreak } from './streaks.js';
import { selectEdition, editionBadgesForInterval } from '../public/editions.js';
import { ackDocument, ackKey, ackStep, KEEPER_SETUP_HINT } from './claim-ack.js';
import { hash } from './crypto.js';
import { INITIAL_HOME } from './lifecycle.js';
export const SCORE_LIMITS = Object.freeze({ players: 128, bytes: 65536, top: 20 });
export const EVENT_DAYS = Object.freeze({
  label: 'Event-days badge · 13–15 Nov',
  source: 'Retained-hold calendar (UTC)',
  checked: '2026-10-25',
  startsAt: Date.parse('2026-11-13T08:00:00Z'),
  endsAt: Date.parse('2026-11-16T08:00:00Z'),
});
export const isReplyCommand = (chat) =>
  Boolean(chat?.markAction && typeof chat.messageId === 'string' && !chat.isBot && !chat.copied);
export const isScoreCommand = (chat) =>
  isReplyCommand(chat) && !['offer', 'accept', 'mymarks'].includes(chat.markAction.type);
const login = (value) => typeof value === 'string' && /^[a-z0-9_]{1,25}$/.test(value);
const actorKey = (id) => hash(`score-actor-v1:${id}`);
const link = (hop) => hash(`score-hop-v1:${hop?.intentId ?? hop?.eventId}`);
const retained = (host, channels, marks, id) =>
  channels[host]?.optedIn &&
  !channels[host]?.banned &&
  marks[host]?.context?.optedIn &&
  !channels[host]?.blockedUserIds?.includes(id) &&
  !marks[host]?.blocked?.includes(id);
const allowed = (host, channels, marks, id) =>
  retained(host, channels, marks, id) && !channels[host]?.paused && !marks[host]?.paused;
export function retainedScores(scores, channels, marks) {
  return {
    ...scores,
    players: (scores?.players ?? []).filter(
      (p) =>
        p.channels.every((host) => retained(host, channels, marks)) &&
        !Object.keys(channels).some((host) =>
          [...(channels[host]?.blockedUserIds ?? []), ...(marks[host]?.blocked ?? [])].some(
            (id) => actorKey(id) === p.key,
          ),
        ),
    ),
  };
}
// Private bounded consent/aggregate document. No raw actor IDs or chat text.
export function reduceScores(
  previous,
  {
    channels,
    marks,
    chat,
    now,
    sentAt = now,
    vote,
    completion,
    hop,
    acknowledged = false,
    autoApprove = false,
    awaitingRaid = false,
    markOutcome,
    registry,
    seekersEnabled = false,
    holderSince = null,
    lineage,
    names = RECEIVING_KEEPERS,
  },
) {
  const doc = structuredClone(previous ?? { version: 1, players: [], receipts: [] }),
    action = chat?.markAction?.type,
    key = chat && actorKey(chat.chatterId),
    host = chat?.broadcasterId;
  doc.receipts = doc.receipts.filter((r) => r.until > now);
  doc.players = retainedScores(doc, channels, marks).players.filter(
    (p) => !(action === 'forgetme' && p.key === key),
  );
  const command = isReplyCommand(chat),
    request = command
      ? hash(JSON.stringify(['score-command-v1', host, chat.chatterId, chat.messageId]))
      : null,
    duplicate = doc.receipts.some((r) => r.key === request);
  // Erasure always precedes reply budgets, including offline/full/spam cases.
  if (action === 'scores-off' && !duplicate && !chat.isBot && !chat.copied && channels[host])
    doc.players = doc.players.filter((p) => p.key !== key);
  let message = null,
    reason = 'not-command';
  const safe =
    command &&
    ((channels[host]?.optedIn && marks[host]?.context?.optedIn) ||
      (['seek-on', 'seek-off', 'seek-status'].includes(action) &&
        chat.chatterId === host &&
        channels[host])) &&
    !channels[host].banned &&
    !channels[host].blockedUserIds?.includes(chat.chatterId) &&
    !marks[host]?.blocked?.includes(chat.chatterId) &&
    !marks[host]?.context?.blockedUserIds?.includes(chat.chatterId) &&
    (!isReviewCommand(action) ||
      ((chat.chatterId === host || chat.isModerator === true) &&
        channels[host].online &&
        !channels[host].paused &&
        !marks[host]?.paused &&
        marks[host]?.context?.holdsRelic === true &&
        marks[host].context.keeperId === host &&
        marks[host].context.streamId === channels[host].streamId &&
        Number.isFinite(sentAt) &&
        sentAt <= now &&
        now - sentAt <= 600000 &&
        sentAt >= channels[host].startedAt &&
        sentAt >= channels[host].consentAt &&
        sentAt > channels[host].closedThrough &&
        !['review-denied', 'review-inactive'].includes(markOutcome)));
  if (command) {
    reason = safe ? 'queued' : 'policy-blocked';
    if (duplicate) reason = 'duplicate';
    else if (!safe) reason = 'policy-blocked';
    else if (acknowledged) reason = 'handled';
    else if (
      doc.receipts.filter((r) => r.actor === hash(`command-actor:${host}:${chat.chatterId}`))
        .length >= 8 ||
      doc.receipts.filter((r) => r.room === hash(`command-room:${host}`)).length >= 32
    )
      reason = 'cooldown-quiet';
    else if (doc.receipts.length >= 128) reason = 'capacity';
    else {
      const rate = hash(`command-rate-v2:${host}:${chat.chatterId}:${action}`),
        notice = hash(`command-notice-v2:${host}:${chat.chatterId}`),
        limited = doc.receipts.some((r) => r.rate === rate && r.at + 10000 > now);
      const r = {
        key: request,
        until: now + 600000,
        actor: hash(`command-actor:${host}:${chat.chatterId}`),
        room: hash(`command-room:${host}`),
        ...(!limited ? { rate, at: now } : {}),
      };
      doc.receipts.push(r);
      let consentMessage = null;
      if (action === 'scores-on' && !limited) {
        if (!channels[host].online || !allowed(host, channels, marks, chat.chatterId))
          consentMessage = BOT_COPY.scoresOnRequiresThisOpted;
        else if (!login(chat.chatterLogin)) consentMessage = BOT_COPY.scoresNeedYourVerifiedTwitch;
        else {
          let row = doc.players.find((p) => p.key === key);
          if (!row && doc.players.length >= 128) consentMessage = BOT_COPY.thePublicScoreRegisterIs;
          else {
            if (!row) {
              row = { key, login: chat.chatterLogin, channels: [], joined: 0, since: now };
              doc.players.push(row);
            }
            row.login = chat.chatterLogin;
            if (!row.channels.length) row.channels.push(host);
            consentMessage = scoreConsentReply(row.login);
          }
        }
      }
      if (!doc.replyBudget || now >= doc.replyBudget.at + 60000)
        doc.replyBudget = { at: now, total: 0, channels: {} };
      const budget = doc.replyBudget;
      if (now < budget.at || budget.total >= 40 || (budget.channels[host] ?? 0) >= 20)
        reason = 'budget';
      else if (limited && doc.receipts.some((x) => x.notice === notice && x.noticeUntil > now))
        reason = 'cooldown-quiet';
      else {
        budget.total++;
        budget.channels[host] = (budget.channels[host] ?? 0) + 1;
        if (limited) {
          r.notice = notice;
          r.noticeUntil = now + 10000;
          message = BOT_COPY.cooldown;
          reason = 'cooldown';
        } else if (action === 'scores-off') message = BOT_COPY.publicScoresOffYourScore;
        else if (action === 'scores-on') message = consentMessage;
        else if (['seek-on', 'seek-off', 'seek-status'].includes(action))
          message =
            chat.chatterId !== host
              ? BOT_COPY.onlyThisBroadcasterCanChange
              : !seekersEnabled
                ? BOT_COPY.theAuthorisedKeeperSeekerPilot
                : action === 'seek-status'
                  ? channels[host]?.optedIn === true
                    ? seekerStatusMessage(seekerState(registry, lineage, channels, marks, host))
                    : KEEPER_SETUP_HINT
                  : registry?.holderId === host
                    ? BOT_COPY.youHoldTheRelicSeeker
                    : seekerState(registry, lineage, channels, marks, host).member
                      ? BOT_COPY.seekerQueueOnYourConfigured
                      : channels[host]?.optedIn === true
                        ? BOT_COPY.seekerQueueOffTypeSeek
                        : KEEPER_SETUP_HINT;
        else if (action === 'where') {
          const holder = names[registry?.holderId];
          message = holder ? whereReply(holder, holderSince) : BOT_COPY.theCurrentRelicHolderIs;
        } else if (action === 'scores-status') {
          message = ownScoreStatus(doc, key);
        } else if (['top', 'badges'].includes(action)) message = action;
        else if (action === 'offer' && awaitingRaid) message = BOT_COPY.earlyOffer;
        else if (['offer', 'accept'].includes(action))
          message =
            hop && !hop.cancelled && !hop.finalized && now < hop.endsAt
              ? BOT_COPY.thatVoteWasNotCounted
              : BOT_COPY.noSend;
        else if (action === 'forgetme') message = BOT_COPY.yourRetainedMarksSharedLinks;
        else if (action === 'mymarks') message = BOT_COPY.markHistoryLinkNotQueued;
        else if (
          ['approve', 'block', 'veto-last', 'pause'].includes(action) &&
          chat.chatterId !== host &&
          !chat.isModerator
        )
          message = BOT_COPY.onlyThisBroadcasterOrAn;
        else if (isReviewCommand(action)) {
          const count = /^pending:(\d{1,3})$/.exec(markOutcome ?? '');
          message =
            action === 'pending' && count && Number(count[1]) <= 160
              ? pendingReviewReply(Number(count[1]))
              : markOutcome === 'approved-last'
                ? BOT_COPY.reviewApproved
                : markOutcome === 'rejected-last'
                  ? BOT_COPY.reviewRejected
                  : markOutcome === 'review-empty'
                    ? BOT_COPY.reviewEmpty
                    : markOutcome === 'login-blocked'
                      ? BOT_COPY.reviewBlocked
                      : markOutcome === 'login-unresolved'
                        ? BOT_COPY.reviewUnknownLogin
                        : null;
        } else if (action === 'veto-last')
          message =
            markOutcome === 'vetoed'
              ? 'Vetoed latest mark.'
              : markOutcome === 'empty'
                ? BOT_COPY.nothingIsRetainedToVeto
                : BOT_COPY.vetoUnavailableAnEligibleRetained;
        else if (action === 'mark' && ['approved', 'pending'].includes(markOutcome))
          message =
            markOutcome === 'approved'
              ? 'Your mark is public on the relic.'
              : BOT_COPY.waitingForModeratorApprovalYour;
        else if (action === 'mark' && markOutcome === 'not-added')
          message =
            !channels[host]?.online || channels[host]?.paused || !marks[host]?.context?.holdsRelic
              ? BOT_COPY.marksAreOpenOnlyWhile
              : BOT_COPY.noMarkWasAddedUse;
        else if (action === 'mark')
          message =
            channels[host].online && !channels[host].paused && marks[host]?.context?.holdsRelic
              ? autoApprove
                ? BOT_COPY.markRequestCheckedUnderQuota
                : BOT_COPY.markRequestProcessedUnderThe
              : BOT_COPY.marksAreOpenOnlyWhile;
        else if (action === 'send') message = BOT_COPY.sendOffRequestCheckedThe;
        else if (action === 'help') message = BOT_COPY.help;
        else message = BOT_COPY.keeperCommandCheckedRefreshYour;
      }
    }
  }
  if (vote) {
    const row = doc.players.find((p) => p.key === actorKey(vote));
    if (row && row.since <= now) row.vote = link(hop);
  }
  if (completion)
    for (const row of doc.players)
      if (
        row.vote === completion.link &&
        completion.actors.some((id) => actorKey(id) === row.key)
      ) {
        row.joined++;
        delete row.vote;
      }
  if (Buffer.byteLength(JSON.stringify(doc)) > SCORE_LIMITS.bytes)
    throw Error('Score capacity invariant');
  return { doc, message, reason };
}
export const scoreCompletion = (hop, actors) => ({ link: link(hop), actors });
// Public projection is an explicit whitelist; history is bounded, never an all-time claim.
export function publicKeeperProfiles(config, channels, marks) {
  return (config?.channels ?? [])
    .filter(
      (id) =>
        channels[id]?.optedIn &&
        !channels[id]?.banned &&
        marks[id]?.context?.optedIn &&
        !channels[id]?.blockedUserIds?.includes(id) &&
        !marks[id]?.blocked?.includes(id),
    )
    .map((id) => Object.entries(config.logins ?? {}).find(([, v]) => v === id)?.[0])
    .filter(Boolean);
}
export function scoreboard(lineage, registry, scores, config, now, publicProfiles = []) {
  const stops = lineage?.stops ?? [];
  if (stops.length > 16 || !Number.isSafeInteger(now) || now < 0)
    throw Error('Invalid score archive');
  const seen = new Set();
  let last = -1;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (
      !config?.channels.includes(s.from) ||
      !config.channels.includes(s.to) ||
      s.from === s.to ||
      !Number.isSafeInteger(s.claimedAt) ||
      s.claimedAt < last ||
      s.claimedAt > now ||
      s.ringIndex !== i + 1 ||
      typeof s.eventId !== 'string' ||
      seen.has(s.eventId) ||
      (i && stops[i - 1].to !== s.from)
    )
      throw Error('Invalid score archive');
    seen.add(s.eventId);
    last = s.claimedAt;
  }
  const rows = config.channels.map((id) => ({
    channelId: id,
    login: Object.entries(config.logins).find(([, v]) => v === id)?.[0] ?? null,
    knownHoldSeconds: 0,
    hopsCarried: 0,
    badges: [],
  }));
  const row = (id) => rows.find((r) => r.channelId === id);
  if (registry?.originated || stops[0]?.from === INITIAL_HOME)
    row(INITIAL_HOME)?.badges.push('First Keeper');
  let raidIndex = 0;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].kind === 'wander') continue;
    raidIndex++;
    const s = stops[i],
      r = row(s.from);
    r.hopsCarried++;
    if ([1, 5, 10].includes(raidIndex)) r.badges.push(`Ring ${raidIndex}`);
    if (raidIndex >= 3) r.badges.push('Chain of 3');
    if (config?.streakEnabled && stopStreak(s).streakCount >= 3)
      row(s.to).badges.push('Unbroken streak · 3 hand-offs');
    if (i === 0 && selectEdition(s.claimedAt)) r.badges.push(selectEdition(s.claimedAt).badgeLabel);
    if (i && stops[i - 1].kind !== 'wander')
      row(stops[i - 1].to).badges.push(
        ...editionBadgesForInterval(stops[i - 1].claimedAt, s.claimedAt),
      );
    if (i === 0 && s.claimedAt >= EVENT_DAYS.startsAt && s.claimedAt < EVENT_DAYS.endsAt)
      r.badges.push('Event-days badge · 13–15 Nov');
    if (i && stops[i - 1].kind !== 'wander') {
      const held = row(stops[i - 1].to),
        start = stops[i - 1].claimedAt;
      held.knownHoldSeconds += (s.claimedAt - start) / 1000;
      if (start < EVENT_DAYS.endsAt && s.claimedAt > EVENT_DAYS.startsAt && s.claimedAt > start)
        held.badges.push('Event-days badge · 13–15 Nov');
    }
  }
  if (stops.length && stops.at(-1).kind !== 'wander' && registry?.holderId === stops.at(-1).to) {
    const held = row(registry.holderId),
      start = stops.at(-1).claimedAt;
    held.knownHoldSeconds += (now - start) / 1000;
    if (start < EVENT_DAYS.endsAt && now >= EVENT_DAYS.startsAt)
      held.badges.push('Event-days badge · 13–15 Nov');
  }
  if (stops.length && stops.at(-1).kind !== 'wander' && registry?.holderId === stops.at(-1).to)
    row(registry.holderId).badges.push(
      ...editionBadgesForInterval(stops.at(-1).claimedAt, now, { ongoing: true }),
    );
  for (const r of rows) {
    r.knownHoldSeconds = Math.floor(r.knownHoldSeconds);
    if (r.knownHoldSeconds >= 86400) r.badges.push('24h Keeper');
    r.badges = [...new Set(r.badges)];
  }
  rows.sort(
    (a, b) =>
      b.knownHoldSeconds - a.knownHoldSeconds ||
      b.hopsCarried - a.hopsCarried ||
      a.channelId.localeCompare(b.channelId),
  );
  if (
    (scores?.players?.length ?? 0) > 128 ||
    (scores?.players ?? []).some(
      (p) =>
        !login(p.login) ||
        !Number.isInteger(p.joined) ||
        p.joined < 0 ||
        p.joined > 16 ||
        !Number.isSafeInteger(p.since) ||
        p.since < 0 ||
        p.since > now,
    )
  )
    throw Error('Invalid score aggregate');
  const raiders = (scores?.players ?? [])
    .filter((p) => login(p.login))
    .map((p) => ({ login: p.login, claimsJoined: p.joined, since: p.since }))
    .sort((a, b) => b.claimsJoined - a.claimsJoined || a.login.localeCompare(b.login))
    .slice(0, 20);
  return {
    asOf: now,
    rings: stops.length,
    ...(stops.some((s) => s.kind === 'wander')
      ? { wanderStops: stops.filter((s) => s.kind === 'wander').length }
      : {}),
    ...(config?.streakEnabled ? { streak: streakView(registry, now) } : {}),
    coverage: BOT_COPY.retainedCompletedArchiveOnlyInitial,
    channels: rows,
    ...(config.seekersEnabled ? { publicProfiles } : {}),
    raiders,
    event: EVENT_DAYS,
  };
}
export function scoreAckDocument(previous, chat, message, channel, marks, now) {
  const read = true; // This outbox delivers status only, never game authority.
  const policyChannel = read
      ? { ...channel, online: true, paused: false, blockedUserIds: [] }
      : channel,
    policyMarks = read ? { ...marks, paused: false, blocked: [] } : marks;
  const previousRows = structuredClone(previous ?? { rows: [] });
  if (['forgetme', 'scores-off'].includes(chat?.markAction?.type))
    for (const row of previousRows.rows)
      if (
        row.status === 'queued' &&
        (row.consentKey === actorKey(chat.chatterId) ||
          row.actorKey === hash(`${chat.broadcasterId}:${chat.chatterId}`))
      ) {
        row.status = 'cancelled';
        delete row.message;
        delete row.actorKey;
        delete row.consentKey;
        delete row.selfStatusKey;
      }
  const clean = ackDocument(previousRows, null, null, policyChannel, policyMarks, now);
  if (clean.rows.length >= 128 && !clean.rows.some((r) => r.key === ackKey(chat))) return clean;
  const ownChat = { ...chat, markAction: { type: 'top' } };
  const doc = ackDocument(clean, ownChat, message, policyChannel, policyMarks, now, now);
  const row = doc.rows.find((r) => r.key === ackKey(chat));
  if (row?.status === 'queued') {
    row.scoreKind = chat.markAction.type;
    if (
      message !== KEEPER_SETUP_HINT &&
      row.scoreKind === 'seek-status' &&
      chat.chatterId === chat.broadcasterId &&
      message &&
      !message.startsWith('Please wait')
    )
      row.ownSeekerStatus = true;
    if (
      chat.chatterId === chat.broadcasterId &&
      ['seek-on', 'seek-off', 'seek-status'].includes(row.scoreKind) &&
      message === KEEPER_SETUP_HINT
    )
      row.keeperSetup = chat.broadcasterId;
    if (row.scoreKind === 'scores-status') row.selfStatusKey = actorKey(chat.chatterId);
    row.readSummary =
      ['top', 'badges'].includes(row.scoreKind) &&
      message?.startsWith(row.scoreKind === 'top' ? 'Recorded Keepers:' : 'Keeper badges:');
    if (row.scoreKind === 'scores-on' && row.message.startsWith('@')) {
      row.consentKey = actorKey(chat.chatterId);
      row.message = 'Public score consent updated.';
    }
    if (['top', 'badges'].includes(row.scoreKind) && message === undefined)
      row.message = 'Read public score summary.';
  }
  // Bounded score metadata is separate from the gameplay ACK register.
  if (Buffer.byteLength(JSON.stringify(doc)) > 65536) {
    if (row?.status === 'queued') {
      row.status = 'cancelled';
      delete row.message;
      delete row.actorKey;
      delete row.consentKey;
      delete row.selfStatusKey;
    }
  }
  return doc;
}
export function scoreAckMutation(
  previous,
  op,
  channel,
  marks,
  now,
  scores,
  lineage,
  registry,
  config,
  host,
) {
  const doc = structuredClone(previous ?? { rows: [] }),
    row = doc.rows.find((r) => r.key === op.key);
  if (op.type === 'claim' && row?.status === 'queued') {
    if (row.scoreKind === 'scores-status') row.message = ownScoreStatus(scores, row.selfStatusKey);
    if (row.consentKey) {
      const consent = scores?.players.find((p) => p.key === row.consentKey);
      if (!consent) {
        row.status = 'cancelled';
        delete row.message;
        delete row.actorKey;
      } else
        row.message = `@${consent.login}: public scores on for future completed claims. Anyone can see this name and count. Use !relic scores off to erase them.`;
    }
    if (
      row.readSummary === true ||
      (row.readSummary === undefined && ['top', 'badges'].includes(row.scoreKind))
    )
      row.message = scoreMessage(
        row.scoreKind,
        scoreboard(lineage, registry, scores, config, now),
        host,
      );
  }
  const read = Boolean(row);
  if (
    op.type === 'claim' &&
    row?.status === 'queued' &&
    [
      ...(channel?.blockedUserIds ?? []),
      ...(marks?.blocked ?? []),
      ...(marks?.context?.blockedUserIds ?? []),
    ].some((id) => hash(`${host}:${id}`) === row.actorKey)
  ) {
    row.status = 'cancelled';
    delete row.message;
    delete row.actorKey;
    delete row.consentKey;
    delete row.selfStatusKey;
  }
  const next = ackStep(
    doc,
    op,
    read ? { ...channel, online: true, paused: false, blockedUserIds: [] } : channel,
    read ? { ...marks, paused: false, blocked: [] } : marks,
    now,
  );
  if (next.result) {
    next.result.kind = row?.scoreKind;
    if (row?.ownSeekerStatus) next.result.queueStatus = true;
    next.result.reason = row?.message?.startsWith('Please wait') ? 'cooldown' : 'normal';
  }
  for (const r of next.doc.rows)
    if (r.status !== 'queued') {
      delete r.consentKey;
      delete r.scoreKind;
      delete r.ownSeekerStatus;
      delete r.readSummary;
      delete r.selfStatusKey;
    }
  return next;
}

export { scoreMessage } from '../public/ritual-copy.js';
