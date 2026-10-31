import { keeperNames as networkNames } from './keeper-network.js';
// Closed-vocabulary UI; never render upstream bodies, arbitrary messages or JSON.
export const keeperNames = networkNames;

// The server reports saved candidate-cache time independently of this page's GET age.
export function targetObservationText(pilot, now = Date.now()) {
  const at = pilot?.candidatesObservedAt;
  if (at === null)
    return 'Targets: not observed. Status reads do not observe Twitch; use Set up channel to request an observation.';
  if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(now) || now < at)
    return 'Saved target-observation age unavailable; status read age is not provider freshness.';
  return `Saved target observation: ${Math.floor((now - at) / 1000)} s ago; not a fresh Twitch check or a readiness guarantee.`;
}

// One reason and zero or one navigation fix per light; links reveal existing controls only.
export function readinessLights(pilot, actions = []) {
  if (!pilot) return Object.fromEntries(['bot', 'subscriptions', 'live'].map((key) => [key, {
    state: 'unknown',
    reason: 'Sign in first; channel status has not been checked.',
    fix: 'reconnect',
    label: 'Connect Twitch',
  }]));
  const setupFix = actions.includes('bootstrap') ? 'first-bootstrap' : null;
  return {
    bot: pilot.botGrantStored === true
      ? { state: 'ready', reason: 'Saved bot grant connected; moderator role is not verified here.', fix: null }
      : { state: 'unknown', reason: 'No saved bot grant; ask the owner to connect raidrelicbot.', fix: null },
    subscriptions: pilot.subscriptions?.ready === true
      ? { state: 'ready', reason: 'All five subscriptions enabled at the last setup.', fix: null }
      : { state: 'unknown', reason: 'Five enabled subscriptions are not yet confirmed.', fix: setupFix, label: 'Review subscription setup' },
    live: pilot.online === true
      ? { state: 'ready', reason: 'Stream observed live; Send Off rechecks eligibility.', fix: null }
      : { state: 'offline', reason: 'Stream is offline or not yet observed live; Send Off requires a live stream.', fix: setupFix, label: 'Check stream after going live' },
  };
}
export function actionMessage(value, targetLogin) {
  if (value?.authorization === 'ready')
    return 'Your Keeper authorization is ready. Refresh status to check current targets; ordinary status reads never renew tokens.';
  if (value?.authorization === 'retry-later')
    return 'Authorization is temporarily unavailable. Retry later; this does not establish a need for new consent. No raid or bootstrap was performed.';
  if (value?.authorization === 'needs-reconnect')
    return 'Your Keeper authorization could not be renewed. Reconnect only this matching Keeper using the canonical app login link; no raid or bootstrap was performed.';
  const target =
    keeperNames[value?.diagnostic?.targetId] ??
    (Object.values(keeperNames).includes(targetLogin) ? targetLogin : 'The target');
  const category = value?.diagnostic?.category;
  const diagnostic = {
    'incoming-raid-policy': `${target} raid settings block this raider: check Raid Settings minimum account age/viewers. The owner must review these settings.`,
    'source-grant':
      'Reconnect this source Keeper. Twitch could not authorize this raid; check the account and raid permission.',
    'rate-limited':
      'Twitch asked us to wait. Check the saved reset time and native raid state before a new request.',
    'pending-native-raid':
      'A native Twitch raid is already pending. Stop; do not Send Off or Process again.',
    'unknown-reconcile-only':
      'The raid outcome is unknown. Stop for operator review; never blindly repeat it.',
    'provider-forbidden':
      'Twitch refused the request. The owner needs to review the saved private diagnostic.',
    'target-not-found': 'Twitch could not find this target channel. Review the configured account.',
    'native-state-review':
      'Twitch rejected the request. Review the saved diagnostic and native raid state.',
  };
  if (value?.status === 'accepted')
    return 'Raid accepted. Watch the claim meter: if your offer is not counted yet, send !offer after the raid lands. Binding needs both chats and a verified arrival.';
  if (diagnostic[category]) return diagnostic[category];
  if (value?.status === 'unknown') return diagnostic['unknown-reconcile-only'];
  if (value?.status === 'reconciled')
    return value.ready
      ? 'Channel reconciled. All five subscriptions are enabled. Refresh the source after reconciling both Keepers.'
      : 'Channel setup is waiting for Twitch callbacks. Reconcile again explicitly once they are enabled.';
  if (value?.status === 'busy') return 'Setup is already in progress. Wait, then refresh status.';
  if (value?.status === 'processed') return 'Keeper choice saved. Refresh shows the current state.';
  if (value?.status === 'expired-handoff')
    return 'The ended ritual is retired. The relic has not moved and no Twitch raid was cancelled.';
  if (value?.status === 'cancelled-queued')
    return 'The never-dispatched queue was cancelled. No Twitch raid was cancelled.';
  if (value?.status === 'blocked') {
    const reasons = {
      'subscriptions-not-ready': 'Reconcile both Keepers until both readiness lights are ready.',
      'grants-unavailable': 'Reconnect the affected Keeper or bot account before sending.',
      'source-offline': 'The source stream must be live. Start it, then reconcile.',
      'target-offline':
        'The target stream must be live. Ask the owner to start it, then reconcile.',
      'not-holder': 'Only the current relic Keeper can Send Off.',
      'existing-intent':
        'There is an existing Send Off. Refresh and review it; never repeat accepted or unknown requests.',
      'intent-reconcile-only': 'This Send Off cannot be retried. Stop for operator review.',
    };
    return (
      reasons[value.reason] ??
      'Send Off is blocked. Refresh both Keepers and review the current state before any new request.'
    );
  }
  return 'The request did not complete. Refresh and review the current state; never blindly repeat a raid request.';
}

// Only trusted server configuration; HTTP is exclusively a local Simulator convenience.
export function botConsentStartURL(value, mode, pageOrigin) {
  try {
    const u = new URL(value);
    const https =
      u.protocol === 'https:' &&
      (u.origin === 'https://raid-relic-760724762396.us-central1.run.app' ||
        u.origin === pageOrigin);
    const local =
      mode === 'simulator' &&
      u.protocol === 'http:' &&
      u.origin === pageOrigin &&
      u.port === '5191' &&
      ['127.0.0.1', 'localhost'].includes(u.hostname);
    return (https || local) &&
      !u.username &&
      !u.password &&
      !u.hash &&
      u.pathname === '/oauth/bot/start' &&
      u.search === '?features=p7'
      ? u.href
      : null;
  } catch {
    return null;
  }
}

// Only a user-started setup flow may repeat the existing idempotent reconcile.
// It cannot retry a raid, failed/unknown request, or continue after hide/deadline.
export function setupRetryAllowed(
  value,
  { remaining, deadline, now = Date.now(), visible = true } = {},
) {
  return (
    visible === true &&
    Number.isInteger(remaining) &&
    remaining > 0 &&
    remaining <= 2 &&
    Number.isFinite(deadline) &&
    Number.isFinite(now) &&
    now < deadline &&
    deadline - now <= 45000 &&
    (value?.status === 'busy' || (value?.status === 'reconciled' && value.ready === false))
  );
}
