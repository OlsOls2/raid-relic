// Closed-vocabulary UI; never render upstream bodies, arbitrary messages or JSON.
export const keeperNames = Object.freeze({ '1591805230': 'raidrelichq', '1591806023': 'olsols2' });
export function actionMessage(value, targetLogin) {
  const target = keeperNames[value?.diagnostic?.targetId] ?? (Object.values(keeperNames).includes(targetLogin) ? targetLogin : 'The target');
  const category = value?.diagnostic?.category;
  const diagnostic = {
    'incoming-raid-policy': `${target} raid settings block this raider: check Raid Settings minimum account age/viewers. The owner must review these settings.`,
    'source-grant': 'Reconnect this source Keeper. Twitch could not authorize this raid; check the account and raid permission.',
    'rate-limited': 'Twitch asked us to wait. Check the saved reset time and native raid state before a new request.',
    'pending-native-raid': 'A native Twitch raid is already pending. Stop; do not Send Off or Process again.',
    'unknown-reconcile-only': 'The raid outcome is unknown. Stop for operator review; never blindly repeat it.',
    'provider-forbidden': 'Twitch refused the request. The owner needs to review the saved private diagnostic.',
    'target-not-found': 'Twitch could not find this target channel. Review the configured account.',
    'native-state-review': 'Twitch rejected the request. Review the saved diagnostic and native raid state.',
  };
  if (value?.status === 'accepted') return 'Send Off accepted. Complete the native Twitch raid; both chats can gather now. The relic moves only after Twitch confirms the raid and both chats bind it.';
  if (diagnostic[category]) return diagnostic[category];
  if (value?.status === 'unknown') return diagnostic['unknown-reconcile-only'];
  if (value?.status === 'reconciled') return value.ready ? 'Channel reconciled. All five subscriptions are enabled. Refresh the source after reconciling both Keepers.' : 'Channel setup is waiting for Twitch callbacks. Reconcile again explicitly once they are enabled.';
  if (value?.status === 'busy') return 'Setup is already in progress. Wait, then refresh status.';
  if (value?.status === 'processed') return 'Keeper choice saved. Refresh shows the current state.';
  if (value?.status === 'expired-handoff') return 'The ended ritual is retired. The relic has not moved and no Twitch raid was cancelled.';
  if (value?.status === 'cancelled-queued') return 'The never-dispatched queue was cancelled. No Twitch raid was cancelled.';
  if (value?.status === 'blocked') {
    const reasons = {
      'subscriptions-not-ready':'Reconcile both Keepers until both readiness lights are ready.',
      'grants-unavailable':'Reconnect the affected Keeper or bot account before sending.',
      'source-offline':'The source stream must be live. Start it, then reconcile.',
      'target-offline':'The target stream must be live. Ask the owner to start it, then reconcile.',
      'not-holder':'Only the current relic Keeper can Send Off.',
      'existing-intent':'There is an existing Send Off. Refresh and review it; never repeat accepted or unknown requests.',
      'intent-reconcile-only':'This Send Off cannot be retried. Stop for operator review.',
    };
    return reasons[value.reason] ?? 'Send Off is blocked. Refresh both Keepers and review the current state before any new request.';
  }
  return 'The request did not complete. Refresh and review the current state; never blindly repeat a raid request.';
}
