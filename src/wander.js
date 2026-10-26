import { hash } from './crypto.js';
import { boundedCall } from './bounded.js';
import { wanderKey, wanderMembers } from './wander-state.js';
import { verifyWanderRequest } from './wander-auth.js';
import { RECEIVING_KEEPERS } from './receiving.js';
export function createWander({
  policy,
  key,
  state,
  oauth,
  bots,
  botId,
  clientId,
  transport,
  now = Date.now,
  keepers = RECEIVING_KEEPERS,
}) {
  let running = false;
  const config = { channels: Object.keys(keepers) };
  async function proof(input) {
    const at = now(),
      source = input.registry.holderId,
      deadline = performance.now() + 30000;
    const guard = () => {
      if (performance.now() > deadline || now() < at || now() - at > 30000)
        throw Error('Proof expired');
    };
    guard();
    const token = await oauth.accessTokenForP7(); // existing consent only; normal rotation permitted on this trusted tick.
    const headers = { Authorization: `Bearer ${token}`, 'Client-Id': clientId };
    const grants = new Set();
    for (const id of config.channels) {
      guard();
      try {
        await oauth.accessTokenForKeeper(id);
        guard();
        grants.add(id);
      } catch {
        /* No automatic consent or scope fallback. */
      }
    }
    const mods = new Set(),
      cursors = new Set();
    let after;
    for (let page = 0; page < 3; page++) {
      const q = new URLSearchParams({ user_id: botId, first: '100' });
      if (after) q.set('after', after);
      const r = await boundedCall((signal) =>
        transport('https://api.twitch.tv/helix/moderation/channels?' + q, { headers, signal }),
      );
      if (
        r.status !== 200 ||
        !Array.isArray(r.data?.data) ||
        r.data.data.length > 100 ||
        !r.data.pagination
      )
        throw Error('Capability unavailable');
      for (const row of r.data.data)
        if (config.channels.includes(row.broadcaster_id)) mods.add(row.broadcaster_id);
      after = r.data.pagination.cursor;
      if (!after) break;
      if (typeof after !== 'string' || after.length > 512 || cursors.has(after) || page === 2)
        throw Error('Capability capacity');
      cursors.add(after);
    }
    guard();
    const q = new URLSearchParams(config.channels.map((id) => ['user_id', id]));
    const r = await boundedCall((signal) =>
      transport('https://api.twitch.tv/helix/streams?' + q, { headers, signal }),
    );
    if (
      r.status !== 200 ||
      !Array.isArray(r.data?.data) ||
      r.data.data.length > config.channels.length
    )
      throw Error('Stream unavailable');
    const streams = new Map();
    for (const s of r.data.data) {
      if (
        !config.channels.includes(s.user_id) ||
        streams.has(s.user_id) ||
        s.type !== 'live' ||
        !/^\d{1,128}$/.test(s.id) ||
        !Number.isInteger(s.viewer_count) ||
        s.viewer_count < 0 ||
        s.viewer_count > 1000000
      )
        throw Error('Stream invalid');
      streams.set(s.user_id, s);
    }
    const candidates = wanderMembers(input, config)
      .filter((id) => grants.has(id) && mods.has(id))
      .flatMap((id) => {
        const s = streams.get(id),
          channel = input.channels[id];
        if (s && channel.online && s.id === channel.streamId)
          return [{ id, live: true, viewers: s.viewer_count, streamId: s.id }];
        return !s && !channel.online ? [{ id, live: false, viewers: 0 }] : [];
      });
    guard();
    return { at, source, sourceValid: grants.has(source) && mods.has(source), candidates };
  }
  async function deliver() {
    const input = await state.getWanderInput();
    for (const row of input?.registry.wander?.rows ?? []) {
      if (row.status !== 'queued') continue;
      // Grant/capability validation happened before commit; repeat principal
      // validation before this separate at-most-once message boundary.
      try {
        await oauth.accessTokenForP7();
        await oauth.accessTokenForKeeper(row.host);
      } catch {
        continue;
      }
      const claimed = await state.wanderStep({ type: 'claim-message', key: row.key }, now());
      if (claimed.status !== 'message') continue;
      const message =
        row.kind === 'warning'
          ? 'The relic has been idle. It may wander to an opted-in Keeper after the warning period. Add an approved mark or start a valid Send Off to keep playing.'
          : `The relic wandered here to @${keepers[row.host]}; no raid or audience transfer occurred. Leave !mark word to add a community rune.`;
      let accepted = false;
      try {
        const sent = await bots[row.host].sendChat(message, { retryUnauthorized: false });
        accepted = typeof sent?.messageId === 'string';
      } catch {
        /* Unknown after dispatch is never retried. */
      }
      await state.wanderStep({ type: 'finish-message', key: row.key, accepted }, now());
    }
  }
  return {
    enabled: policy.enabled,
    policy: { idleHours: policy.idleHours, warningHours: policy.warningHours },
    verify(raw, signature) {
      try {
        return policy.enabled ? verifyWanderRequest(key, raw, signature, now()) : null;
      } catch {
        return null;
      }
    },
    async tick(request) {
      if (!policy.enabled) return { status: 'disabled' };
      if (running) return { status: 'busy' };
      running = true;
      try {
        const prepared = await state.wanderStep(
          { type: 'prepare', nonce: hash(request.nonce) },
          now(),
        );
        if (prepared.status !== 'needs-work') return prepared;
        const input = await state.getWanderInput(),
          expected = wanderKey(input);
        let evidence;
        try {
          evidence = await proof(input);
        } catch {
          return { status: 'capability-unavailable' };
        }
        const result = await state.wanderStep(
          { type: 'commit', nonce: hash(request.nonce), expected, proof: evidence },
          now(),
        );
        // Synchronous awaited work, never a post-response worker or timer.
        await deliver();
        return result;
      } catch {
        return { status: 'unavailable' };
      } finally {
        running = false;
      }
    },
  };
}
