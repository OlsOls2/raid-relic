import { boundedCall } from './bounded.js';
import { reservationReason } from './send-state.js';
import { subscriptionFailureDiagnostic } from './subscriptions.js';
import { randomBytes } from 'node:crypto';
import { hash } from './crypto.js';
import { parseLifecycle } from './lifecycle.js';
import { handoffView } from './public-view.js';
import { httpTransport } from './oauth.js';

export const KEEPERS = Object.freeze({ 1591805230: 'raidrelichq', 1591806023: 'olsols2' });
export function createPilot({
  keepers = KEEPERS,
  streamerId = '1591805230',
  receiving,
  p7,
  replies,
  forge,
  chronicle,
  state,
  store,
  oauth,
  subscriptions,
  sends,
  now = Date.now,
  simulator = false,
  clientId,
  transport = httpTransport,
  logger = (line) => console.warn(line),
}) {
  const ids = Object.keys(keepers);
  const actions = (id) => [
    ...(chronicle ? ['chronicle'] : []),
    ...(receiving?.enabled ? ['seek-on', 'seek-off', 'seek-status'] : []),
    'bootstrap',
    'refresh-authorization',
    'keep',
    'pause',
    'resume',
    'opt-out',
    'process',
    ...(replies ? ['mark-links'] : []),
    ...ids.filter((other) => other !== id).map((other) => `send:${other}`),
  ];
  async function mutate(id, action) {
    const time = now();
    return state.accept({
      id: `owner:${randomBytes(24).toString('hex')}`,
      now: time,
      sentAt: time,
      expiresAt: time + 600000,
      chat: { broadcasterId: id, chatterId: id, markAction: action },
    });
  }
  async function blocked(id, reason, diagnostic) {
    try {
      await logger(
        JSON.stringify({
          severity: 'WARNING',
          event: 'raid_relic_send_blocked',
          keeperId: id,
          reason,
        }),
      );
    } catch {}
    return {
      status: 'blocked',
      reason,
      ...(diagnostic ? { diagnostic } : {}),
      message:
        (diagnostic?.nextStep ? diagnostic.nextStep + ' ' : '') +
        'Send Off blocked: ' +
        reason +
        '. Refresh both channel statuses; do not retry accepted/unknown dispatches.',
    };
  }
  async function readiness(id, other = ids.find((candidate) => candidate !== id)) {
    if (!ids.includes(id) || !ids.includes(other) || id === other)
      throw Error('Both channels must be configured');
    if ((await store.getJob(id))?.ready !== true || (await store.getJob(other))?.ready !== true)
      throw new Error(
        'Both channels need five enabled subscriptions; Bootstrap / reconcile each channel again after callbacks verify',
      );
    try {
      await oauth.accessTokenForKeeper(id);
      await oauth.accessTokenForKeeper(other);
      await oauth.accessToken('bot');
    } catch {
      throw new Error(
        'Both Keeper grants and bot grant required; reconnect the affected account and reconcile',
      );
    }
  }
  async function eligibility(id) {
    const channels = {},
      marks = {};
    for (const key of ids) {
      channels[key] = await state.getStreamStatus(key);
      marks[key] = await state.getPrivateMarks(key, { broadcasterId: key, chatterId: key });
    }
    const awaitRegistry = await state.getKeeperRegistry();
    const reasons = ids
      .filter((key) => key !== id)
      .map((target) =>
        reservationReason(
          awaitRegistry,
          channels,
          marks,
          { channels: ids, logins: Object.fromEntries(ids.map((key) => [keepers[key], key])) },
          { source: id, actor: id, login: keepers[target], sentAt: now() },
          now(),
        ),
      );
    return {
      eligible: reasons.some((reason) => reason === null),
      reason: reasons.some((reason) => reason === null) ? null : reasons[0],
      observedOnline: Object.fromEntries(
        ids.map((key) => [keepers[key], channels[key]?.online === true]),
      ),
    };
  }
  async function bootstrap(id) {
    const owner = randomBytes(24).toString('hex');
    if (!(await store.acquireJob(id, owner, now()))) return { status: 'busy' };
    // Capture both baseline and observation start before ANY network effects.
    const started = now();
    const baseline = hash(JSON.stringify((await state.getStreamStatus(id)) ?? null));
    let result;
    let stage = 'subscriptions';
    try {
      const reconciled = await subscriptions[id].reconcile({ readiness: true });
      stage = 'ban-capability';
      const banGranted = oauth.hasBanGrant ? await oauth.hasBanGrant(id) : false;
      stage = 'keeper-grant';
      const token = await oauth.accessTokenForKeeper(id);
      stage = 'stream-observation';
      const response = await boundedCall((signal) =>
        transport(`https://api.twitch.tv/helix/streams?user_id=${id}`, {
          signal,
          headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId },
        }),
      );
      if (
        response.status !== 200 ||
        !Array.isArray(response.data?.data) ||
        response.data.data.length > 1
      )
        throw new Error('Stream observation failed');
      const stream = response.data.data[0];
      let event;
      if (!stream) event = { host: id, type: 'offline', sentAt: started };
      else {
        if (stream.user_id !== id) throw new Error('Stream account mismatch');
        event = parseLifecycle(
          {
            subscription: {
              type: 'stream.online',
              version: '1',
              condition: { broadcaster_user_id: id },
            },
            event: {
              broadcaster_user_id: id,
              id: stream.id,
              type: stream.type,
              started_at: stream.started_at,
            },
          },
          id,
          started,
        );
      }
      event.provenance = 'helix-observation';
      stage = 'observation-commit';
      const observation = await state.accept({
        id: `observation:${owner}`,
        now: now(),
        sentAt: started,
        expiresAt: now() + 600000,
        observation: { baseline, event },
      });
      result = {
        status: 'reconciled',
        subscriptions: reconciled.results,
        conditions: reconciled.conditions,
        ready: reconciled.ready,
        observation,
        banCapability: banGranted
          ? { scope: 'channel:moderate', expiresAt: started + 300000 }
          : null,
      };
    } catch (error) {
      result = {
        status: 'failed',
        ready: false,
        message: 'Bootstrap failed; review grants and retry explicitly',
        diagnostic: subscriptionFailureDiagnostic(error) ?? { stage },
      };
      // One JSON warning per failed explicit attempt. Never reflect an error,
      // upstream body, request URL/header or token. Logging cannot fail the job.
      try {
        await logger(
          JSON.stringify({
            severity: 'WARNING',
            event: 'raid_relic_bootstrap_failed',
            keeperId: id,
            diagnostic: result.diagnostic,
          }),
        );
      } catch {
        /* Preserve bootstrap outcome. */
      }
    }
    await store.finishJob(id, owner, result);
    // Only an explicitly authenticated Setup action may refresh provider observations.
    if (result.status === 'reconciled' && receiving?.enabled) {
      try {
        await boundedCall(() => receiving.candidates(id));
      } catch {
        /* Status stays unknown; no implicit retry. */
      }
    }
    return result;
  }
  async function retireEnded(id) {
    let registry = await state.getKeeperRegistry();
    if (
      registry.holderId === id &&
      registry.send?.sourceId === id &&
      registry.send.status === 'confirmed' &&
      registry.pendingHop &&
      !registry.pendingHop.finalized &&
      now() >= registry.pendingHop.endsAt
    ) {
      await state.sendOffStep(
        {
          type: 'reconcile-ended',
          source: id,
          actor: id,
          id: registry.send.id,
          generation: registry.send.generation,
          hopId: registry.pendingHop.eventId,
        },
        now(),
      );
      registry = await state.getKeeperRegistry();
    }
    return registry;
  }
  return {
    forgeEnabled: forge?.enabled === true,
    async forgeDesign(id, description, acknowledge) {
      if (!ids.includes(id) || !forge) throw Error('Unavailable');
      return forge.write(id, description, acknowledge);
    },
    async expireHandoff(id, intentId, hopId) {
      if (
        !ids.includes(id) ||
        !/^[a-f0-9]{64}$/.test(intentId ?? '') ||
        !/^[a-f0-9]{64}$/.test(hopId ?? '')
      )
        return { status: 'blocked', reason: 'handoff-expiry-proof' };
      return state.sendOffStep(
        { type: 'expire-handoff', source: id, actor: id, id: intentId, hopId },
        now(),
      );
    },
    actions,
    async authorizeSend(source, target) {
      await readiness(source, target);
      if (target) await receiving?.authorize(source, target);
    },
    async cancelQueued(id, intentId, generation) {
      if (
        !ids.includes(id) ||
        !/^[a-f0-9]{64}$/.test(intentId ?? '') ||
        !/^[a-f0-9]{64}$/.test(generation ?? '')
      )
        throw Error('Invalid intent confirmation');
      return (
        (await state.sendOffStep(
          { type: 'cancel-queued', source: id, actor: id, id: intentId, generation },
          now(),
        )) ?? {
          status: 'blocked',
          message:
            'Only the exact never-claimed queued intent can be cancelled. Stop for operator review.',
        }
      );
    },
    async execute(id, action) {
      if (!ids.includes(id) || !actions(id).includes(action)) throw new Error('Action unavailable');
      if (action === 'refresh-authorization') {
        try {
          await oauth.accessTokenForKeeper(id);
          return { status: 'processed', authorization: 'ready' };
        } catch (error) {
          return {
            status: 'processed',
            authorization: ['reconsent-required', 'authorization-required'].includes(error?.code)
              ? 'needs-reconnect'
              : 'retry-later',
          };
        }
      }
      if (action === 'seek-status') {
        const seekerStatus = await receiving.status(id);
        return { status: 'processed', seeking: seekerStatus.member, seekerStatus };
      }
      if (action === 'chronicle') return chronicle.write(id);
      if (action === 'mark-links') return replies.processPending(id);
      if (action === 'bootstrap') return bootstrap(id);
      if (action === 'process' || action.startsWith('send:')) {
        try {
          // Reserve already retires an ended confirmed window atomically with
          // its fresh request. A separate retirement at this same clock would
          // correctly fence the following request as stale. Process has no reserve.
          if (action === 'process') await retireEnded(id);
          let intentId;
          if (action === 'process') {
            const intent = (await state.getKeeperRegistry()).send;
            if (!intent || intent.sourceId !== id) return blocked(id, 'no-own-queued-intent');
            if (!['queued', 'preflight'].includes(intent.status))
              return blocked(id, 'intent-reconcile-only');
            intentId = intent.id;
          }
          try {
            const selected = action.startsWith('send:')
              ? action.slice(5)
              : (await state.getKeeperRegistry()).send?.targetId;
            await readiness(id, selected);
          } catch (error) {
            return blocked(
              id,
              error.message.startsWith('Both channels')
                ? 'subscriptions-not-ready'
                : 'grants-unavailable',
            );
          }
          if (action.startsWith('send:')) {
            const target = action.slice(5);
            const reserved = await mutate(id, { type: 'send', login: keepers[target] });
            if (reserved?.status !== 'reserved')
              return blocked(id, reserved?.reason ?? 'reservation-unavailable');
            intentId = reserved.intentId;
          }
          const outcome = await sends[id].processPending(intentId);
          if (outcome.status !== 'accepted')
            return blocked(
              id,
              outcome.status === 'unknown'
                ? 'dispatch-unknown'
                : outcome.status === 'rejected-preflight'
                  ? 'preflight-rejected'
                  : outcome.status === 'rejected'
                    ? 'dispatch-rejected'
                    : 'worker-reconcile-only',
              outcome.diagnostic,
            );
          return outcome;
        } catch {
          return blocked(id, 'request-outcome-unavailable');
        }
      }
      await mutate(
        id,
        action === 'pause' || action === 'resume'
          ? { type: 'pause', paused: action === 'pause' }
          : { type: action },
      );
      return { status: 'processed', action };
    },
    async status(id) {
      if (!ids.includes(id)) throw new Error('Unconfigured Keeper');
      const channel = await state.getStreamStatus(id);
      const registry = await state.getKeeperRegistry();
      const authorization = 'not-checked';
      return {
        authorization,
        optionalBotActions: p7?.status() ?? { enabled: false, reason: 'disabled' },
        chronicle: chronicle?.enabled
          ? 'Paid generation enabled: one attempt per received stop; fiction only.'
          : 'Off: handwritten template fiction; no model calls.',
        seekers: receiving?.enabled
          ? {
              enabled: true,
              joined:
                (await state.getReceivingView(now())).queueStates?.[keepers[id]]?.member === true,
            }
          : { enabled: false, joined: false },
        candidates: receiving
          ? await receiving.candidates(id, { cachedOnly: true })
          : await state.getKeeperCandidates(id),
        candidatesObservedAt: receiving?.observedAt?.() ?? null,
        statusReadAt: now(),
        mode: simulator ? 'simulator' : 'live',
        account: keepers[id],
        online: channel?.online ?? false,
        optedIn: channel?.optedIn ?? false,
        paused: channel?.paused ?? false,
        botGrantStored: Boolean(await store.getToken('bot')),
        bothReadiness: Object.fromEntries(
          await Promise.all(
            ids.map(async (keeper) => [
              keepers[keeper],
              (await store.getJob(keeper))?.ready === true,
            ]),
          ),
        ),
        ownerStep:
          'Status shows cached subscription/lifecycle readiness, not fresh Keeper authorization. If targets are missing, use Check / refresh my Keeper authorization; reconnect this matching Keeper if it fails.',
        recovery:
          registry.send?.sourceId === id
            ? {
                intentId: registry.send.id,
                generation: registry.send.generation ?? null,
                status: registry.send.status,
                dispatchMarked: Object.hasOwn(registry.send, 'dispatchAt'),
                claimed:
                  Object.hasOwn(registry.send, 'owner') ||
                  Object.hasOwn(registry.send, 'leaseUntil'),
                canCancel:
                  registry.holderId === id &&
                  typeof registry.send.generation === 'string' &&
                  registry.send.status === 'queued' &&
                  !Object.hasOwn(registry.send, 'dispatchAt') &&
                  !Object.hasOwn(registry.send, 'owner') &&
                  !Object.hasOwn(registry.send, 'leaseUntil'),
                instruction:
                  'Never clear or retry accepted/unknown/claimed/processing outcomes. Operator read-only reconciliation only.',
              }
            : null,
        eligibility: await eligibility(id),
        claimProgress:
          registry.pendingHop && [registry.pendingHop.from, registry.pendingHop.to].includes(id)
            ? {
                provisional:
                  registry.pendingHop.policy === 'preclaim-v1' && !registry.pendingHop.verified,
                verified: registry.pendingHop.verified === true,
                claimStartedAt: registry.pendingHop.claimStartedAt ?? registry.pendingHop.startedAt,
                threshold: registry.pendingHop.threshold,
                offers: registry.pendingHop.offers?.length ?? null,
                accepts: registry.pendingHop.accepts?.length ?? null,
                endsAt: registry.pendingHop.endsAt,
                finalized: registry.pendingHop.finalized === true,
                cancelled: registry.pendingHop.cancelled === true,
              }
            : null,
        expiryRecovery:
          registry.send?.sourceId === id &&
          registry.holderId === id &&
          registry.send.status === 'confirmed' &&
          registry.pendingHop &&
          !registry.pendingHop.finalized
            ? {
                intentId: registry.send.id,
                hopId: registry.pendingHop.eventId,
                endsAt: registry.pendingHop.endsAt,
                canExpire: now() >= registry.pendingHop.endsAt,
              }
            : null,
        dispatchDiagnostic:
          registry.send?.sourceId === id ? (registry.send.diagnostic ?? null) : null,
        holder: registry.holderId,
        subscriptions: await store.getJob(id),
        intent: registry.send?.sourceId === id ? registry.send.status : null,
        handoff: handoffView(registry, id, now(), undefined, keepers),
      };
    },
  };
}
