import { validFlightText, validSourceLogin } from './cinematic.js';
import { validClaimMeter } from './claim-meter.js';
export { validClaimMeter } from './claim-meter.js';
function validHandoff(h) {
  return (h.sourceLogin === undefined || validSourceLogin(h.sourceLogin)) && (h.completedAt === undefined || (h.completed === true && Number.isFinite(h.completedAt) && h.completedAt >= h.startedAt && h.completedAt < h.endsAt)) && ['source', 'host'].includes(h.role) && Number.isFinite(h.startedAt) && Number.isFinite(h.endsAt)
    && (h.clockPolicy === 'preclaim-v1' ? Number.isFinite(h.claimStartedAt) && h.endsAt - h.claimStartedAt === 180000 && h.startedAt >= h.claimStartedAt && h.startedAt < h.endsAt : h.endsAt - h.startedAt === 90000) && Number.isInteger(h.threshold) && h.threshold >= 1 && h.threshold <= 10
    && [h.offers, h.accepts].every(v => Number.isInteger(v) && v >= 0 && v <= h.threshold) && typeof h.completed === 'boolean';
}
export function resonanceActive(cue, now) { return Boolean(cue && now >= cue.receivedAt && now < cue.expiresAt); }
export function validSnapshot(value) {
  return value?.type === 'snapshot' && Number.isSafeInteger(value.revision) && value.revision >= 0
    && (value.resonance === undefined || (value.resonance && Number.isFinite(value.resonance.receivedAt) && Number.isFinite(value.resonance.expiresAt) && value.resonance.expiresAt - value.resonance.receivedAt === 1200 && /^[a-f0-9]{64}$/.test(value.resonance.id)))
    && (value.claimMeter == null || (Number.isFinite(value.serverNow) && validClaimMeter(value.claimMeter)))
    && (value.movedToLogin === undefined || (value.status === 'waiting' && validSourceLogin(value.movedToLogin)))
    && ['live', 'simulator'].includes(value.mode) && ['ready', 'waiting', 'paused', 'incoming', 'unavailable'].includes(value.status)
    && Number.isInteger(value.lineageRings) && value.lineageRings >= 0 && value.lineageRings <= 16
    && (value.handoff === undefined || value.handoff === null || (Number.isFinite(value.serverNow) && validHandoff(value.handoff))) && Array.isArray(value.marks) && value.marks.length <= 160
    && value.approvedCount === value.marks.length && value.marks.every(mark => Object.keys(mark).every(k => ['id','runeSvg','faded','flightText'].includes(k)) && typeof mark.id === 'string'
      && (mark.flightText === undefined || validFlightText(mark.flightText)) && (mark.faded === undefined || typeof mark.faded === 'boolean') && /^m[1-9]\d{0,8}$/.test(mark.id) && typeof mark.runeSvg === 'string' && mark.runeSvg.length < 1024);
}

export function connectOverlay({ url, render, status, WebSocketImpl = WebSocket, setTimer = setTimeout, clearTimer = clearTimeout,
  windowEvents = globalThis.window, documentEvents = globalThis.document }) {
  let socket = null, stopped = false, retry = null, watchdog = null, opening = null, backoff = 500, epoch = 0;
  const clear = () => { clearTimer(watchdog); clearTimer(opening); watchdog = opening = null; };
  function lost(own, kind = 'reconnecting') {
    if (stopped || own !== epoch) return;
    const old = socket; socket = null; epoch++; clear(); status(kind); render(null);
    try { old?.close(); } catch { /* Error/close delivery is not required for recovery. */ }
    if (retry !== null) return;
    const ticket = setTimer(() => { if (retry !== ticket || stopped) return; clearTimer(ticket); retry = null; connect(); }, backoff);
    retry = ticket; backoff = Math.min(backoff * 2, 10000);
  }
  function connect() {
    if (stopped || socket) return;
    const own = ++epoch; let revision = -1; status('connecting');
    opening = setTimer(() => lost(own, 'stale'), 8000); // socket AND first valid snapshot
    let active;
    try { active = new WebSocketImpl(url); socket = active; } catch { lost(own); return; }
    const current = () => !stopped && own === epoch && socket === active;
    const alive = () => { if (!current()) return; clearTimer(watchdog); watchdog = setTimer(() => lost(own, 'stale'), 35000); };
    active.onopen = alive;
    active.onmessage = event => {
      if (!current()) return;
      if (typeof event.data !== 'string' || event.data.length > 131072) { lost(own); return; }
      let value; try { value = JSON.parse(event.data); } catch { lost(own); return; }
      if (value?.type === 'heartbeat') { alive(); return; }
      if (!validSnapshot(value)) { lost(own); return; }
      clearTimer(opening); opening = null; alive();
      if (value.revision <= revision) return;
      revision = value.revision; backoff = 500; status('connected'); render(value);
    };
    active.onerror = () => lost(own);
    active.onclose = () => lost(own);
  }
  const wake = () => {
    if (stopped || socket || documentEvents?.hidden) return;
    clearTimer(retry); retry = null; connect();
  };
  windowEvents?.addEventListener?.('online', wake); documentEvents?.addEventListener?.('visibilitychange', wake);
  connect();
  return () => { stopped = true; epoch++; clearTimer(retry); retry = null; clear(); const old = socket; socket = null;
    windowEvents?.removeEventListener?.('online', wake); documentEvents?.removeEventListener?.('visibilitychange', wake);
    try { old?.close(); } catch {} };
}
