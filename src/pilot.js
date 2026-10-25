import { reservationReason } from './send-state.js';
import { subscriptionFailureDiagnostic } from './subscriptions.js';
import { randomBytes } from 'node:crypto';
import { hash } from './crypto.js';
import { parseLifecycle } from './lifecycle.js';
import { handoffView } from './public-view.js';
import { httpTransport } from './oauth.js';

export const KEEPERS = Object.freeze({ '1591805230': 'raidrelichq', '1591806023': 'olsols2' });
export function createPilot({ state, store, oauth, subscriptions, sends, now = Date.now, simulator = false, clientId, transport = httpTransport, logger = line => console.warn(line) }) {
  const ids = Object.keys(KEEPERS);
  const actions = id => ['bootstrap', 'keep', 'pause', 'resume', 'opt-out', 'process', `send:${ids.find(other => other !== id)}`];
  async function mutate(id, action) {
    const time = now();
    return state.accept({ id: `owner:${randomBytes(24).toString('hex')}`, now: time, sentAt: time, expiresAt: time + 600000,
      chat: { broadcasterId: id, chatterId: id, markAction: action } });
  }
  async function blocked(id, reason, diagnostic) {
    try { await logger(JSON.stringify({ severity: 'WARNING', event: 'raid_relic_send_blocked', keeperId: id, reason })); } catch {}
    return { status: 'blocked', reason, ...(diagnostic ? { diagnostic } : {}), message: 'Send Off blocked: ' + reason + '. Refresh both channel statuses; do not retry accepted/unknown dispatches.' };
  }
  async function readiness(id) {
    const other = ids.find(candidate => candidate !== id);
    if ((await store.getJob(id))?.ready !== true || (await store.getJob(other))?.ready !== true)
      throw new Error('Both channels need five enabled subscriptions; Bootstrap / reconcile each channel again after callbacks verify');
    try { await oauth.accessTokenForKeeper(id); await oauth.accessTokenForKeeper(other); await oauth.accessToken('bot'); }
    catch { throw new Error('Both Keeper grants and bot grant required; reconnect the affected account and reconcile'); }
  }
  async function eligibility(id) {
    const channels = {}, marks = {};
    for (const key of ids) { channels[key] = await state.getStreamStatus(key); marks[key] = await state.getPrivateMarks(key, { broadcasterId: key, chatterId: key }); }
    const target = ids.find(key => key !== id);
    const reason = reservationReason(await state.getKeeperRegistry(), channels, marks, { channels: ids, logins: Object.fromEntries(ids.map(key => [KEEPERS[key], key])) }, { source: id, actor: id, login: KEEPERS[target], sentAt: now() }, now());
    return { eligible: reason === null, reason, observedOnline: Object.fromEntries(ids.map(key => [KEEPERS[key], channels[key]?.online === true])) };
  }
  async function bootstrap(id) {
    const owner = randomBytes(24).toString('hex');
    if (!await store.acquireJob(id, owner, now())) return { status: 'busy' };
    // Capture both baseline and observation start before ANY network effects.
    const started = now(); const baseline = hash(JSON.stringify(await state.getStreamStatus(id) ?? null));
    let result; let stage = 'subscriptions';
    try {
      const reconciled = await subscriptions[id].reconcile({ readiness: true });
      stage = 'keeper-grant';
      const token = await oauth.accessTokenForKeeper(id);
      stage = 'stream-observation';
      const response = await transport(`https://api.twitch.tv/helix/streams?user_id=${id}`, { headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId } });
      if (response.status !== 200 || !Array.isArray(response.data?.data) || response.data.data.length > 1) throw new Error('Stream observation failed');
      const stream = response.data.data[0]; let event;
      if (!stream) event = { host: id, type: 'offline', sentAt: started };
      else {
        if (stream.user_id !== id) throw new Error('Stream account mismatch');
        event = parseLifecycle({ subscription: { type: 'stream.online', version: '1', condition: { broadcaster_user_id: id } },
          event: { broadcaster_user_id: id, id: stream.id, type: stream.type, started_at: stream.started_at } }, id, started);
      }
      event.provenance = 'helix-observation';
      stage = 'observation-commit';
      const observation = await state.accept({ id: `observation:${owner}`, now: now(), sentAt: started, expiresAt: now() + 600000, observation: { baseline, event } });
      result = { status: 'reconciled', subscriptions: reconciled.results, conditions: reconciled.conditions, ready: reconciled.ready, observation };
    } catch (error) {
      result = { status: 'failed', ready: false, message: 'Bootstrap failed; review grants and retry explicitly', diagnostic: subscriptionFailureDiagnostic(error) ?? { stage } };
      // One JSON warning per failed explicit attempt. Never reflect an error,
      // upstream body, request URL/header or token. Logging cannot fail the job.
      try { await logger(JSON.stringify({ severity: 'WARNING', event: 'raid_relic_bootstrap_failed', keeperId: id, diagnostic: result.diagnostic })); } catch { /* Preserve bootstrap outcome. */ }
    }
    await store.finishJob(id, owner, result); return result;
  }
  return {
    actions, authorizeSend: readiness,
    async execute(id, action) {
      if (!ids.includes(id) || !actions(id).includes(action)) throw new Error('Action unavailable');
      if (action === 'bootstrap') return bootstrap(id);
      if (action === 'process' || action.startsWith('send:')) {
        try {
          let intentId;
          if (action === 'process') {
            const intent = (await state.getKeeperRegistry()).send;
            if (!intent || intent.sourceId !== id) return blocked(id, 'no-own-queued-intent');
            if (!['queued', 'preflight'].includes(intent.status)) return blocked(id, 'intent-reconcile-only');
            intentId = intent.id;
          }
          try { await readiness(id); } catch (error) { return blocked(id, error.message.startsWith('Both channels') ? 'subscriptions-not-ready' : 'grants-unavailable'); }
          if (action.startsWith('send:')) {
            const target = action.slice(5);
            const reserved = await mutate(id, { type: 'send', login: KEEPERS[target] });
            if (reserved?.status !== 'reserved') return blocked(id, reserved?.reason ?? 'reservation-unavailable');
            intentId = reserved.intentId;
          }
          const outcome = await sends[id].processPending(intentId);
          if (outcome.status !== 'accepted') return blocked(id, outcome.status === 'unknown' ? 'dispatch-unknown' : outcome.status === 'rejected-preflight' ? 'preflight-rejected' : outcome.status === 'rejected' ? 'dispatch-rejected' : 'worker-reconcile-only', outcome.diagnostic);
          return outcome;
        } catch { return blocked(id, 'request-outcome-unavailable'); }
      }
      await mutate(id, action === 'pause' || action === 'resume' ? { type: 'pause', paused: action === 'pause' } : { type: action });
      return { status: 'processed', action };
    },
    async status(id) {
      if (!ids.includes(id)) throw new Error('Unconfigured Keeper');
      const channel = await state.getStreamStatus(id); const registry = await state.getKeeperRegistry();
      return { mode: simulator ? 'simulator' : 'live', account: KEEPERS[id], online: channel?.online ?? false, optedIn: channel?.optedIn ?? false, paused: channel?.paused ?? false,
        bothReadiness: Object.fromEntries(await Promise.all(ids.map(async keeper => [KEEPERS[keeper], (await store.getJob(keeper))?.ready === true]))),
        ownerStep: 'Wait for both readiness flags true; Bootstrap / reconcile pending channels after callback verification. Reconnect missing grants.',
        eligibility: await eligibility(id),
        dispatchDiagnostic: registry.send?.sourceId === id ? registry.send.diagnostic ?? null : null,
        holder: registry.holderId, subscriptions: await store.getJob(id), intent: registry.send?.sourceId === id ? registry.send.status : null,
        handoff: handoffView(registry, id, now()) };
    },
  };
}
