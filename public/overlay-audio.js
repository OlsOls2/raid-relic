import { validSnapshot } from './overlay-client.js';

// Bounded receipt memory. Reconnect/initial reads establish a silent baseline.
export function createCueTracker() {
  let previous = null, revision = -1, serverTime = -Infinity, newestReceipt = -Infinity, claimed = false, suppressed = -Infinity;
  return snapshot => {
    if (!snapshot || snapshot.status === 'unavailable') { suppressed = Math.max(suppressed, newestReceipt); previous = null; revision = -1; serverTime = -Infinity; return null; }
    if (!validSnapshot(snapshot) || snapshot.revision <= revision || !Number.isFinite(snapshot.serverNow) || snapshot.serverNow < serverTime) return null;
    revision = snapshot.revision; serverTime = snapshot.serverNow;
    const hop = snapshot.handoff;
    const valid = hop && snapshot.serverNow >= hop.startedAt && snapshot.serverNow < hop.endsAt
      && (hop.completed ? hop.offers === hop.threshold && hop.accepts === hop.threshold && (hop.role === 'host' ? snapshot.status === 'ready' : ['ready', 'waiting'].includes(snapshot.status)) : snapshot.status === (hop.role === 'host' ? 'incoming' : 'ready'));
    if (hop && hop.startedAt < newestReceipt) return null;
    const before = previous; previous = valid ? { startedAt: hop.startedAt, role: hop.role, completed: hop.completed } : {};
    if (!valid) { suppressed = Math.max(suppressed, hop?.startedAt ?? newestReceipt); return null; }
    if (hop.startedAt <= suppressed) return null;
    const newer = hop.startedAt > newestReceipt; if (newer) claimed = false; newestReceipt = Math.max(newestReceipt, hop.startedAt);
    if (!before) { claimed ||= hop.completed; return null; }
    if (hop.startedAt === before.startedAt && hop.role === before.role) { if (!before.completed && hop.completed && !claimed) { claimed = true; return 'claim'; } return null; }
    return newer && !hop.completed && snapshot.serverNow - hop.startedAt <= 3000 ? hop.role === 'source' ? 'send' : 'arrival' : null;
  };
}

// No context is even constructed until an opted-in local gesture calls arm().
export function createOverlayAudio({ optedIn = false, AudioContextImpl = globalThis.AudioContext } = {}) {
  let context = null, armed = false, generation = 0; const active = new Set();
  function silence() {
    for (const voice of [...active]) { try { voice.oscillator.stop(); } catch {} voice.clean(); }
  }
  async function mute() { generation++; armed = false; silence(); const old = context; context = null; try { await old?.close(); } catch {} }
  return {
    async arm() {
      if (!optedIn || !AudioContextImpl) return false;
      const attempt = ++generation;
      try {
        context ??= new AudioContextImpl(); const current = context;
        await current.resume();
        if (attempt !== generation || current !== context) return false;
        armed = current.state === 'running'; return armed;
      } catch { await mute(); return false; }
    },
    cue(kind) {
      const frequencies = { send: [220, 330], arrival: [392, 523.25], claim: [440, 659.25] }[kind];
      if (!armed || context?.state !== 'running' || !frequencies) return false;
      silence(); const time = context.currentTime;
      try { for (const [i, frequency] of frequencies.entries()) {
        const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, time);
        gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.025, time + 0.025 + i * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.45); gain.gain.setValueAtTime(0, time + 0.5);
        oscillator.connect(gain); gain.connect(context.destination);
        const voice = { oscillator, clean() { oscillator.disconnect(); gain.disconnect(); active.delete(voice); } };
        active.add(voice); oscillator.onended = voice.clean; oscillator.start(time); oscillator.stop(time + 0.55);
      }
      } catch { void mute(); return false; }
      return true;
    }, silence, mute, teardown: mute,
  };
}
