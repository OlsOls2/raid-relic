import { validStreak } from './streak-view.js';
import { validFlightText, validSourceLogin } from './cinematic.js';
import { validClaimMeter } from './claim-meter.js';
export { validClaimMeter } from './claim-meter.js';
function validHandoff(h) {
  return (
    (h.clockPolicy === undefined || ['preclaim-v1', 'landing-v2'].includes(h.clockPolicy)) &&
    (h.sourceLogin === undefined || validSourceLogin(h.sourceLogin)) &&
    (h.completedAt === undefined ||
      (h.completed === true &&
        Number.isFinite(h.completedAt) &&
        h.completedAt >= h.startedAt &&
        h.completedAt < h.endsAt)) &&
    (!Object.hasOwn(h, 'carriedApprovedCount') ||
      (Number.isSafeInteger(h.carriedApprovedCount) &&
        h.carriedApprovedCount >= 0 &&
        h.carriedApprovedCount <= 160 &&
        h.completed === true &&
        Number.isFinite(h.completedAt) &&
        h.completedAt >= h.startedAt &&
        h.completedAt < h.endsAt)) &&
    ['source', 'host'].includes(h.role) &&
    Number.isFinite(h.startedAt) &&
    Number.isFinite(h.endsAt) &&
    (h.clockPolicy === 'landing-v2'
      ? h.claimStartedAt === h.startedAt && h.endsAt - h.startedAt === 180000
      : h.clockPolicy === 'preclaim-v1'
        ? Number.isFinite(h.claimStartedAt) &&
          h.endsAt - h.claimStartedAt === 180000 &&
          h.startedAt >= h.claimStartedAt &&
          h.startedAt < h.endsAt
        : h.endsAt - h.startedAt === 90000) &&
    Number.isInteger(h.threshold) &&
    h.threshold >= 1 &&
    h.threshold <= 10 &&
    [h.offers, h.accepts].every((v) => Number.isInteger(v) && v >= 0 && v <= h.threshold) &&
    typeof h.completed === 'boolean'
  );
}
export function resonanceActive(cue, now) {
  return Boolean(cue && now >= cue.receivedAt && now < cue.expiresAt);
}
export function validSnapshot(value) {
  return (
    (value?.wanderArrival === undefined ||
      (value.wanderArrival?.kind === 'wander' &&
        value.handoff == null &&
        Object.keys(value.wanderArrival).sort().join(',') === 'at,kind,stopId' &&
        Number.isSafeInteger(value.wanderArrival.at) &&
        value.wanderArrival.at >= 0 &&
        value.wanderArrival.at <= value.serverNow &&
        /^[a-f0-9]{64}$/.test(value.wanderArrival.stopId))) &&
    (value?.streak === undefined ||
      (validStreak(value.streak) &&
        (!value.streak.known || value.streak.since <= value.serverNow))) &&
    value?.type === 'snapshot' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    (value.resonance === undefined ||
      (value.resonance &&
        Number.isFinite(value.resonance.receivedAt) &&
        Number.isFinite(value.resonance.expiresAt) &&
        value.resonance.expiresAt - value.resonance.receivedAt === 1200 &&
        /^[a-f0-9]{64}$/.test(value.resonance.id))) &&
    (value.claimMeter == null ||
      (Number.isFinite(value.serverNow) && validClaimMeter(value.claimMeter))) &&
    (value.holderLogin === undefined ||
      (validSourceLogin(value.holderLogin) &&
        (value.movedToLogin === undefined || value.movedToLogin === value.holderLogin))) &&
    (value.movedToLogin === undefined ||
      (value.status === 'waiting' && validSourceLogin(value.movedToLogin))) &&
    ['live', 'simulator'].includes(value.mode) &&
    ['ready', 'waiting', 'paused', 'incoming', 'unavailable'].includes(value.status) &&
    Number.isInteger(value.lineageRings) &&
    value.lineageRings >= 0 &&
    value.lineageRings <= 16 &&
    (value.handoff === undefined ||
      value.handoff === null ||
      (Number.isFinite(value.serverNow) && validHandoff(value.handoff))) &&
    Array.isArray(value.marks) &&
    value.marks.length <= 160 &&
    value.approvedCount === value.marks.length &&
    value.marks.every(
      (mark) =>
        Object.keys(mark).every((k) => ['id', 'runeSvg', 'faded', 'flightText'].includes(k)) &&
        typeof mark.id === 'string' &&
        (mark.flightText === undefined || validFlightText(mark.flightText)) &&
        (mark.faded === undefined || typeof mark.faded === 'boolean') &&
        /^m[1-9]\d{0,8}$/.test(mark.id) &&
        typeof mark.runeSvg === 'string' &&
        mark.runeSvg.length < 1024,
    )
  );
}

// Closed presentation options; shared with HTTP query validation.
export function overlayOptions(search = '', userAgent = '') {
  const params = new URLSearchParams(search);
  const rules = {
    layout: /^(card|full|corner)$/,
    pos: /^(bl|br|tl|tr)$/,
    scale: /^(?:0\.\d{1,3}|1(?:\.\d{1,3})?)$/,
    corner: /^1$/,
    sound: /^[01]$/,
    obs: /^1$/,
    preview: /^arrival$/,
  };
  for (const [key, value] of params)
    if (!rules[key]?.test(value) || params.getAll(key).length !== 1)
      throw Error('Invalid overlay options');
  if (params.has('corner') && params.has('layout') && params.get('layout') !== 'corner')
    throw Error('Conflicting overlay layout');
  const scale = Number(params.get('scale') ?? 1);
  if (!Number.isFinite(scale) || scale < 0.75 || scale > 1.5) throw Error('Invalid overlay scale');
  return Object.freeze({
    layout: params.get('layout') ?? (params.has('corner') ? 'corner' : 'card'),
    pos: params.get('pos') ?? 'bl',
    scale,
    obs: params.get('obs') === '1' || /obsstudio|obs studio|obs\/\d/i.test(userAgent),
    preview: params.get('preview') === 'arrival',
  });
}
export function overlayArrival(snapshot, time) {
  const h = snapshot?.handoff;
  if (
    !['ready', 'incoming', 'waiting'].includes(snapshot?.status) ||
    !h ||
    !validHandoff(h) ||
    h.clockPolicy !== 'landing-v2' ||
    h.completed ||
    snapshot.claimMeter?.awaitingRaid ||
    !Number.isFinite(time) ||
    time < h.startedAt ||
    time >= h.endsAt
  )
    return null;
  return {
    seconds: Math.ceil((h.endsAt - time) / 1000),
    remaining: (h.endsAt - time) / 180000,
    command: h.role === 'source' ? '!offer' : '!accept',
    role: h.role === 'source' ? 'Sending chat' : 'Receiving chat',
    offers: h.offers,
    accepts: h.accepts,
    threshold: h.threshold,
  };
}
export function localOverlayArrival(role, now) {
  if (!['source', 'host'].includes(role) || !Number.isFinite(now))
    throw Error('Invalid local preview');
  return {
    type: 'snapshot',
    mode: 'simulator',
    status: 'incoming',
    serverNow: now,
    revision: 0,
    lineageRings: 0,
    approvedCount: 0,
    marks: [],
    handoff: {
      role,
      clockPolicy: 'landing-v2',
      startedAt: now,
      claimStartedAt: now,
      endsAt: now + 180000,
      offers: 0,
      accepts: 0,
      threshold: 2,
      completed: false,
    },
  };
}
export function acceptedOverlayPreview(event, parent, origin) {
  const value = event?.data;
  return (
    parent &&
    parent !== globalThis.window &&
    event.source === parent &&
    event.origin === origin &&
    value &&
    Object.keys(value).sort().join(',') === 'role,type' &&
    value.type === 'raid-relic-preview-arrival' &&
    ['source', 'host'].includes(value.role)
  );
}

export function connectOverlay({
  url,
  render,
  status,
  WebSocketImpl = WebSocket,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  windowEvents = globalThis.window,
  documentEvents = globalThis.document,
  idleMs = 600000,
  persistentRead = false,
}) {
  persistentRead = persistentRead === true;
  let socket = null,
    stopped = false,
    retry = null,
    watchdog = null,
    opening = null,
    backoff = 500,
    epoch = 0,
    idle = null,
    suspended = !persistentRead && Boolean(documentEvents?.hidden);
  const idleDelay = Number.isFinite(idleMs) && idleMs > 0 ? Math.min(idleMs, 600000) : 600000;
  const clear = () => {
    clearTimer(watchdog);
    clearTimer(opening);
    watchdog = opening = null;
  };
  function lost(own, kind = 'reconnecting') {
    if (stopped || suspended || (!persistentRead && documentEvents?.hidden) || own !== epoch)
      return;
    const old = socket;
    socket = null;
    epoch++;
    clear();
    status(kind);
    render(null);
    try {
      old?.close();
    } catch {
      /* Error/close delivery is not required for recovery. */
    }
    if (retry !== null) return;
    const ticket = setTimer(() => {
      if (retry !== ticket || stopped) return;
      clearTimer(ticket);
      retry = null;
      connect();
    }, backoff);
    retry = ticket;
    backoff = Math.min(backoff * 2, 10000);
  }
  function connect() {
    if (stopped || suspended || (!persistentRead && documentEvents?.hidden) || socket) return;
    const own = ++epoch;
    let revision = -1;
    status('connecting');
    opening = setTimer(() => lost(own, 'stale'), 8000); // socket AND first valid snapshot
    let active;
    try {
      active = new WebSocketImpl(url);
      socket = active;
    } catch {
      lost(own);
      return;
    }
    const current = () => !stopped && own === epoch && socket === active;
    const alive = () => {
      if (!current()) return;
      clearTimer(watchdog);
      watchdog = setTimer(() => lost(own, 'stale'), 35000);
    };
    active.onopen = alive;
    active.onmessage = (event) => {
      if (!current()) return;
      if (typeof event.data !== 'string' || event.data.length > 131072) {
        lost(own);
        return;
      }
      let value;
      try {
        value = JSON.parse(event.data);
      } catch {
        lost(own);
        return;
      }
      if (value?.type === 'heartbeat') {
        alive();
        return;
      }
      if (!validSnapshot(value)) {
        lost(own);
        return;
      }
      clearTimer(opening);
      opening = null;
      alive();
      if (value.revision <= revision) return;
      revision = value.revision;
      backoff = 500;
      status('connected');
      render(value);
    };
    active.onerror = () => lost(own);
    active.onclose = () => lost(own);
  }
  function suspend() {
    suspended = true;
    epoch++;
    clearTimer(idle);
    idle = null;
    clearTimer(retry);
    retry = null;
    clear();
    const old = socket;
    socket = null;
    render(null);
    status('suspended');
    try {
      old?.close();
    } catch {}
  }
  function armIdle() {
    clearTimer(idle);
    if (!persistentRead) idle = setTimer(suspend, idleDelay);
  }
  const wake = (event) => {
    if (stopped || (!persistentRead && documentEvents?.hidden)) return;
    // Only visibility/focus/trusted local interaction resets the human idle window.
    if (event?.type === 'online') {
      if (suspended) return;
      if (!socket) {
        clearTimer(retry);
        retry = null;
        connect();
      }
      return;
    }
    if (['pointerdown', 'keydown'].includes(event?.type) && event.isTrusted !== true) return;
    if (event?.type === 'focus' && event.isTrusted === false) return;
    suspended = false;
    armIdle();
    if (socket) return;
    clearTimer(retry);
    retry = null;
    connect();
  };
  const visibility = () =>
    !persistentRead && documentEvents?.hidden ? suspend() : wake({ type: 'visibilitychange' });
  windowEvents?.addEventListener?.('online', wake);
  windowEvents?.addEventListener?.('focus', wake);
  documentEvents?.addEventListener?.('visibilitychange', visibility);
  documentEvents?.addEventListener?.('pointerdown', wake);
  documentEvents?.addEventListener?.('keydown', wake);
  if (suspended) {
    render(null);
    status('suspended');
  } else {
    armIdle();
    connect();
  }
  return () => {
    stopped = true;
    epoch++;
    clearTimer(idle);
    idle = null;
    clearTimer(retry);
    retry = null;
    clear();
    const old = socket;
    socket = null;
    windowEvents?.removeEventListener?.('online', wake);
    windowEvents?.removeEventListener?.('focus', wake);
    documentEvents?.removeEventListener?.('visibilitychange', visibility);
    documentEvents?.removeEventListener?.('pointerdown', wake);
    documentEvents?.removeEventListener?.('keydown', wake);
    try {
      old?.close();
    } catch {}
  };
}
