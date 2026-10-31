import { seekerState } from './seeker-state.js';
import { boundedCall } from './bounded.js';
import { runeSvg } from './marks.js';

export const RECEIVING_KEEPERS = Object.freeze({
  1591805230: 'raidrelichq',
  1591806023: 'olsols2',
});
// Operator-owned mapping. No request parameter can expand this admission boundary.
export function keeperNetwork(value = RECEIVING_KEEPERS) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error('Keeper mapping');
  const pairs = Object.entries(value);
  if (Object.getOwnPropertySymbols(value).length) throw Error('Keeper mapping');
  if (
    !pairs.length ||
    pairs.length > 4 ||
    !pairs.every(([id, login]) => /^[1-9]\d{0,31}$/.test(id) && /^[a-z0-9_]{1,25}$/.test(login)) ||
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
    ...(config?.seekersEnabled
      ? {
          queueStates: Object.fromEntries(
            ids.map((id) => [names[id], seekerState(registry, lineage, channels, marks, id)]),
          ),
        }
      : {}),
    seekers: config?.seekersEnabled
      ? ids
          .filter(
            (id) =>
              safe(id) &&
              seekerState(registry, lineage, channels, marks, id).member &&
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

// Explicit local injection; no timer or startup networking. Existing OAuth grants
// may be maintained on readiness reads; no gameplay mutation or consent is added.
export function createReceiving({
  enabled = false,
  state,
  store,
  oauth,
  clientId,
  botId,
  transport,
  keepers = RECEIVING_KEEPERS,
  streamerId = '1591805230',
  now = Date.now,
  logger = (line) => console.warn(line),
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
  const warnedGrants = new Map();
  const warn = (reason, stage = 'observation') => {
    try {
      Promise.resolve(
        logger(
          JSON.stringify({
            severity: 'WARNING',
            event: 'raid_relic_receiving_unavailable',
            reason,
            stage,
          }),
        ),
      ).catch(() => {});
    } catch {
      /* Observability cannot change eligibility. */
    }
  };
  async function observations() {
    if (!enabled) return null;
    const t = now();
    if (attemptedAt !== null && t >= attemptedAt && t - attemptedAt < 60000)
      return pending ?? cached;
    attemptedAt = t;
    cached = null;
    let failure = 'bot-grant-unavailable';
    pending = boundedCall(async (signal) => {
      signal.addEventListener(
        'abort',
        () => {
          failure = 'timeout';
        },
        { once: true },
      );
      const token = await oauth.readAccessToken('bot', ['user:read:moderated_channels']);
      const headers = { Authorization: `Bearer ${token}`, 'Client-Id': clientId };
      const q = new URLSearchParams(ids.map((id) => ['user_id', id]));
      failure = 'streams-http';
      const r = await transport(`https://api.twitch.tv/helix/streams?${q}`, { headers, signal });
      if (r.status !== 200) throw Error('Observation unavailable');
      failure = 'streams-shape';
      if (!Array.isArray(r.data?.data) || r.data.data.length > ids.length)
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
        failure = 'moderation-http';
        const m = await transport(`https://api.twitch.tv/helix/moderation/channels?${query}`, {
          headers,
          signal,
        });
        if (m.status !== 200) throw Error('Moderator unavailable');
        failure = 'moderation-shape';
        if (!Array.isArray(m.data?.data) || m.data.data.length > 100 || !m.data.pagination)
          throw Error('Moderator unavailable');
        for (const row of m.data.data)
          if (ids.includes(row.broadcaster_id)) moderators.add(row.broadcaster_id);
        after = m.data.pagination.cursor;
        if (!after) break;
        failure = 'moderation-capacity';
        if (typeof after !== 'string' || after.length > 512 || cursors.has(after) || page === 2)
          throw Error('Moderator capacity');
        cursors.add(after);
      }
      if (signal.aborted) throw Error('Observation expired');
      return { at: t, streams, moderators };
    }, 8000).catch(() => {
      warn(failure);
      return null;
    });
    try {
      cached = await pending;
      return cached;
    } finally {
      pending = null;
    }
  }
  async function grants(id) {
    const role = id === streamerId ? 'streamer' : `keeper:${id}`;
    const warnGrant = (reason) => {
      const t = now(),
        previous = warnedGrants.get(role);
      if (previous === undefined || t < previous || t - previous >= 60000) {
        warnedGrants.set(role, t);
        warn(reason, 'keeper-grant');
      }
    };
    if (!(await store.getToken(role)) || (await store.getJob(id))?.ready !== true) {
      warnGrant('keeper-grant-or-bootstrap-unavailable');
      return false;
    }
    try {
      await oauth.readAccessToken(role);
      return true;
    } catch (error) {
      warnGrant(
        error?.code === 'reconsent-required' ? 'reconsent-required' : 'keeper-grant-unavailable',
      );
      return false;
    }
  }
  async function page() {
    const { queueStates, ...value } = await state.getReceivingView(now());
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
    // Explicit authenticated control observation only; shared one-minute,
    // one-flight provider budget. No subscription, consent or game mutation.
    async observeTargets() {
      await observations();
      return this.observedAt();
    },
    async status(id) {
      if (!ids.includes(id)) return { member: false, reason: 'not-opted-in' };
      const raw = await state.getReceivingView(now());
      const local = raw.queueStates?.[keepers[id]] ?? { member: false, reason: 'not-joined' };
      if (!enabled || !local.member || local.reason !== 'observations-required') return local;
      const observed = await page();
      const latest = (await state.getReceivingView(now())).queueStates?.[keepers[id]];
      if (!latest?.member || latest.reason !== 'observations-required')
        return latest ?? { member: false, reason: 'not-joined' };
      const index = observed.seekers.findIndex((row) => row.login === keepers[id]);
      return index >= 0
        ? { ...latest, position: index + 1, total: observed.seekers.length }
        : latest;
    },
    observedAt() {
      return cached && now() >= cached.at && now() - cached.at < 60000 ? cached.at : null;
    },
    async candidates(source, { cachedOnly = false } = {}) {
      if (!enabled) return state.getKeeperCandidates(source);
      const value = await state.getReceivingView(now());
      // A read may join an already-authorized observation, but never starts one.
      // This avoids a transient empty list while another control refreshes it.
      const observation = cachedOnly ? (pending ? await pending : cached) : await observations();
      if (!observation || now() < observation.at || now() - observation.at >= 60000) return [];
      const eligible = await state.getKeeperCandidates(source);
      const seekers = new Set(value.seekers.map((row) => row.id));
      const rows = [];
      for (const row of eligible) {
        if (!ids.includes(row.id) || row.id === source || row.eligible !== true) continue;
        const channel = await state.getStreamStatus(row.id);
        const stream = observation.streams[row.id];
        if (
          !stream ||
          stream.streamId !== channel?.streamId ||
          !observation.moderators.has(row.id) ||
          !(cachedOnly
            ? Boolean(
                await store.getToken(row.id === streamerId ? 'streamer' : `keeper:${row.id}`),
              ) && (await store.getJob(row.id))?.ready === true
            : await grants(row.id))
        )
          continue;
        rows.push({ ...row, viewers: stream.viewers });
      }
      const stillEligible = new Set(
        (await state.getKeeperCandidates(source))
          .filter((row) => row.eligible === true)
          .map((row) => row.id),
      );
      return rows
        .filter((row) => stillEligible.has(row.id))
        .sort(
          (a, b) =>
            Number(seekers.has(b.id)) - Number(seekers.has(a.id)) ||
            a.viewers - b.viewers ||
            a.login.localeCompare(b.login, 'en'),
        );
    },
    async authorize(source, target) {
      if (!enabled) return;
      const rows = await this.candidates(source);
      if (!rows.some((r) => r.id === target)) throw Error('Recipient unavailable');
      // Maintain and validate the existing bot grant again before dispatch.
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

// Explicit startup configuration only; existing two Keeper names cannot be rebound.
export function configuredKeeperNetwork(raw, { home, bot } = {}) {
  let value = RECEIVING_KEEPERS;
  if (raw !== undefined) {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 1024) throw Error('Keeper mapping');
    try {
      value = JSON.parse(raw);
    } catch {
      throw Error('Keeper mapping');
    }
    // JSON.parse otherwise silently accepts duplicate property names.
    const keys = raw.match(/"[^"\\]*"\s*:/g) ?? [];
    if (keys.length !== Object.keys(value ?? {}).length) throw Error('Keeper mapping');
  }
  const names = keeperNetwork(value);
  if (
    home !== '1591805230' ||
    bot !== '1591804828' ||
    !Object.hasOwn(names, home) ||
    Object.hasOwn(names, bot) ||
    Object.values(names).some((login) =>
      ['raidrelicbot', '__proto__', 'prototype', 'constructor'].includes(login),
    ) ||
    Object.entries(RECEIVING_KEEPERS).some(([id, login]) => names[id] !== login)
  )
    throw Error('Keeper mapping');
  return names;
}
