import { boundedCall } from './bounded.js';
import { runeSvg } from './marks.js';

export const RECEIVING_KEEPERS = Object.freeze({
  1591805230: 'raidrelichq',
  1591806023: 'olsols2',
});
// Validates operator-owned mapping only; runtime admission remains the existing
// pilot allowlist until a separately reviewed Keeper setup changes it.
export function keeperNetwork(value = RECEIVING_KEEPERS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Keeper mapping');
  const pairs = Object.entries(value);
  if (
    !pairs.length ||
    pairs.length > 4 ||
    !pairs.every(([id, login]) => /^\d{1,32}$/.test(id) && /^[a-z0-9_]{1,25}$/.test(login)) ||
    new Set(pairs.map(([, login]) => login)).size !== pairs.length
  )
    throw Error('Keeper mapping');
  return Object.freeze(Object.fromEntries(pairs));
}
const time = (v) => Number.isSafeInteger(v) && v >= 0;
const count = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 1000000;
// Called from the existing store read transaction. No viewer associations escape.
export function receivingView(registry, channels, marks, lineage, config, now) {
  const names = Object.fromEntries(Object.entries(config?.logins ?? {}).map(([n, id]) => [id, n]));
  const ids = config?.channels ?? [];
  const stops = lineage?.stops ?? [];
  if (ids.length > 4 || stops.length > 16) throw Error('Receiving capacity');
  const safe = (id) =>
    channels[id]?.optedIn === true &&
    !channels[id]?.banned &&
    !channels[id]?.blockedUserIds?.includes(id) &&
    !marks[id]?.blocked?.includes(id);
  const stop = (s) => ({
    stopId: s.stopId,
    from: names[s.from] ?? null,
    to: names[s.to] ?? null,
    ringIndex: s.ringIndex,
    claimedAt: s.claimedAt,
    ...(s.kind === 'wander'
      ? { kind: 'wander' }
      : count(s.raidSize)
        ? { raidAudience: s.raidSize }
        : {}),
  });
  const last = stops.at(-1);
  const holder = ids.includes(registry?.holderId) ? names[registry.holderId] : null;
  return {
    enabled: config?.seekersEnabled === true,
    observedAt: now,
    holder: holder
      ? {
          login: holder,
          heldSince: last?.to === registry.holderId && time(last.claimedAt) ? last.claimedAt : null,
          ringCount: stops.length,
        }
      : null,
    recent: [
      ...new Set(
        [...stops]
          .reverse()
          .map((s) => names[s.to])
          .filter(Boolean),
      ),
    ].slice(0, 4),
    seekers: config?.seekersEnabled
      ? ids
          .filter(
            (id) =>
              safe(id) &&
              channels[id]?.seeking === true &&
              channels[id]?.online &&
              !channels[id]?.paused &&
              !marks[id]?.paused &&
              marks[id]?.context?.optedIn &&
              marks[id]?.context?.streamId === channels[id]?.streamId,
          )
          .map((id) => ({ id, login: names[id], streamId: channels[id].streamId }))
      : [],
    profiles: ids
      .filter((id) => safe(id) && names[id])
      .map((id) => {
        const received = stops.filter((s) => s.to === id);
        const latest = received.at(-1);
        return {
          login: names[id],
          received: received.map(stop),
          glyphs: (latest?.marks ?? [])
            .slice(0, 20)
            .map((m) => ({ text: m.text, runeSvg: runeSvg(m.text) })),
          glyphTotal: latest?.marks?.length ?? 0,
        };
      }),
  };
}

// Explicit local injection; no timer, startup networking, token refresh or writes.
export function createReceiving({
  enabled = false,
  state,
  store,
  oauth,
  clientId,
  botId,
  transport,
  keepers = RECEIVING_KEEPERS,
  now = Date.now,
}) {
  keepers = keeperNetwork(keepers);
  const ids = Object.keys(keepers);
  if (
    ids.length < 1 ||
    ids.length > 4 ||
    !ids.every((id) => /^\d{1,32}$/.test(id) && /^[a-z0-9_]{1,25}$/.test(keepers[id])) ||
    new Set(Object.values(keepers)).size !== ids.length
  )
    throw Error('Receiving configuration');
  let cached = null,
    attemptedAt = null,
    pending = null;
  async function observations() {
    if (!enabled) return null;
    const t = now();
    if (attemptedAt !== null && t >= attemptedAt && t - attemptedAt < 60000)
      return pending ?? cached;
    attemptedAt = t;
    cached = null;
    pending = boundedCall(async (signal) => {
      const token = await oauth.readAccessToken('bot', ['user:read:moderated_channels']);
      const headers = { Authorization: `Bearer ${token}`, 'Client-Id': clientId };
      const q = new URLSearchParams(ids.map((id) => ['user_id', id]));
      const r = await transport(`https://api.twitch.tv/helix/streams?${q}`, { headers, signal });
      if (r.status !== 200 || !Array.isArray(r.data?.data) || r.data.data.length > ids.length)
        throw Error('Observation unavailable');
      const streams = {};
      for (const v of r.data.data) {
        if (
          !ids.includes(v.user_id) ||
          streams[v.user_id] ||
          v.type !== 'live' ||
          !/^\d{1,128}$/.test(v.id) ||
          !count(v.viewer_count)
        )
          throw Error('Observation invalid');
        streams[v.user_id] = { streamId: v.id, viewers: v.viewer_count };
      }
      const moderators = new Set();
      let after = null;
      const cursors = new Set();
      for (let page = 0; page < 3; page++) {
        const query = new URLSearchParams({ user_id: botId, first: '100' });
        if (after) query.set('after', after);
        const m = await transport(`https://api.twitch.tv/helix/moderation/channels?${query}`, {
          headers,
          signal,
        });
        if (
          m.status !== 200 ||
          !Array.isArray(m.data?.data) ||
          m.data.data.length > 100 ||
          !m.data.pagination
        )
          throw Error('Moderator unavailable');
        for (const row of m.data.data)
          if (ids.includes(row.broadcaster_id)) moderators.add(row.broadcaster_id);
        after = m.data.pagination.cursor;
        if (!after) break;
        if (typeof after !== 'string' || after.length > 512 || cursors.has(after) || page === 2)
          throw Error('Moderator capacity');
        cursors.add(after);
      }
      if (signal.aborted) throw Error('Observation expired');
      return { at: t, streams, moderators };
    }, 8000).catch(() => null);
    try {
      cached = await pending;
      return cached;
    } finally {
      pending = null;
    }
  }
  async function grants(id) {
    const role = id === ids[0] ? 'streamer' : `keeper:${id}`;
    if (!(await store.getToken(role)) || (await store.getJob(id))?.ready !== true) return false;
    try {
      await oauth.readAccessToken(role);
      return true;
    } catch {
      return false;
    }
  }
  async function page() {
    const value = await state.getReceivingView(now());
    if (!enabled) return { ...value, enabled: false, seekers: [], live: null };
    const observation = await observations();
    const fresh = observation && now() >= observation.at && now() - observation.at < 60000;
    const seekers = [];
    if (fresh)
      for (const row of value.seekers) {
        const stream = observation.streams[row.id];
        if (
          stream?.streamId === row.streamId &&
          observation.moderators.has(row.id) &&
          (await grants(row.id))
        )
          seekers.push({ login: row.login, viewers: stream.viewers });
      }
    seekers.sort((a, b) => a.viewers - b.viewers || a.login.localeCompare(b.login, 'en'));
    const holderId = ids.find((id) => keepers[id] === value.holder?.login);
    const live = fresh && holderId ? Boolean(observation.streams[holderId]) : null;
    return { ...value, seekers, live, liveObservedAt: fresh ? observation.at : null };
  }
  return {
    enabled,
    page,
    async candidates(source) {
      if (!enabled) return state.getKeeperCandidates(source);
      const value = await page();
      const eligible = await state.getKeeperCandidates(source);
      return value.seekers
        .filter((s) => s.login !== keepers[source])
        .flatMap((s) => {
          const row = eligible.find((r) => r.login === s.login);
          return row ? [{ ...row, viewers: s.viewers }] : [];
        });
    },
    async authorize(source, target) {
      if (!enabled) return;
      const rows = await this.candidates(source);
      if (!rows.some((r) => r.id === target)) throw Error('Recipient unavailable');
      // Validate the bot principal and grant again at dispatch; no refresh/save.
      const token = await oauth.readAccessToken('bot', ['user:read:moderated_channels']);
      const isModerator = await boundedCall(async (signal) => {
        let after = null;
        const seen = new Set();
        for (let page = 0; page < 3; page++) {
          const q = new URLSearchParams({ user_id: botId, first: '100' });
          if (after) q.set('after', after);
          const r = await transport(`https://api.twitch.tv/helix/moderation/channels?${q}`, {
            signal,
            headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId },
          });
          if (
            r.status !== 200 ||
            !Array.isArray(r.data?.data) ||
            r.data.data.length > 100 ||
            !r.data.pagination
          )
            return false;
          if (r.data.data.some((row) => row.broadcaster_id === target)) return true;
          after = r.data.pagination.cursor;
          if (!after) return false;
          if (typeof after !== 'string' || after.length > 512 || seen.has(after)) return false;
          seen.add(after);
        }
        return false;
      }, 8000);
      if (!isModerator) throw Error('Recipient moderator unavailable');
      if (!(await grants(target))) throw Error('Recipient grant unavailable');
    },
  };
}
