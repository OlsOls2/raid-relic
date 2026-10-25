import { emptyMarkDocument, reduceMark, setMarkContext } from './marks.js';

export const INITIAL_HOME = '1591805230';
export const LIFECYCLE_LIMITS = Object.freeze({ channels: 4, closedStreams: 16, channelBytes: 16384, registryBytes: 4096 });
export function lifecycleConfig(value) {
  if (!value) return null;
  if (!Array.isArray(value.channels) || !value.channels.length || value.channels.length > LIFECYCLE_LIMITS.channels
    || !value.channels.every(id => typeof id === 'string' && /^\d{1,32}$/.test(id))) throw new Error('Bounded lifecycle channels required');
  return { channels: [...new Set(value.channels)] };
}
export const emptyRegistry = () => ({ holderId: null, originated: false });
const emptyChannel = () => ({ online: false, streamId: null, startedAt: null, lifecycleAt: -1, closedThrough: -1,
  closedIds: [], optedIn: false, consentAt: -1, paused: false, banned: false, blockedUserIds: [] });

export function parseLifecycle(payload, host, sentAt) {
  const subscription = payload.subscription; const event = payload.event;
  if (!['stream.online', 'stream.offline'].includes(subscription?.type) || subscription.version !== '1'
    || subscription.condition?.broadcaster_user_id !== host || event?.broadcaster_user_id !== host) throw new Error('Invalid stream condition');
  if (subscription.type === 'stream.offline') return { host, type: 'offline', sentAt };
  const startedAt = Date.parse(event.started_at);
  if (typeof event.id !== 'string' || !/^\d{1,128}$/.test(event.id) || event.type !== 'live'
    || typeof event.started_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(event.started_at)
    || !Number.isFinite(startedAt) || startedAt > sentAt || new Date(startedAt).toISOString().slice(0, 19) !== event.started_at.slice(0, 19)) throw new Error('Invalid stream');
  return { host, type: 'online', streamId: event.id, startedAt, sentAt };
}
function closeStream(channel, marks) {
  if (channel.streamId && !channel.closedIds.includes(channel.streamId)) {
    if (channel.closedIds.length >= LIFECYCLE_LIMITS.closedStreams) throw new Error('Stream tombstone capacity reached');
    channel.closedIds.push(channel.streamId);
  }
  const session = marks.sessions.find(item => item.streamId === channel.streamId);
  if (session) { session.closed = true; session.viewers = []; }
  if (marks.context) marks.context.holdsRelic = false;
}
function sync(registry, channel, marks, host) {
  if (channel.online) {
    marks = setMarkContext(marks, host, { streamId: channel.streamId, keeperId: host, optedIn: channel.optedIn,
      holdsRelic: registry.holderId === host && !channel.banned, blockedUserIds: channel.blockedUserIds });
  } else if (marks.context) {
    marks.context.holdsRelic = false; marks.context.optedIn = channel.optedIn;
  }
  marks.paused = channel.paused;
  return marks;
}

// Called inside one store transaction, including event dedupe. No external effects.
export function reduceLifecycle({ registry, channel, marks, host, event, chat, policy, now, sentAt }) {
  registry = structuredClone(registry ?? emptyRegistry());
  channel = structuredClone(channel ?? emptyChannel());
  marks = structuredClone(marks ?? emptyMarkDocument());
  if (policy) {
    if (typeof policy.banned !== 'boolean' || !Array.isArray(policy.blockedUserIds) || policy.blockedUserIds.length > 128
      || !policy.blockedUserIds.every(id => typeof id === 'string' && /^\d{1,32}$/.test(id))) throw new Error('Bounded trusted channel policy required');
    channel.banned = policy.banned; channel.blockedUserIds = [...new Set(policy.blockedUserIds)];
  }
  if (event?.type === 'online' && event.sentAt > channel.lifecycleAt && event.startedAt > channel.closedThrough
    && !channel.closedIds.includes(event.streamId) && event.streamId !== channel.streamId
    && (!channel.online || event.startedAt > channel.startedAt)) {
    if (channel.online) closeStream(channel, marks);
    channel.online = true; channel.streamId = event.streamId; channel.startedAt = event.startedAt; channel.lifecycleAt = event.sentAt;
  }
  if (event?.type === 'offline' && event.sentAt >= channel.lifecycleAt) {
    closeStream(channel, marks);
    channel.closedThrough = Math.max(channel.closedThrough, event.sentAt);
    channel.lifecycleAt = event.sentAt; channel.online = false; channel.streamId = null; channel.startedAt = null;
  }
  const action = chat?.markAction;
  const owner = chat?.broadcasterId === host && chat.chatterId === host;
  if (owner && action?.type === 'keep' && sentAt > channel.consentAt && !channel.banned && !channel.paused
    && !channel.blockedUserIds.includes(host) && !marks.blocked.includes(host)) {
    channel.optedIn = true; channel.consentAt = sentAt;
  }
  if (owner && action?.type === 'opt-out' && sentAt >= channel.consentAt) {
    channel.optedIn = false; channel.consentAt = sentAt;
    for (const session of marks.sessions) session.marks = [];
  }
  // Only the initial home can place the one unplaced relic. Opting out/offline
  // never releases it for another opt-in. No transfer path exists in this increment.
  if (!registry.originated && registry.holderId === null && host === INITIAL_HOME && channel.online && channel.optedIn
    && !channel.banned && !channel.paused && !channel.blockedUserIds.includes(host) && !marks.blocked.includes(host)) {
    registry.holderId = host; registry.originated = true;
  }
  marks = sync(registry, channel, marks, host);
  if (action && !['keep', 'opt-out'].includes(action.type)) {
    // A delayed chat mark from an older stream must not spend the new stream budget.
    if (action.type !== 'mark' || (channel.online && sentAt >= channel.startedAt && sentAt >= channel.consentAt && sentAt > channel.closedThrough)) {
      marks = reduceMark(marks, host, chat, action, now);
    }
    channel.paused = marks.paused;
  }
  // Recheck holder eligibility after controls, but do not acquire on a resume.
  marks = sync(registry, channel, marks, host);
  if (Buffer.byteLength(JSON.stringify(registry)) > LIFECYCLE_LIMITS.registryBytes || Buffer.byteLength(JSON.stringify(channel)) > LIFECYCLE_LIMITS.channelBytes) throw new Error('Lifecycle storage capacity reached');
  return { registry, channel, marks };
}
