import { validFlightText } from './cinematic.js';
import { validClaimMeter } from './claim-meter.js';
export { validClaimMeter } from './claim-meter.js';
function validHandoff(h) {
  return (h.completedAt === undefined || (h.completed === true && Number.isFinite(h.completedAt) && h.completedAt >= h.startedAt && h.completedAt < h.endsAt)) && ['source', 'host'].includes(h.role) && Number.isFinite(h.startedAt) && Number.isFinite(h.endsAt)
    && (h.clockPolicy === 'preclaim-v1' ? Number.isFinite(h.claimStartedAt) && h.endsAt - h.claimStartedAt === 180000 && h.startedAt >= h.claimStartedAt && h.startedAt < h.endsAt : h.endsAt - h.startedAt === 90000) && Number.isInteger(h.threshold) && h.threshold >= 1 && h.threshold <= 10
    && [h.offers, h.accepts].every(v => Number.isInteger(v) && v >= 0 && v <= h.threshold) && typeof h.completed === 'boolean';
}
export function resonanceActive(cue, now) { return Boolean(cue && now >= cue.receivedAt && now < cue.expiresAt); }
export function validSnapshot(value) {
  return value?.type === 'snapshot' && Number.isSafeInteger(value.revision) && value.revision >= 0
    && (value.resonance === undefined || (value.resonance && Number.isFinite(value.resonance.receivedAt) && Number.isFinite(value.resonance.expiresAt) && value.resonance.expiresAt - value.resonance.receivedAt === 1200 && /^[a-f0-9]{64}$/.test(value.resonance.id)))
    && (value.claimMeter == null || (Number.isFinite(value.serverNow) && validClaimMeter(value.claimMeter)))
    && ['live', 'simulator'].includes(value.mode) && ['ready', 'waiting', 'paused', 'incoming', 'unavailable'].includes(value.status)
    && Number.isInteger(value.lineageRings) && value.lineageRings >= 0 && value.lineageRings <= 16
    && (value.handoff === undefined || value.handoff === null || (Number.isFinite(value.serverNow) && validHandoff(value.handoff))) && Array.isArray(value.marks) && value.marks.length <= 160
    && value.approvedCount === value.marks.length && value.marks.every(mark => Object.keys(mark).every(k => ['id','runeSvg','faded','flightText'].includes(k)) && typeof mark.id === 'string'
      && (mark.flightText === undefined || validFlightText(mark.flightText)) && (mark.faded === undefined || typeof mark.faded === 'boolean') && /^m[1-9]\d{0,8}$/.test(mark.id) && typeof mark.runeSvg === 'string' && mark.runeSvg.length < 1024);
}

export function connectOverlay({ url, render, status, WebSocketImpl = WebSocket, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let socket; let stopped = false; let retry; let watchdog; let backoff = 500; let revision = -1;
  const stale = () => { status('stale'); render(null); };
  const alive = () => { clearTimer(watchdog); watchdog = setTimer(() => { stale(); socket.close(); }, 35000); };
  function connect() {
    if (stopped) return;
    revision = -1; status('connecting');
    socket = new WebSocketImpl(url);
    socket.onopen = alive;
    socket.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 131072) { socket.close(); return; }
      let value; try { value = JSON.parse(event.data); } catch { socket.close(); return; }
      if (value?.type === 'heartbeat') { alive(); return; }
      if (!validSnapshot(value)) { socket.close(); return; }
      alive();
      if (value.revision <= revision) return;
      revision = value.revision; backoff = 500; status('connected'); render(value);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      clearTimer(watchdog); status('reconnecting'); render(null);
      if (!stopped) { retry = setTimer(connect, backoff); backoff = Math.min(backoff * 2, 10000); }
    };
  }
  connect();
  return () => { stopped = true; clearTimer(retry); clearTimer(watchdog); socket.close(); };
}
