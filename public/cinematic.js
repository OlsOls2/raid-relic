import { keeperNames } from './keeper-network.js';
import { validClaimMeter } from './claim-meter.js';
// Pure receipt/claim-time presentation. No ownership mutation or Twitch timing.
const emoji =
  /^(?:\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*)$|^\p{Regional_Indicator}{2}$|^[0-9#*]\uFE0F?\u20E3$/u;
export function validFlightText(text) {
  return (
    typeof text === 'string' &&
    [...text].length > 0 &&
    [...text].length <= 40 &&
    text === text.normalize('NFKC') &&
    (/^\p{L}[\p{L}\p{M}]*$/u.test(text) || emoji.test(text)) &&
    !/[<>\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]|:\/\/|www\./iu.test(text.replaceAll('\u200d', ''))
  );
}
export function sourceCharge(snapshot, now, reduced = false) {
  const meter = snapshot?.claimMeter;
  const active =
    !reduced &&
    snapshot?.status === 'ready' &&
    !snapshot.handoff &&
    validClaimMeter(meter) &&
    meter.awaitingRaid === true &&
    meter.endsAt - meter.startedAt === 180000 &&
    Number.isFinite(now) &&
    now >= meter.startedAt &&
    now < meter.endsAt;
  return {
    charge: Boolean(active),
    chargeLevel: active ? Math.max(0, Math.min(1, (now - meter.startedAt) / 180000)) : 0,
  };
}
export const FUSION_TIMING = Object.freeze({ rise: 250, hold: 3000, fall: 400, duration: 3650 });
export function fusionEnvelope(elapsed) {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= FUSION_TIMING.duration) return 0;
  return elapsed < FUSION_TIMING.rise
    ? elapsed / FUSION_TIMING.rise
    : elapsed < FUSION_TIMING.rise + FUSION_TIMING.hold
      ? 1
      : 1 - (elapsed - FUSION_TIMING.rise - FUSION_TIMING.hold) / FUSION_TIMING.fall;
}
export function cinematicPhase(snapshot, now, { reduced = false, fresh = false } = {}) {
  const hop = snapshot?.handoff,
    valid = hop && now >= hop.startedAt && now < hop.endsAt;
  const active = valid && ['ready', 'incoming', 'waiting'].includes(snapshot.status);
  const elapsed = active ? now - hop.startedAt : -1;
  const host = active && hop.role === 'host';
  const fusionAt =
    host && hop.completed && Number.isFinite(hop.completedAt)
      ? Math.max(hop.startedAt + 20000, hop.completedAt)
      : null;
  const fusion =
    !reduced &&
    fresh &&
    fusionAt !== null &&
    now >= fusionAt &&
    now < fusionAt + FUSION_TIMING.duration
      ? Math.min(1, (now - fusionAt) / FUSION_TIMING.rise)
      : null;
  return {
    elapsed,
    host: Boolean(host),
    ...sourceCharge(snapshot, now, reduced),
    comet: !reduced && host && elapsed < 3000 ? elapsed / 3000 : null,
    flash:
      !reduced && fresh && host && elapsed >= 3000 && elapsed < 3700
        ? 0.45 * Math.sin((Math.PI * (elapsed - 3000)) / 700)
        : 0,
    shock:
      !reduced && fresh && host && elapsed >= 3000 && elapsed < 4400
        ? (elapsed - 3000) / 1400
        : null,
    shake:
      !reduced && fresh && host && elapsed >= 3000 && elapsed < 3300
        ? 3 * Math.sin((elapsed - 3000) * 0.025) * (1 - (elapsed - 3000) / 300)
        : 0,
    release:
      !reduced && fresh && active && hop.role === 'source' && elapsed < 600 ? elapsed / 600 : null,
    unfurl:
      !reduced && host && elapsed >= 5000 && elapsed < 20000 ? (elapsed - 5000) / 15000 : null,
    fusion,
    fusionAt,
    fusionGlow: fusion === null ? 0 : fusionEnvelope(now - fusionAt),
  };
}
export function wordBatch(marks, phase, reduced = false) {
  const approved = marks
    .slice(0, 160)
    .map((mark, index) => ({ mark, index }))
    .filter((item) => validFlightText(item.mark.flightText));
  if (!phase.host) return [];
  if (reduced) return approved.slice(0, 8).map((item) => ({ ...item, progress: 1 }));
  if (phase.unfurl === null || !approved.length) return [];
  const batches = Math.ceil(Math.min(160, marks.length) / 8),
    step = phase.unfurl * batches;
  const batch = Math.min(batches - 1, Math.floor(step));
  return approved
    .filter((item) => item.index >= batch * 8 && item.index < batch * 8 + 8)
    .map((item) => ({ ...item, progress: step - batch }));
}
// Cold reads/reconnects seek visually but cannot replay a flash or chord.
export function createCinemaTracker() {
  let baseline = false,
    receipt = -Infinity,
    fresh = false,
    played = false,
    completionFresh = false,
    departurePlayed = false,
    previousCompleted = false,
    suppressed = -Infinity;
  return {
    observe(snapshot) {
      if (!snapshot || snapshot.status === 'unavailable') {
        suppressed = Math.max(suppressed, receipt);
        baseline = false;
        fresh = false;
        completionFresh = false;
        played = true;
        departurePlayed = true;
        return;
      }
      const hop = snapshot.handoff;
      if (hop && hop.startedAt > receipt) {
        fresh =
          baseline &&
          hop.startedAt > suppressed &&
          snapshot.serverNow >= hop.startedAt &&
          snapshot.serverNow - hop.startedAt <= 3000;
        receipt = hop.startedAt;
        departurePlayed = !fresh;
        completionFresh = fresh && hop.completed;
        played = !completionFresh;
        previousCompleted = hop.completed;
      } else if (
        hop &&
        hop.startedAt === receipt &&
        !previousCompleted &&
        hop.completed &&
        baseline &&
        hop.startedAt > suppressed
      ) {
        completionFresh = true;
        played = false;
      }
      if (hop) previousCompleted = hop.completed;
      baseline = true;
    },
    pending(snapshot, now, reduced = false) {
      const p = cinematicPhase(snapshot, now);
      return (
        completionFresh &&
        !reduced &&
        p.fusionAt !== null &&
        now < p.fusionAt + FUSION_TIMING.duration
      );
    },
    frame(snapshot, now, { reduced = false, hidden = false } = {}) {
      const phase = cinematicPhase(snapshot, now, { reduced, fresh });
      const completedPhase = cinematicPhase(snapshot, now, { reduced, fresh: completionFresh });
      phase.fusion = completedPhase.fusion;
      phase.fusionGlow = completedPhase.fusionGlow;
      let chord = false;
      if (!played && phase.fusionAt !== null && now >= phase.fusionAt) {
        played = true;
        chord = !reduced && !hidden && now - phase.fusionAt < 500;
      }
      let send = false;
      if (!departurePlayed && phase.release !== null) {
        departurePlayed = true;
        send =
          snapshot.handoff.completed &&
          !reduced &&
          !hidden &&
          now - snapshot.handoff.startedAt < 500;
      }
      return {
        ...phase,
        fusionPending:
          completionFresh &&
          !reduced &&
          phase.fusionAt !== null &&
          now < phase.fusionAt + FUSION_TIMING.duration,
        chord,
        send,
      };
    },
  };
}

// Shared normalized screen pose: the real GL sprite and SVG glyph use this same
// trajectory; word labels anchor below it without creating a second glyph.
export function runePose(index, count, time, unfurl = 1) {
  const flight = Math.max(
    0,
    Math.min(1, unfurl * Math.ceil(Math.min(160, count) / 8) - Math.floor(index / 8)),
  );
  const angle = time * 0.00016 + index * 2.399963;
  const radius = Math.min(42, 30 + (index % 3) * 5 + (1 - flight) * 12);
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius, flight };
}

// Fixed local decorative geometry; never marks, viewer content or archive data.
export const validSourceLogin = (value) => Object.values(keeperNames).includes(value);
export function ambientSigils(snapshot, phase, reduced = false) {
  return !reduced &&
    phase.host &&
    phase.unfurl !== null &&
    snapshot?.marks?.length === 0 &&
    validSourceLogin(snapshot.handoff?.sourceLogin)
    ? 6
    : 0;
}
export function decorativePoints(index) {
  const n = 3 + (index % 6);
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = (i * Math.PI) / n - Math.PI / 2,
      r = i % 2 ? 9 : 23;
    return `${(32 + Math.cos(a) * r).toFixed(2)},${(32 + Math.sin(a) * r).toFixed(2)}`;
  }).join(' ');
}
