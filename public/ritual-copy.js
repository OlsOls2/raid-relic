// Pure presentation copy; callers supply only configured or fictional logins.
export function claimComplete(login, carriedApprovedCount) {
  const destination =
    typeof login === 'string' && /^[a-z0-9_]{1,25}$/.test(login) ? '@' + login : 'its new Keeper';
  const carried =
    Number.isInteger(carriedApprovedCount) &&
    carriedApprovedCount >= 0 &&
    carriedApprovedCount <= 160
      ? ` ${carriedApprovedCount} approved ${carriedApprovedCount === 1 ? 'rune' : 'runes'} carried.`
      : '';
  return `Claim complete: the relic transferred to ${destination}; one new ring.${carried}`;
}

export function wanderNotice(kind, login) {
  if (kind === 'warning')
    return 'The relic has been idle. It may wander to an opted-in Keeper after the warning period. Add an approved mark or start a valid Send Off to keep playing.';
  if (kind !== 'arrival' || typeof login !== 'string' || !/^[a-z0-9_]{1,25}$/.test(login))
    throw Error('Invalid Wander notice');
  return `The relic wandered here to @${login}; no raid or audience transfer occurred. Leave !mark word to add a community rune.`;
}

// Friendly, bounded chat copy shared by the transactional reply paths.
export const BOT_COPY = Object.freeze({
  reviewInstructions:
    'Moderators: !relic approve last or !relic reject last. Only the latest eligible pending mark is selected; no text is shared here.',
  reviewApproved: 'Approved the latest eligible pending mark in this active stream.',
  reviewRejected:
    'Rejected the latest eligible pending mark in this active stream. Quota and cooldown are not refunded.',
  reviewEmpty:
    'No eligible pending mark in this active stream. Approved and historical marks are unchanged.',
  reviewUnknownLogin:
    'No valid signed mention target was supplied. No block was made; use a structured mention or an independently verified immutable user ID with !relic block ID.',
  reviewBlocked:
    'Blocked the verified mentioned user from this channel’s retained marks. Twitch permissions are unchanged; quota and cooldown are not refunded.',

  keeperSetup:
    'Seeker queue off. Opt in as a Keeper first, then !seek to join; !seek off to leave.',
  closedClaim:
    'The binding window has closed… The relic stays with its Keeper. Begin a new Send Off to try again.',

  scoresOnRequiresThisOpted:
    'Scores on requires this opted-in Keeper to be live and unpaused. Reading the ledger does not opt you in.',
  scoresNeedYourVerifiedTwitch:
    'Scores need your verified Twitch login. No public score was created.',
  thePublicScoreRegisterIs:
    'The public score register is full. Your claims still work; no score was created.',
  publicScoresOffYourScore:
    'Public scores off. Your score name, participation count and links have been erased.',
  onlyThisBroadcasterCanChange: 'Only this broadcaster can change or read their Seeker choice.',
  theAuthorisedKeeperSeekerPilot: 'The authorised Keeper Seeker pilot is off.',
  youHoldTheRelicSeeker: 'You hold the relic. Seeker queue off; pass it on before joining again.',
  seekerQueueOnYourConfigured:
    'Seeker queue on. Your configured channel may be suggested while live and eligible. !seek off to leave.',
  seekerQueueOffTypeSeek: 'Seeker queue off. Type !seek to rejoin.',
  theCurrentRelicHolderIs: 'The current relic holder is not recorded.',
  thatVoteWasNotCounted: 'That vote was not counted. Check the ritual, chat role and deadline.',
  yourRetainedMarksSharedLinks:
    'Your retained marks, shared links and public scores were erased. Stream quota and cooldown are not refunded.',
  markHistoryLinkNotQueued:
    'Mark-history link not queued. Use your own verified login and wait one minute between requests. Shared links are public to anyone who receives them.',
  onlyThisBroadcasterOrAn: 'Only this broadcaster or an authorized moderator can use that command.',
  nothingIsRetainedToVeto:
    'Nothing is retained to veto in this channel. Moderators can remove the latest approved or pending mark; veto never refunds the five-mark allowance or waiting time.',
  vetoUnavailableAnEligibleRetained:
    'Veto unavailable: an eligible retained mark and authorized same-channel moderator are required.',
  waitingForModeratorApprovalYour:
    'Waiting for moderator approval. Your mark is private and is not visible on the relic. Moderators can use !relic pending.',
  marksAreOpenOnlyWhile:
    'Marks are open only while this channel is live, unpaused and holding the relic. No mark was added.',
  noMarkWasAddedUse:
    'No mark was added. Use one allowed word or emoji, for example !mark light; not !mark first light. Wait 30 seconds between marks and use at most five marks per stream. Private review text is never public.',
  markRequestCheckedUnderQuota:
    'Mark request checked under quota and cooldown. Clean valid marks become public automatically; held marks stay private until moderator approval.',
  markRequestProcessedUnderThe:
    'Mark request processed under the stream quota and cooldown. Only moderator-approved marks become public.',
  sendOffRequestCheckedThe:
    'Send Off request checked. The Keeper uses private control to process an eligible queued request; never repeat an unknown dispatch.',
  keeperCommandCheckedRefreshYour:
    'Keeper command checked. Refresh your private control for the authoritative result; role and stream safety rules still apply.',
  retainedCompletedArchiveOnlyInitial:
    'Retained completed archive only. Initial home hold start is unknown; historical raider participation is not available. Raider counts start after explicit score opt-in, never retroactively.',
  scoresAreOffForYou: 'Scores are off for you. !relic scores on to join; off to leave.',

  arrival:
    'The relic has arrived! Receiving chat: type !accept. Sending chat: type !offer. Both chats claim it before the local timer ends.',
  help: 'Raid Relic: !mark word leaves a rune for review; !offer sends, !accept welcomes. !where finds the Keeper; !seek is the broadcaster’s Seeker choice. !relic mymarks, top, badges, scores, scores on/off, forgetme. Moderators: !relic veto. Keeper setup and Send Off stay in private controls.',
  cooldown: 'Please wait ten seconds before repeating that command.',
  noSend:
    'No Send Off is active yet. The Keeper starts one in private control; after the raid arrives, sending chat uses !offer and receiving chat uses !accept.',
  earlyOffer:
    'Raid accepted. Wait for it to land, then send !offer again. This early offer was not saved.',
});
export function claimVoteCopy(side, hop, names) {
  const needOffers = Math.max(0, hop.threshold - hop.offers.length);
  const needAccepts = Math.max(0, hop.threshold - hop.accepts.length);
  const missing = [
    needOffers
      ? `${needOffers} ${needOffers === 1 ? 'offer' : 'offers'} in @${names[hop.from] ?? hop.from}`
      : null,
    needAccepts
      ? `${needAccepts} ${needAccepts === 1 ? 'accept' : 'accepts'} in @${names[hop.to] ?? hop.to}`
      : null,
  ].filter(Boolean);
  return `${side === 'offers' ? 'Offers' : 'Accepts'} ${hop[side].length}/${hop.threshold}. ${hop.verified ? '' : 'Waiting for Twitch to confirm the raid. '}${missing.length ? 'Waiting for ' + missing.join(' and ') + '.' : hop.verified ? 'Both chats reached the threshold.' : 'Both chats reached the threshold; waiting for Twitch to confirm the raid.'}`;
}

export function seekerStatusMessage(status) {
  if (status.reason === 'holding')
    return 'You hold the relic. Seeker queue off; pass it on before joining again.';
  if (!status.member)
    return status.reason === 'needs-rejoin'
      ? 'Seeker status: off. Your earlier choice predates a hand-off; type !seek to rejoin.'
      : status.reason === 'not-opted-in'
        ? 'Seeker status: off. Opt in as a Keeper first, then !seek.'
        : 'Seeker status: off. Type !seek to rejoin.';
  if (
    Number.isInteger(status.position) &&
    status.position >= 1 &&
    status.position <= 4 &&
    Number.isInteger(status.total) &&
    status.total >= status.position &&
    status.total <= 4
  )
    return `Seeker status: on. Eligible live suggestion ${status.position} of ${status.total}, ordered by viewers then login. !seek off to leave.`;
  const reasons = {
    paused: 'channel paused',
    'offline-or-stale': 'offline or stream not confirmed',
    'policy-blocked': 'channel policy',
    'observations-required': 'live permissions/readiness not confirmed',
  };
  return `Seeker status: on. Position not confirmed: ${reasons[status.reason] ?? reasons['observations-required']}. !seek off to leave.`;
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

export function ownScoreStatus(scores, key) {
  const own = scores?.players?.find((player) => player.key === key);
  return own
    ? `Scores are on for you: ${own.joined} recorded raids. !relic scores off to leave.`
    : BOT_COPY.scoresAreOffForYou;
}

export function scoreConsentReply(login) {
  return `@${login}: public scores on for future completed claims. Anyone can see this name and count. Use !relic scores off to erase them.`;
}
export function whereReply(holder, holderSince) {
  const since =
    Number.isSafeInteger(holderSince) && holderSince >= 0
      ? new Date(holderSince).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
      : 'not recorded';
  return `@${holder} holds the relic. Held since: ${since}. Watch: https://twitch.tv/${holder} · https://raid-relic-760724762396.us-central1.run.app/keeper/${holder}`;
}

export function marksShareReply(login, total, url) {
  return `@${login}: ${total} approved retained entries. PUBLIC CHAT share; anyone can open (10min): ${url}`;
}

export function pendingReviewReply(count) {
  if (!Number.isInteger(count) || count < 0 || count > 160) throw Error('Pending count');
  return `${count} pending marks in this active stream. ${BOT_COPY.reviewInstructions}`;
}
