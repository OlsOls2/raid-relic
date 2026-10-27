import { keeperNames } from './keeper-network.js';
import { selectEdition, FAN_DISCLAIMER } from './editions.js';
export const CARD_WIDTH = 1200,
  CARD_HEIGHT = 630,
  CARD_MAX_BYTES = 512 * 1024;
// Closed recorded metadata and validated approved engraving text only; never supplied SVG, HTML or participant identities.
export function ringCardModel(value, options = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((k) => !['mode', 'now', 'kind', 'share'].includes(k))
  )
    throw Error('Card options');
  const { mode = 'live', now = Date.now(), kind } = options;
  if (kind !== undefined && kind !== 'wander') throw Error('Card journey kind');
  if (!['live', 'simulator', 'demo'].includes(mode)) throw Error('Card mode');
  const demo = mode === 'demo',
    simulated = mode !== 'live';
  if (!value || Object.keys(value).sort().join(',') !== 'claimedAt,keeper,ringIndex,stopId')
    throw Error('Card metadata');
  const { keeper, ringIndex, claimedAt, stopId } = value;
  if (
    !Number.isInteger(ringIndex) ||
    ringIndex < (demo ? 0 : 1) ||
    ringIndex > 16 ||
    typeof keeper !== 'string' ||
    !(demo ? /^@demo_keeper_[ab]$/ : /^@[a-z0-9_]{1,25}$/).test(keeper)
  )
    throw Error('Card metadata');
  if (demo ? stopId !== null : typeof stopId !== 'string' || !/^[a-f0-9]{64}$/.test(stopId))
    throw Error('Card stop');
  if (
    claimedAt !== null &&
    (!Number.isSafeInteger(claimedAt) || claimedAt < 0 || !Number.isFinite(now) || claimedAt > now)
  )
    throw Error('Card date');
  const edition = claimedAt === null ? null : selectEdition(claimedAt);
  return Object.freeze({
    keeper,
    ...(kind === 'wander' ? { kind: 'wander' } : {}),
    ringIndex,
    stopId,
    mode,
    simulated,
    edition,
    ...(options.share === undefined
      ? {}
      : {
          share: shareCardModel(options.share, { keeper, ringIndex, stopId, claimedAt, demo, now }),
        }),
    dateCaption:
      claimedAt === null
        ? 'Completion time unavailable'
        : new Date(claimedAt).toLocaleString('en-GB', {
            timeZone: 'UTC',
            dateStyle: 'medium',
            timeStyle: 'short',
          }) + ' UTC',
    caption: demo
      ? 'SIMULATED DEMO—no Twitch connection'
      : mode === 'simulator'
        ? kind === 'wander'
          ? 'SIMULATOR—wandered; no raid or audience transfer'
          : 'SIMULATOR—mock recorded stop; no real Twitch'
        : kind === 'wander'
          ? 'Wandered — no raid or audience transfer · Ring ' + ringIndex
          : 'Recorded completion · Ring ' + ringIndex,
    editionCaption:
      (demo
        ? 'Demo cosmetic edition: '
        : kind === 'wander'
          ? mode === 'simulator'
            ? 'Edition at mock Wander transfer: '
            : 'Edition at Wander transfer: '
          : mode === 'simulator'
            ? 'Edition at mock completion: '
            : 'Edition at recorded completion: ') + (edition?.name ?? 'Base'),
    disclaimer: edition ? FAN_DISCLAIMER : '',
  });
}
export async function ringCardPNG(model) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  try {
    const c = canvas.getContext('2d');
    if (!c) throw Error('Canvas unavailable');
    const p = model.edition?.design.palette ?? ['#101d30', '#dce4ed', '#9486b7', '#e6bb70'];
    c.fillStyle = p[0];
    c.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    c.strokeStyle = p[3];
    c.lineWidth = 3;
    c.strokeRect(24, 24, 1152, 582);
    c.save();
    c.translate(300, 300);
    const facets = model.edition?.design.facets ?? 6,
      aspect = model.edition?.design.aspect ?? 1;
    for (let i = 0; i < facets; i++) {
      const point = (n) => {
          const a = -Math.PI / 2 + (n * Math.PI * 2) / facets;
          return [(Math.cos(a) * 115) / aspect, Math.sin(a) * 180];
        },
        a = point(i),
        b = point(i + 1);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(...a);
      c.lineTo(...b);
      c.closePath();
      c.fillStyle = p[1 + (i % 3)];
      c.fill();
      c.strokeStyle = p[3];
      c.lineWidth = 2;
      c.stroke();
    }
    for (let i = 0; i < model.ringIndex; i++) {
      c.beginPath();
      c.ellipse(0, (i - 7.5) * 8, 140 + i * 2, 22 + i, -0.18, 0, Math.PI * 2);
      c.strokeStyle = p[3];
      c.lineWidth = 3;
      c.stroke();
    }
    c.restore();
    const text = (s, x, y, size, color = p[1]) => {
      c.font = `${size}px system-ui`;
      c.fillStyle = color;
      c.fillText(s, x, y, 650);
    };
    if (model.share) {
      text('RAID RELIC', 510, 85, 32, p[3]);
      text('Keeper at this stop: ' + model.keeper, 510, 130, 26);
      text('Current holder at export: ' + (model.share.holder ?? 'not recorded'), 510, 171, 23);
      text(
        `Ring ${model.ringIndex} at this stop · ${model.share.hops} retained completed hops`,
        510,
        208,
        20,
      );
      text('Approved community engravings', 510, 249, 20, p[3]);
      for (const [i, word] of model.share.engravings.entries()) {
        const x = 535 + (i % 4) * 155,
          y = 286 + Math.floor(i / 4) * 69;
        await drawEngraving(c, word, x, y);
      }
      text(
        `${model.share.engravings.length} of ${model.share.totalEngravings} approved engravings shown`,
        510,
        418,
        17,
      );
      text(model.editionCaption, 510, 447, 16);
      text(model.dateCaption, 510, 472, 15);
      if (model.disclaimer)
        text('Unofficial fan edition; not endorsed by Twitch/TwitchCon.', 510, 496, 14);
      const route = model.share.route.slice(-6);
      text(
        `Retained journey from ${route[0].from} · ${route.length} of ${model.share.hops} stops shown${model.share.hops > 6 ? ' · earlier stops omitted' : ''}`,
        60,
        523,
        17,
        p[3],
      );
      c.strokeStyle = p[3];
      c.lineWidth = 2;
      for (const [i, stop] of route.entries()) {
        const x = 70 + i * 182,
          y = 553;
        if (i) {
          c.beginPath();
          c.moveTo(x - 170, y);
          c.lineTo(x, y);
          c.stroke();
        }
        c.beginPath();
        c.arc(x, y, 5, 0, Math.PI * 2);
        c.stroke();
        c.font = '14px system-ui';
        c.fillStyle = p[1];
        c.fillText(`${stop.ringIndex} ${stop.to}`, x - 12, y + 25, 172);
        if (stop.kind === 'wander') c.fillText('Wander · no raid', x - 12, y + 42, 172);
      }
      text(model.caption + ' · Saved downloads cannot be recalled.', 60, 615, 14, p[3]);
    } else {
      text('RAID RELIC', 510, 150, 38, p[3]);
      text(model.keeper, 510, 225, 38);
      text('Ring ' + model.ringIndex, 510, 285, 34);
      text(model.caption, 70, 535, 24, p[3]);
      text(model.editionCaption, 510, 345, 22);
      if (model.disclaimer) {
        text('Unofficial fan edition; not affiliated with or', 510, 400, 18);
        text('endorsed by Twitch/TwitchCon.', 510, 426, 18);
      }
      text(model.dateCaption, 510, 470, 18);
      text('Saved downloads cannot be recalled after erasure.', 70, 580, 18);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.type !== 'image/png' || blob.size > CARD_MAX_BYTES)
      throw Error('Card encoding');
    return blob;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
export function ringCardFilename(ringIndex, keeper) {
  if (
    !Number.isInteger(ringIndex) ||
    ringIndex < 1 ||
    ringIndex > 16 ||
    typeof keeper !== 'string' ||
    keeper !== keeper.trim() ||
    !/^@[a-z0-9_]{1,25}$/i.test(keeper)
  )
    throw Error('Card filename');
  return `raid-relic-stop-${ringIndex}-${keeper.slice(1).toLowerCase()}.png`;
}
export function demoCardFilename(ringIndex) {
  if (!Number.isInteger(ringIndex) || ringIndex < 1 || ringIndex > 16)
    throw Error('Demo card filename');
  return `raid-relic-demo-ring-${ringIndex}.png`;
}
export function validRingCardFilename(filename, simulated = false) {
  return (
    typeof filename === 'string' &&
    filename === filename.trim() &&
    (/^raid-relic-(?:wander-)?stop-(?:[1-9]|1[0-6])-[a-z0-9_]{1,25}[.]png$/.test(filename) ||
      /^raid-relic-keeper-[a-z0-9_]{1,25}-(?:wander-)?ring-(?:[1-9]|1[0-6])-(?:landscape|vertical)[.]png$/.test(
        filename,
      ) ||
      (simulated === true && /^raid-relic-demo-ring-(?:[1-9]|1[0-6])[.]png$/.test(filename)))
  );
}
export function saveRingCard(blob, simulated = false, filename = null) {
  if (filename !== null && !validRingCardFilename(filename, simulated))
    throw Error('Card filename');
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download =
    filename ?? (simulated ? 'raid-relic-simulated-ring.png' : 'raid-relic-recorded-ring.png');
  try {
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
const keeperLabel = (value) =>
  typeof value === 'string' &&
  value[0] === '@' &&
  Object.values(keeperNames).includes(value.slice(1));
const exactKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Object.getOwnPropertySymbols(value).length === 0 &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export function approvedCardWord(value) {
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).length > 128 ||
    [...segmenter.segment(value)].length > 40 ||
    [...value].length > 32 ||
    /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  )
    return false;
  if (value !== value.normalize('NFKC').toLowerCase().replaceAll('ß', 'ss').replaceAll('ς', 'σ'))
    return false;
  const word =
    /^\p{L}[\p{L}\p{M}]*$/u.test(value) &&
    !['fuck', 'shit', 'nazi', 'porn', 'kill', 'suicide', 'https', 'www'].some((term) =>
      value.includes(term),
    );
  const emoji =
    /^(?:\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*)$|^\p{Regional_Indicator}{2}$|^[0-9#*]\uFE0F?\u20E3$/u.test(
      value,
    ) && [...segmenter.segment(value)].length === 1;
  return Boolean(value && (word || emoji));
}
export function shareCardModel(value, recorded) {
  if (
    recorded.demo ||
    !exactKeys(value, ['holder', 'hops', 'route', 'engravings', 'totalEngravings']) ||
    (value.holder !== null && !keeperLabel(value.holder)) ||
    !Number.isInteger(value.hops) ||
    value.hops < 1 ||
    value.hops > 16 ||
    !Array.isArray(value.route) ||
    value.route.length !== value.hops ||
    !Array.isArray(value.engravings) ||
    value.engravings.length > 8 ||
    !value.engravings.every(approvedCardWord) ||
    !Number.isInteger(value.totalEngravings) ||
    value.totalEngravings < value.engravings.length ||
    value.totalEngravings > 160
  )
    throw Error('Share metadata');
  let previous = -1;
  const seen = new Set();
  for (const [i, stop] of value.route.entries()) {
    if (
      !exactKeys(stop, ['stopId', 'from', 'to', 'ringIndex', 'claimedAt', 'kind']) ||
      !/^[a-f0-9]{64}$/.test(stop.stopId) ||
      seen.has(stop.stopId) ||
      !keeperLabel(stop.from) ||
      !keeperLabel(stop.to) ||
      stop.from === stop.to ||
      stop.ringIndex !== i + 1 ||
      !Number.isSafeInteger(stop.claimedAt) ||
      stop.claimedAt < previous ||
      stop.claimedAt > recorded.now ||
      !['raid', 'wander'].includes(stop.kind) ||
      (i && value.route[i - 1].to !== stop.from)
    )
      throw Error('Share route');
    seen.add(stop.stopId);
    previous = stop.claimedAt;
  }
  const stop = value.route[recorded.ringIndex - 1];
  if (
    !stop ||
    stop.stopId !== recorded.stopId ||
    stop.to !== recorded.keeper ||
    stop.claimedAt !== recorded.claimedAt ||
    (value.holder !== null && value.holder !== value.route.at(-1).to)
  )
    throw Error('Share association');
  return Object.freeze({
    ...value,
    route: Object.freeze(value.route.map((s) => Object.freeze({ ...s }))),
    engravings: Object.freeze([...value.engravings]),
  });
}
async function drawEngraving(c, word, x, y) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode('raid-relic-rune-v1:' + word)),
  );
  c.save();
  c.translate(x, y);
  c.scale(0.4, 0.4);
  c.strokeStyle = ['#e6bb70', '#9e87ed', '#70c9bd', '#dd93b3'][(bytes[16] >> 4) % 4];
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(0, -42);
  c.lineTo(42, 0);
  c.lineTo(0, 42);
  c.lineTo(-42, 0);
  c.closePath();
  c.stroke();
  c.lineWidth = 4;
  c.lineCap = c.lineJoin = 'round';
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = 16 + (bytes[i] % 5) * 16 - 48,
      b = 16 + (bytes[i + 8] % 5) * 16 - 48;
    if (i) c.lineTo(a, b);
    else c.moveTo(a, b);
  }
  c.stroke();
  c.restore();
  c.font = '16px system-ui';
  c.fillStyle = '#dce4ed';
  c.fillText(word, x - 22, y + 30, 140);
}
