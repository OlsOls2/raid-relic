import { hash } from './crypto.js';

export const MARK_LIMITS = Object.freeze({ perViewerPerStream: 5, participantsPerStream: 32, marksPerStream: 160,
  retainedMarks: 160, cooldownMs: 30000, cooldowns: 128, sessions: 16, blockedUsers: 128, bytes: 131072 });
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
const blockedWords = ['fuck', 'shit', 'nazi', 'porn', 'kill', 'suicide', 'https', 'www'];
const emoji = /^(?:\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*)$|^\p{Regional_Indicator}{2}$|^[0-9#*]\uFE0F?\u20E3$/u;
const userId = value => typeof value === 'string' && /^\d{1,32}$/.test(value);

export function normalizeMark(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 128 || /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(input)) return null;
  const text = input.normalize('NFKC').toLowerCase().replaceAll('ß', 'ss').replaceAll('ς', 'σ');
  if (!text || Buffer.byteLength(text) > 128 || [...text].length > 32) return null;
  const word = /^\p{L}[\p{L}\p{M}]*$/u.test(text);
  if (word && !blockedWords.some(term => text.includes(term))) return text;
  if (emoji.test(text) && [...segmenter.segment(text)].length === 1) return text;
  return null;
}

// Original numeric geometry only. Input text never appears in SVG markup.
export function runeGeometry(input) {
  const normalized = normalizeMark(input);
  if (!normalized) throw new Error('Invalid mark');
  const digest = hash(`raid-relic-rune-v1:${normalized}`);
  const points = Array.from({ length: 8 }, (_, i) => [16 + parseInt(digest.slice(i * 2, i * 2 + 2), 16) % 5 * 16, 16 + parseInt(digest.slice(16 + i * 2, 18 + i * 2), 16) % 5 * 16]);
  const color = ['#e6bb70', '#9e87ed', '#70c9bd', '#dd93b3'][parseInt(digest[32], 16) % 4];
  return { points, color };
}
export function runeSvg(input) {
  const { points, color } = runeGeometry(input);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><path d="M48 6 90 48 48 90 6 48Z" fill="none" stroke="${color}" stroke-width="3"/><polyline points="${points.map(point => point.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function parseMarkCommand(text) {
  const score = new Map(Object.entries({ '!relic scores on':'scores-on', '!relic scores off':'scores-off', '!relic top':'top', '!relic badges':'badges' })).get(text);
  if (score) return { type: score };
  const send = /^!relic send @([a-zA-Z0-9_]{1,25})$/.exec(text);
  if (send) return { type: 'send', login: send[1].toLowerCase() };
  const mark = /^!mark(?: (.*))?$/iu.exec(text);
  if (mark) return { type: 'mark', text: normalizeMark(mark[1]) };
  const own = /^!relic mymarks(?: @([a-zA-Z0-9_]{1,25}))?$/.exec(text);
  if (own) return { type: 'mymarks', ...(own[1] ? { login: own[1].toLowerCase() } : {}) };
  if (text === '!relic forgetme') return { type: 'forgetme' };
  if (text === '!relic veto-last') return { type: 'veto-last' };
  if (text === '!offer') return { type: 'offer' };
  if (text === '!accept') return { type: 'accept' };
  if (text === '!relic pause') return { type: 'pause', paused: true };
  if (text === '!relic resume') return { type: 'pause', paused: false };
  if (text === '!relic opt-out') return { type: 'opt-out' };
  if (text === '!relic keep' || text === '!relic opt-in') return { type: 'keep' };
  const approve = /^!relic approve (m[1-9]\d{0,8})$/.exec(text);
  if (approve) return { type: 'approve', markId: approve[1] };
  const block = /^!relic block (\d{1,32})$/.exec(text);
  return block ? { type: 'block', userId: block[1] } : /^!relic(?:\s|$)/.test(text) ? {type:'help'} : null;
}

export function isModerator(actor, host) {
  return isChatIdentity(actor, host) && (actor.chatterId === host || actor.isModerator === true);
}
export const isChatIdentity = (actor, host) => userId(host) && actor?.broadcasterId === host && userId(actor.chatterId);
const empty = () => ({ context: null, paused: false, blocked: [], sessions: [], cooldowns: [], serial: 0 });
export const emptyMarkDocument = empty;
function bounded(doc) {
  if (Buffer.byteLength(JSON.stringify(doc)) > MARK_LIMITS.bytes) throw new Error('Mark storage capacity reached');
  return doc;
}
export function setMarkContext(previous, host, context) {
  if (!userId(host) || typeof context?.streamId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(context.streamId)
    || !userId(context.keeperId) || typeof context.optedIn !== 'boolean' || typeof context.holdsRelic !== 'boolean'
    || !Array.isArray(context.blockedUserIds) || context.blockedUserIds.length > MARK_LIMITS.blockedUsers || !context.blockedUserIds.every(userId)) throw new Error('Trusted Keeper context required');
  const doc = structuredClone(previous ?? empty());
  const selected = doc.sessions.find(session => session.streamId === context.streamId);
  if (selected?.closed) throw new Error('Closed stream cannot be reactivated');
  if (!doc.sessions.some(session => session.streamId === context.streamId)) {
    if (doc.sessions.length >= MARK_LIMITS.sessions) throw new Error('Retained stream capacity reached');
    doc.sessions.push({ streamId: context.streamId, spent: 0, viewers: [], marks: [], closed: false });
  }
  if (doc.context && doc.context.streamId !== context.streamId) {
    const ended = doc.sessions.find(session => session.streamId === doc.context.streamId);
    if (ended) { ended.closed = true; ended.viewers = []; }
  }
  doc.context = { streamId: context.streamId, keeperId: context.keeperId, optedIn: context.optedIn,
    holdsRelic: context.holdsRelic, blockedUserIds: [...new Set(context.blockedUserIds)] };
  return bounded(doc);
}
const active = (doc, host) => doc.context?.optedIn === true && doc.context.holdsRelic === true && doc.context.keeperId === host;

// Pure reducer shared by memory and Firestore; invoke only with trusted identities.
export function reduceMark(previous, host, actor, action, now) {
  const doc = structuredClone(previous ?? empty());
  if (!userId(host) || actor?.broadcasterId !== host || !userId(actor.chatterId) || !Number.isFinite(now) || !action) return doc;
  doc.cooldowns = doc.cooldowns.filter(entry => now - entry.at < MARK_LIMITS.cooldownMs);
  if (['scores-on','scores-off','top','badges','help'].includes(action.type)) return doc;
  if (action.type === 'forgetme') {
    if (doc.shares) doc.shares = doc.shares.filter(s => s.actor !== actor.chatterId);
    for (const session of doc.sessions) session.marks = session.marks.filter(mark => mark.userId !== actor.chatterId);
    // Keep only existing minimal counters/cooldowns: no content, mark IDs,
    // timestamps of forgetting, or new identity records are added here.
    return bounded(doc);
  }
  if (action.type !== 'mark') {
    if (action.type !== 'mymarks' && isModerator(actor, host)) delete doc.shares;
    if (!isModerator(actor, host)) return doc;
    const session = doc.sessions.find(item => item.streamId === doc.context?.streamId);
    if (action.type === 'pause' && typeof action.paused === 'boolean') doc.paused = action.paused;
    if (action.type === 'opt-out') {
      if (doc.context) doc.context.optedIn = false;
      for (const item of doc.sessions) item.marks = [];
    }
    if (action.type === 'approve') {
      const mark = session?.marks.find(item => item.id === action.markId);
      if (mark && active(doc, host) && !doc.blocked.includes(mark.userId) && !doc.context.blockedUserIds.includes(mark.userId)) mark.status = 'approved';
    }
    if (action.type === 'veto-last') {
      const last = session?.marks.length ? session : [...doc.sessions].reverse().find(item => item.marks.length);
      last?.marks.pop();
    }
    if (action.type === 'block' && userId(action.userId)) {
      if (!doc.blocked.includes(action.userId)) {
        if (doc.blocked.length >= MARK_LIMITS.blockedUsers) throw new Error('Block capacity reached');
        doc.blocked.push(action.userId);
      }
      for (const item of doc.sessions) item.marks = item.marks.filter(mark => mark.userId !== action.userId);
    }
    return bounded(doc);
  }
  const text = normalizeMark(action.text);
  if (!text || !active(doc, host) || doc.paused || doc.blocked.includes(actor.chatterId) || doc.context.blockedUserIds.includes(actor.chatterId)) return doc;
  const session = doc.sessions.find(item => item.streamId === doc.context.streamId);
  if (!session || session.closed) return doc;
  const viewer = session.viewers.find(entry => entry.userId === actor.chatterId);
  if (viewer?.spent >= MARK_LIMITS.perViewerPerStream) return doc;
  if (doc.cooldowns.some(entry => entry.userId === actor.chatterId)) return doc;
  if ((!viewer && session.viewers.length >= MARK_LIMITS.participantsPerStream)
    || session.marks.length >= MARK_LIMITS.marksPerStream
    || doc.sessions.reduce((count, item) => count + item.marks.length, 0) >= MARK_LIMITS.retainedMarks) return doc;
  if (doc.cooldowns.length >= MARK_LIMITS.cooldowns || doc.serial >= 999999999) throw new Error('Mark storage capacity reached');
  if (viewer) viewer.spent++;
  else session.viewers.push({ userId: actor.chatterId, spent: 1 });
  session.spent++;
  session.marks.push({ id: `m${++doc.serial}`, userId: actor.chatterId, text, status: 'pending', createdAt: now });
  doc.cooldowns.push({ userId: actor.chatterId, at: now });
  return bounded(doc);
}

export function publicMarks(doc, host) {
  if (!doc || !active(doc, host)) return { marks: [] };
  const session = doc.sessions.find(item => item.streamId === doc.context.streamId);
  return { marks: (session?.marks ?? []).filter(mark => mark.status === 'approved' && !doc.blocked.includes(mark.userId) && !doc.context.blockedUserIds.includes(mark.userId))
    .map(mark => ({ id: mark.id, runeSvg: runeSvg(mark.text) })) };
}
export function publicOverlayState(doc, host) {
  return { status: !doc || !active(doc, host) ? 'waiting' : doc.paused ? 'paused' : 'ready', ...publicMarks(doc, host) };
}
export function privateMarks(doc, host, actor) {
  if (!isModerator(actor, host)) throw new Error('Moderator identity required');
  return structuredClone(doc ?? empty());
}

// Internal trusted services only; never construct actor from an HTTP body.
export function createMarkService(store, { now = Date.now } = {}) {
  const control = (host, actor, action) => store.controlMarks(host, actor, action, now());
  return {
    setKeeperContext: (host, context) => store.setKeeperContext(host, context),
    approve: (host, actor, markId) => control(host, actor, { type: 'approve', markId }),
    vetoLast: (host, actor) => control(host, actor, { type: 'veto-last' }),
    pause: (host, actor, paused = true) => control(host, actor, { type: 'pause', paused }),
    blockUser: (host, actor, userId) => control(host, actor, { type: 'block', userId }),
    optOut: (host, actor) => control(host, actor, { type: 'opt-out' }),
    forgetMe: (host, actor) => control(host, actor, { type: 'forgetme' }),
    publicProjection: host => store.getPublicMarks(host),
    moderationView: (host, actor) => store.getPrivateMarks(host, actor),
  };
}
