import { seekerState, seekerStatusMessage } from './seeker-state.js';
import { RECEIVING_KEEPERS } from './receiving.js';
import { streakView, stopStreak } from './streaks.js';
import { selectEdition, editionBadgesForInterval } from '../public/editions.js';
import { ackDocument, ackKey, ackStep, KEEPER_SETUP_HINT } from './claim-ack.js';
import { hash } from './crypto.js';
import { INITIAL_HOME } from './lifecycle.js';
export const SCORE_LIMITS = Object.freeze({ players: 128, bytes: 65536, top: 20 });
export const TWITCHCON = Object.freeze({
  label: 'TwitchCon San Diego 2026',
  source: 'https://www.twitchcon.com/san-diego-2026/',
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
    !marks[host]?.context?.blockedUserIds?.includes(chat.chatterId);
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
          consentMessage =
            'Scores on requires this opted-in Keeper to be live and unpaused. Reading the ledger does not opt you in.';
        else if (!login(chat.chatterLogin))
          consentMessage = 'Scores need your verified Twitch login. No public score was created.';
        else {
          let row = doc.players.find((p) => p.key === key);
          if (!row && doc.players.length >= 128)
            consentMessage =
              'The public score register is full. Your claims still work; no score was created.';
          else {
            if (!row) {
              row = { key, login: chat.chatterLogin, channels: [], joined: 0, since: now };
              doc.players.push(row);
            }
            row.login = chat.chatterLogin;
            if (!row.channels.length) row.channels.push(host);
            consentMessage = `@${row.login}: public scores on for future completed claims. Anyone can see this name and count. Use !relic scores off to erase them.`;
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
          message = 'Please wait ten seconds before repeating that command.';
          reason = 'cooldown';
        } else if (action === 'scores-off')
          message =
            'Public scores off. Your score name, participation count and links have been erased.';
        else if (action === 'scores-on') message = consentMessage;
        else if (['seek-on', 'seek-off', 'seek-status'].includes(action))
          message =
            chat.chatterId !== host
              ? 'Only this broadcaster can change or read their Seeker choice.'
              : !seekersEnabled
                ? 'The authorised Keeper Seeker pilot is off.'
                : action === 'seek-status'
                  ? channels[host]?.optedIn === true
                    ? seekerStatusMessage(seekerState(registry, lineage, channels, marks, host))
                    : KEEPER_SETUP_HINT
                  : registry?.holderId === host
                    ? 'You hold the relic. Seeker queue off; pass it on before joining again.'
                    : seekerState(registry, lineage, channels, marks, host).member
                      ? 'Seeker queue on. Your configured channel may be suggested while live and eligible. !seek off to leave.'
                      : channels[host]?.optedIn === true
                        ? 'Seeker queue off. Type !seek to rejoin.'
                        : KEEPER_SETUP_HINT;
        else if (action === 'where') {
          const holder = names[registry?.holderId];
          message = holder
            ? `@${holder} holds the relic. Held since: ${Number.isSafeInteger(holderSince) && holderSince >= 0 ? new Date(holderSince).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : 'not recorded'}. Watch: https://twitch.tv/${holder} · https://raid-relic-760724762396.us-central1.run.app/keeper/${holder}`
            : 'The current relic holder is not recorded.';
        } else if (action === 'scores-status') {
          message = ownScoreStatus(doc, key);
        } else if (['top', 'badges'].includes(action)) message = action;
        else if (action === 'offer' && awaitingRaid)
          message =
            'Raid accepted. Wait for it to land, then send !offer again. This early offer was not saved.';
        else if (['offer', 'accept'].includes(action))
          message =
            hop && !hop.cancelled && !hop.finalized && now < hop.endsAt
              ? 'That vote was not counted. Check the ritual, chat role and deadline.'
              : 'No Send Off is active yet. The keeper starts one on the control page, then raid and !offer.';
        else if (action === 'forgetme')
          message =
            'Your retained marks, shared links and public scores were erased. Stream quota and cooldown are not refunded.';
        else if (action === 'mymarks')
          message =
            'Mark-history link not queued. Use your own verified login and wait one minute between requests. Shared links are public to anyone who receives them.';
        else if (
          ['approve', 'block', 'veto-last', 'pause'].includes(action) &&
          chat.chatterId !== host &&
          !chat.isModerator
        )
          message = 'Only this broadcaster or an authorized moderator can use that command.';
        else if (action === 'veto-last')
          message =
            markOutcome === 'vetoed'
              ? 'Vetoed latest mark.'
              : markOutcome === 'empty'
                ? 'Nothing is retained to veto in this channel. Moderators can remove the latest approved or pending mark; veto never refunds the five-mark allowance or waiting time.'
                : 'Veto unavailable: an eligible retained mark and authorized same-channel moderator are required.';
        else if (action === 'mark' && ['approved', 'pending'].includes(markOutcome))
          message =
            markOutcome === 'approved'
              ? 'Your mark is public on the relic.'
              : 'Waiting for moderator approval. Your mark is private and is not visible on the relic.';
        else if (action === 'mark' && markOutcome === 'not-added')
          message =
            !channels[host]?.online || channels[host]?.paused || !marks[host]?.context?.holdsRelic
              ? 'Marks are open only while this channel is live, unpaused and holding the relic. No mark was added.'
              : 'No mark was added. Use one allowed word or emoji, wait 30 seconds between marks, and use at most five marks per stream. Private review text is never public.';
        else if (action === 'mark')
          message =
            channels[host].online && !channels[host].paused && marks[host]?.context?.holdsRelic
              ? autoApprove
                ? 'Mark request checked under quota and cooldown. Clean valid marks become public automatically; held marks stay private until moderator approval.'
                : 'Mark request processed under the stream quota and cooldown. Only moderator-approved marks become public.'
              : 'Marks are open only while this channel is live, unpaused and holding the relic. No mark was added.';
        else if (action === 'send')
          message =
            'Send Off request checked. The Keeper uses private control to process an eligible queued request; never repeat an unknown dispatch.';
        else if (action === 'help')
          message =
            'Raid Relic: !mark word, !offer, !accept, !relic mymarks, !relic top, !relic badges, !relic scores (your status), !relic scores on/off, !relic forgetme, !relic veto (moderators). Keeper setup and Send Off use private controls.';
        else
          message =
            'Keeper command checked. Refresh your private control for the authoritative result; role and stream safety rules still apply.';
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
    if (i === 0 && s.claimedAt >= TWITCHCON.startsAt && s.claimedAt < TWITCHCON.endsAt)
      r.badges.push('Carried during TwitchCon San Diego 2026');
    if (i && stops[i - 1].kind !== 'wander') {
      const held = row(stops[i - 1].to),
        start = stops[i - 1].claimedAt;
      held.knownHoldSeconds += (s.claimedAt - start) / 1000;
      if (start < TWITCHCON.endsAt && s.claimedAt > TWITCHCON.startsAt && s.claimedAt > start)
        held.badges.push('Carried during TwitchCon San Diego 2026');
    }
  }
  if (stops.length && stops.at(-1).kind !== 'wander' && registry?.holderId === stops.at(-1).to) {
    const held = row(registry.holderId),
      start = stops.at(-1).claimedAt;
    held.knownHoldSeconds += (now - start) / 1000;
    if (start < TWITCHCON.endsAt && now >= TWITCHCON.startsAt)
      held.badges.push('Carried during TwitchCon San Diego 2026');
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
    coverage:
      'Retained completed archive only. Initial home hold start is unknown; historical raider participation is not available. Raider counts start after explicit score opt-in, never retroactively.',
    channels: rows,
    ...(config.seekersEnabled ? { publicProfiles } : {}),
    raiders,
    event: TWITCHCON,
  };
}
export function scoreMessage(kind, view, host) {
  if (kind === 'badges')
    return `Keeper badges: ${view.channels.find((r) => r.channelId === host)?.badges.join(', ') || 'none recorded yet'}. Retained completed archive only.`.slice(
      0,
      500,
    );
  return `Recorded Keepers: ${view.channels.map((r) => `${r.login ?? r.channelId}: ${r.hopsCarried} hops, ${r.knownHoldSeconds}s known hold`).join('; ')}. Opted-in raiders: ${
    view.raiders
      .slice(0, 3)
      .map((r) => `@${r.login} ${r.claimsJoined}`)
      .join(', ') || 'none recorded'
  }. Not all-time history.`.slice(0, 500);
}

function ownScoreStatus(scores, key) {
  const own = scores?.players?.find((player) => player.key === key);
  return own
    ? `Scores are on for you: ${own.joined} recorded raids. !relic scores off to leave.`
    : 'Scores are off for you. !relic scores on to join; off to leave.';
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
