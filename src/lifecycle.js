import { dequeueSeeker } from './seeker-state.js';
import { wanderActivity } from './wander-state.js';
import { emptyMarkDocument, reduceMark, setMarkContext } from './marks.js';

export const INITIAL_HOME = '1591805230';
export const LIFECYCLE_LIMITS = Object.freeze({
  channels: 4,
  closedStreams: 16,
  channelBytes: 16384,
  registryBytes: 4096,
});
export function lifecycleConfig(value) {
  if (!value) return null;
  if (
    !Array.isArray(value.channels) ||
    !value.channels.length ||
    value.channels.length > LIFECYCLE_LIMITS.channels ||
    !value.channels.every((id) => typeof id === 'string' && /^\d{1,32}$/.test(id))
  )
    throw new Error('Bounded lifecycle channels required');
  const logins =
    value.logins ?? (value.channels.includes(INITIAL_HOME) ? { raidrelichq: INITIAL_HOME } : {});
  if (
    Object.keys(logins).length > LIFECYCLE_LIMITS.channels ||
    !Object.entries(logins).every(
      ([login, id]) => /^[a-z0-9_]{1,25}$/.test(login) && value.channels.includes(id),
    )
  )
    throw new Error('Bounded Keeper login mapping required');
  return {
    channels: [...new Set(value.channels)],
    logins: { ...logins },
    ...(value.streakEnabled === true ? { streakEnabled: true } : {}),
    ...(value.seekersEnabled === true ? { seekersEnabled: true } : {}),
  };
}
export const emptyRegistry = () => ({ holderId: null, originated: false });
const emptyChannel = () => ({
  online: false,
  streamId: null,
  startedAt: null,
  lifecycleAt: -1,
  closedThrough: -1,
  closedIds: [],
  optedIn: false,
  consentAt: -1,
  paused: false,
  banned: false,
  blockedUserIds: [],
});

export function parseLifecycle(payload, host, sentAt) {
  const subscription = payload.subscription;
  const event = payload.event;
  if (
    !['stream.online', 'stream.offline'].includes(subscription?.type) ||
    subscription.version !== '1' ||
    subscription.condition?.broadcaster_user_id !== host ||
    event?.broadcaster_user_id !== host
  )
    throw new Error('Invalid stream condition');
  if (subscription.type === 'stream.offline') return { host, type: 'offline', sentAt };
  const startedAt = Date.parse(event.started_at);
  if (
    typeof event.id !== 'string' ||
    !/^\d{1,128}$/.test(event.id) ||
    event.type !== 'live' ||
    typeof event.started_at !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(event.started_at) ||
    !Number.isFinite(startedAt) ||
    startedAt > sentAt ||
    new Date(startedAt).toISOString().slice(0, 19) !== event.started_at.slice(0, 19)
  )
    throw new Error('Invalid stream');
  return { host, type: 'online', streamId: event.id, startedAt, sentAt };
}
const closureFence = (channel) =>
  Math.max(
    channel.closedStartFence ?? -1,
    channel.closedThrough,
    channel.lifecycleAt,
    channel.startedAt ?? -1,
  );
function closeStream(channel, marks) {
  if (channel.streamId && !channel.closedIds.includes(channel.streamId)) {
    if (channel.closedIds.length >= LIFECYCLE_LIMITS.closedStreams) {
      // Legacy IDs have no individual start timestamps. Fence through the
      // authoritative ordering boundary before forgetting any opaque ID.
      channel.closedStartFence = closureFence(channel);
      channel.closedIds.shift();
    }
    channel.closedIds.push(channel.streamId);
  }
  const session = marks.sessions.find((item) => item.streamId === channel.streamId);
  if (session) {
    session.closed = true;
    session.viewers = [];
  }
  if (marks.context) marks.context.holdsRelic = false;
}
function sync(registry, channel, marks, host) {
  if (channel.online) {
    marks = setMarkContext(marks, host, {
      streamId: channel.streamId,
      keeperId: host,
      optedIn: channel.optedIn,
      holdsRelic: registry.holderId === host && !channel.banned,
      blockedUserIds: channel.blockedUserIds,
    });
  } else if (marks.context) {
    marks.context.holdsRelic = false;
    marks.context.optedIn = channel.optedIn;
  }
  marks.paused = channel.paused;
  return marks;
}

// Called inside one store transaction, including event dedupe. No external effects.
export function reduceLifecycle({
  registry,
  channel,
  marks,
  host,
  event,
  chat,
  policy,
  now,
  sentAt,
  observed = false,
  reviewPolicy,
  seekersEnabled = false,
  wanderEnabled = false,
}) {
  const approvedBefore = (marks?.sessions ?? []).reduce(
    (n, s) => n + s.marks.filter((m) => m.status === 'approved').length,
    0,
  );
  registry = structuredClone(registry ?? emptyRegistry());
  if (event || chat?.markAction || policy) delete registry.echo;
  channel = structuredClone(channel ?? emptyChannel());
  marks = structuredClone(marks ?? emptyMarkDocument());
  if (policy || event) delete marks.shares;
  const countHolderClosure = () => {
    if (
      registry.holderId === host &&
      channel.online &&
      channel.streamId &&
      !channel.closedIds.includes(channel.streamId)
    )
      registry.carriedClosures = Math.min(
        3,
        (Number.isInteger(registry.carriedClosures) && registry.carriedClosures >= 0
          ? Math.min(3, registry.carriedClosures)
          : 0) + 1,
      );
  };
  if (policy) {
    if (
      typeof policy.banned !== 'boolean' ||
      !Array.isArray(policy.blockedUserIds) ||
      policy.blockedUserIds.length > 128 ||
      !policy.blockedUserIds.every((id) => typeof id === 'string' && /^\d{1,32}$/.test(id))
    )
      throw new Error('Bounded trusted channel policy required');
    channel.banned = policy.banned || channel.banCapacityReached === true;
    channel.blockedUserIds = [
      ...new Set([...policy.blockedUserIds, ...(channel.observedBans ?? [])]),
    ];
    if (channel.blockedUserIds.length > 128) throw Error('Policy capacity reached');
  }
  // Twitch start times may be second-precision. A later signed receipt can
  // establish a distinct stream in the same second as the offline watermark.
  // A CAS-verified fresh Helix read may also recover a distinct stream whose
  // delayed offline delivery crossed its start; known closed IDs never revive.
  if (
    event?.type === 'online' &&
    event.sentAt > channel.lifecycleAt &&
    event.startedAt > (channel.closedStartFence ?? -1) &&
    // Replacement must also satisfy the fence its own closure would establish.
    (!channel.online ||
      channel.closedIds.length < LIFECYCLE_LIMITS.closedStreams ||
      channel.closedIds.includes(channel.streamId) ||
      event.startedAt > closureFence(channel)) &&
    (event.startedAt > channel.closedThrough ||
      event.startedAt >= Math.floor(channel.closedThrough / 1000) * 1000 ||
      (observed &&
        !channel.online &&
        (!channel.retiredStream || event.startedAt > channel.retiredStream.startedAt))) &&
    !channel.closedIds.includes(event.streamId) &&
    event.streamId !== channel.streamId &&
    (!channel.online || event.startedAt > channel.startedAt)
  ) {
    if (channel.online) {
      countHolderClosure();
      closeStream(channel, marks);
    }
    channel.online = true;
    channel.streamId = event.streamId;
    channel.startedAt = event.startedAt;
    channel.lifecycleAt = event.sentAt;
    channel.lifecycleSource = event.provenance ?? 'eventsub';
  }
  if (event?.type === 'offline' && event.sentAt >= channel.lifecycleAt) {
    // Retain only the last authoritative stream closure. Repeated offline
    // deliveries must not extend its eligibility boundary.
    if (channel.online && channel.streamId)
      channel.retiredStream = {
        streamId: channel.streamId,
        startedAt: channel.startedAt,
        offlineAt: event.sentAt,
      };
    countHolderClosure();
    closeStream(channel, marks);
    channel.closedThrough = Math.max(channel.closedThrough, event.sentAt);
    channel.lifecycleAt = event.sentAt;
    channel.lifecycleSource = event.provenance ?? 'eventsub';
    channel.online = false;
    channel.streamId = null;
    channel.startedAt = null;
  }
  if (event?.type === 'ban') {
    channel.observedBans ??= [];
    if (!channel.observedBans.includes(event.userId)) {
      if (
        channel.observedBans.length >= 128 ||
        channel.blockedUserIds.length >= 128 ||
        marks.blocked.length >= 128
      ) {
        channel.banned = true;
        channel.banCapacityReached = true;
      } else {
        channel.observedBans.push(event.userId);
        channel.blockedUserIds = [...new Set([...channel.blockedUserIds, event.userId])];
        marks.blocked = [...new Set([...marks.blocked, event.userId])];
      }
    }
    for (const session of marks.sessions)
      session.marks = session.marks.filter((mark) => mark.userId !== event.userId);
    delete marks.shares;
  }
  const action = chat?.markAction;
  const owner =
    chat?.broadcasterId === host && chat.chatterId === host && !chat.isBot && !chat.copied;
  if (
    seekersEnabled &&
    owner &&
    ['seek-on', 'seek-off'].includes(action?.type) &&
    Number.isFinite(sentAt) &&
    sentAt <= now &&
    now - sentAt <= 600000 &&
    (sentAt > (channel.seekAt ?? -1) || (action.type === 'seek-off' && sentAt === channel.seekAt))
  ) {
    if (
      action.type === 'seek-off' ||
      (registry.holderId !== host &&
        channel.optedIn &&
        !channel.banned &&
        !channel.paused &&
        !channel.blockedUserIds.includes(host) &&
        !marks.blocked.includes(host))
    ) {
      channel.seeking = action.type === 'seek-on';
      channel.seekAt = sentAt;
    }
  }
  if (
    (seekersEnabled || channel.seeking !== undefined) &&
    owner &&
    action?.type === 'opt-out' &&
    sentAt >= channel.consentAt
  )
    channel.seeking = false;
  if (
    owner &&
    action?.type === 'keep' &&
    sentAt > channel.consentAt &&
    !channel.banned &&
    !channel.paused &&
    !channel.blockedUserIds.includes(host) &&
    !marks.blocked.includes(host)
  ) {
    channel.optedIn = true;
    channel.consentAt = sentAt;
  }
  if (owner && action?.type === 'opt-out' && sentAt >= channel.consentAt) {
    delete marks.shares;
    channel.optedIn = false;
    channel.consentAt = sentAt;
    for (const session of marks.sessions) session.marks = [];
  }
  // Only the initial home can place the one unplaced relic. Opting out/offline
  // never releases it for another opt-in. No transfer path exists in this increment.
  if (
    !registry.originated &&
    registry.holderId === null &&
    host === INITIAL_HOME &&
    channel.online &&
    channel.optedIn &&
    !channel.banned &&
    !channel.paused &&
    !channel.blockedUserIds.includes(host) &&
    !marks.blocked.includes(host)
  ) {
    registry.holderId = host;
    if (seekersEnabled) dequeueSeeker(channel, now);
    registry.originated = true;
  }
  marks = sync(registry, channel, marks, host);
  if (action && !['keep', 'opt-out'].includes(action.type)) {
    // A delayed chat mark from an older stream must not spend the new stream budget.
    if (
      action.type !== 'mark' ||
      (channel.online &&
        sentAt >= channel.startedAt &&
        sentAt >= channel.consentAt &&
        sentAt > channel.closedThrough)
    ) {
      marks = reduceMark(marks, host, chat, action, now, reviewPolicy);
    }
    channel.paused = marks.paused;
  }
  const approvedAfter = marks.sessions.reduce(
    (n, s) => n + s.marks.filter((m) => m.status === 'approved').length,
    0,
  );
  if (approvedAfter > approvedBefore) wanderActivity(registry, now, wanderEnabled);
  // Recheck holder eligibility after controls, but do not acquire on a resume.
  marks = sync(registry, channel, marks, host);
  if (
    Buffer.byteLength(JSON.stringify(registry)) > LIFECYCLE_LIMITS.registryBytes ||
    Buffer.byteLength(JSON.stringify(channel)) > LIFECYCLE_LIMITS.channelBytes
  )
    throw new Error('Lifecycle storage capacity reached');
  return { registry, channel, marks };
}
