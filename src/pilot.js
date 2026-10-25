import { subscriptionFailureDiagnostic } from './subscriptions.js';
import { randomBytes } from 'node:crypto';
import { hash } from './crypto.js';
import { parseLifecycle } from './lifecycle.js';
import { handoffView } from './public-view.js';
import { httpTransport } from './oauth.js';

export const KEEPERS = Object.freeze({ '1591805230': 'raidrelichq', '1591806023': 'olsols2' });
export function createPilot({ replies, forge, chronicle, state, store, oauth, subscriptions, sends, now = Date.now, simulator = false, clientId, transport = httpTransport, logger = line => console.warn(line) }) {
  const ids = Object.keys(KEEPERS);
  const actions = id => [...(chronicle ? ['chronicle'] : []), 'bootstrap', 'keep', 'pause', 'resume', 'opt-out', 'process', ...(replies ? ['mark-links'] : []), `send:${ids.find(other => other !== id)}`];
  async function mutate(id, action) {
    const time = now();
    return state.accept({ id: `owner:${randomBytes(24).toString('hex')}`, now: time, sentAt: time, expiresAt: time + 600000,
      chat: { broadcasterId: id, chatterId: id, markAction: action } });
  }
  async function readiness(id) {
    const other = ids.find(candidate => candidate !== id);
    if ((await store.getJob(id))?.ready !== true || (await store.getJob(other))?.ready !== true)
      throw new Error('Both channels need five enabled subscriptions; Bootstrap / reconcile each channel again after callbacks verify');
    try { await oauth.accessTokenForKeeper(id); await oauth.accessTokenForKeeper(other); await oauth.accessToken('bot'); }
    catch { throw new Error('Both Keeper grants and bot grant required; reconnect the affected account and reconcile'); }
  }
  async function bootstrap(id) {
    const owner = randomBytes(24).toString('hex');
    if (!await store.acquireJob(id, owner, now())) return { status: 'busy' };
    // Capture both baseline and observation start before ANY network effects.
    const started = now(); const baseline = hash(JSON.stringify(await state.getStreamStatus(id) ?? null));
    let result; let stage = 'subscriptions';
    try {
      const reconciled = await subscriptions[id].reconcile({ readiness: true });
      stage = 'ban-capability';
      const banGranted = oauth.hasBanGrant ? await oauth.hasBanGrant(id) : false;
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
      result = { status: 'reconciled', subscriptions: reconciled.results, conditions: reconciled.conditions, ready: reconciled.ready, observation, banCapability: banGranted ? { scope: 'channel:moderate', expiresAt: started + 300000 } : null };
    } catch (error) {
      result = { status: 'failed', ready: false, message: 'Bootstrap failed; review grants and retry explicitly', diagnostic: subscriptionFailureDiagnostic(error) ?? { stage } };
      // One JSON warning per failed explicit attempt. Never reflect an error,
      // upstream body, request URL/header or token. Logging cannot fail the job.
      try { await logger(JSON.stringify({ severity: 'WARNING', event: 'raid_relic_bootstrap_failed', keeperId: id, diagnostic: result.diagnostic })); } catch { /* Preserve bootstrap outcome. */ }
    }
    await store.finishJob(id, owner, result); return result;
  }
  return {
    forgeEnabled: forge?.enabled === true,
    async forgeDesign(id, description, acknowledge) { if (!ids.includes(id) || !forge) throw Error('Unavailable'); return forge.write(id, description, acknowledge); },
    actions, authorizeSend: readiness,
    async cancelQueued(id, intentId, generation) {
      if (!ids.includes(id) || !/^[a-f0-9]{64}$/.test(intentId ?? '') || !/^[a-f0-9]{64}$/.test(generation ?? '')) throw Error('Invalid intent confirmation');
      return await state.sendOffStep({ type: 'cancel-queued', source: id, actor: id, id: intentId, generation }, now()) ?? { status: 'blocked', message: 'Only the exact never-claimed queued intent can be cancelled. Stop for operator review.' };
    },
    async execute(id, action) {
      if (!ids.includes(id) || !actions(id).includes(action)) throw new Error('Action unavailable');
      if (action === 'chronicle') return chronicle.write(id);
      if (action === 'mark-links') return replies.processPending(id);
      if (action === 'bootstrap') return bootstrap(id);
      if (action === 'process') {
        const intent = (await state.getKeeperRegistry()).send;
        if (intent?.sourceId === id && ['queued', 'preflight'].includes(intent.status)) { try { await readiness(id); } catch (error) { return { status: 'blocked', message: error.message }; } }
        return sends[id].processPending();
      }
      if (action.startsWith('send:')) {
        const target = action.slice(5);
        try { await readiness(id); } catch (error) { return { status: 'blocked', message: error.message }; }
        await mutate(id, { type: 'send', login: KEEPERS[target] });
        // The HTTP request awaits the worker; never detached/post-response CPU.
        return sends[id].processPending();
      }
      await mutate(id, action === 'pause' || action === 'resume' ? { type: 'pause', paused: action === 'pause' } : { type: action });
      return { status: 'processed', action };
    },
    async status(id) {
      if (!ids.includes(id)) throw new Error('Unconfigured Keeper');
      const channel = await state.getStreamStatus(id); const registry = await state.getKeeperRegistry();
      return { chronicle: chronicle?.enabled ? 'Paid generation enabled: one attempt per received stop; fiction only.' : 'Off: handwritten template fiction; no model calls.', candidates: await state.getKeeperCandidates(id), candidatesObservedAt: now(), mode: simulator ? 'simulator' : 'live', account: KEEPERS[id], online: channel?.online ?? false, optedIn: channel?.optedIn ?? false, paused: channel?.paused ?? false,
        bothReadiness: Object.fromEntries(await Promise.all(ids.map(async keeper => [KEEPERS[keeper], (await store.getJob(keeper))?.ready === true]))),
        ownerStep: 'Wait for both readiness flags true; Bootstrap / reconcile pending channels after callback verification. Reconnect missing grants.',
        recovery: registry.send?.sourceId === id ? { intentId: registry.send.id, generation: registry.send.generation ?? null, status: registry.send.status, dispatchMarked: Object.hasOwn(registry.send, 'dispatchAt'), claimed: Object.hasOwn(registry.send, 'owner') || Object.hasOwn(registry.send, 'leaseUntil'), canCancel: registry.holderId === id && typeof registry.send.generation === 'string' && registry.send.status === 'queued' && !Object.hasOwn(registry.send, 'dispatchAt') && !Object.hasOwn(registry.send, 'owner') && !Object.hasOwn(registry.send, 'leaseUntil'), instruction: 'Never clear or retry accepted/unknown/claimed/processing outcomes. Operator read-only reconciliation only.' } : null,
        holder: registry.holderId, subscriptions: await store.getJob(id), intent: registry.send?.sourceId === id ? registry.send.status : null,
        handoff: handoffView(registry, id, now()) };
    },
  };
}
