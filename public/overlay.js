import { keeperNames as networkNames } from './keeper-network.js';
import { streakText } from './streak-view.js';
import { presentEdition } from './edition-view.js';
import {
  createCinemaTracker,
  wordBatch,
  runePose,
  ambientSigils,
  decorativePoints,
  validSourceLogin,
} from './cinematic.js';
import { createRelic3D, ringSummary } from './relic3d.js';
import { meterProgress } from './claim-meter.js';
import { createOverlayAudio, createCueTracker } from './overlay-audio.js';
import { arrivalPhase } from './arrival.js';
import {
  connectOverlay,
  resonanceActive,
  overlayOptions,
  overlayArrival,
  localOverlayArrival,
  acceptedOverlayPreview,
} from './overlay-client.js';
// Avoid replacing live-region text nodes on every animation frame.
const updateText = (selector, value) => {
  const node = document.querySelector(selector);
  if (node.textContent !== value) node.textContent = value;
};
// Optional public completed-stop projection only. Current stream marks are not
// evidence of what was carried; absence/invalidity never means zero carried.
export function carriedRuneLabel(handoff) {
  if (
    handoff?.clockPolicy !== 'landing-v2' ||
    handoff.completed !== true ||
    !Number.isFinite(handoff.startedAt) ||
    !Number.isFinite(handoff.endsAt) ||
    !Number.isFinite(handoff.completedAt) ||
    handoff.completedAt < handoff.startedAt ||
    handoff.completedAt >= handoff.endsAt ||
    !Number.isInteger(handoff.carriedApprovedCount) ||
    handoff.carriedApprovedCount < 0 ||
    handoff.carriedApprovedCount > 160
  )
    return null;
  return handoff.carriedApprovedCount === 0
    ? 'No approved runes carried'
    : `${handoff.carriedApprovedCount} approved runes carried`;
}
// Supplementary description never replaces ring/streak/approved-count text.
// Tight card/corner layouts use this accessible description, without adding a
// visual line that would overflow their fixed plate. Full mode shares the same
// non-disruptive description; existing title/aria-label semantics stay intact.
export function presentCarriedSummary(summary, counters, label) {
  summary.textContent = label ?? '';
  summary.hidden = label === null;
  for (const counter of counters) {
    const ids = (counter.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const next = ids.filter((id) => id !== summary.id);
    if (label !== null) next.push(summary.id);
    if (next.length) counter.setAttribute('aria-describedby', next.join(' '));
    else counter.removeAttribute('aria-describedby');
  }
}
const channel = /^\/overlay\/(\d{1,32})$/.exec(location.pathname)?.[1];
const echoNote = document.createElement('span');
echoNote.className = 'echo-note';
echoNote.setAttribute('role', 'status');
document.querySelector('.archive').append(echoNote);
const runes = document.querySelector('#runes');
const state = document.querySelector('#status');
const count = document.querySelector('#count');
const carriedSummary = document.createElement('span');
carriedSummary.id = 'carried-summary';
carriedSummary.hidden = true;
carriedSummary.className = 'carried-summary';
count.parentElement.append(carriedSummary);

const holderLink = document.createElement('a');
holderLink.id = 'holder-link';
holderLink.href = '/atlas/';
holderLink.textContent = ' View the journey';
const options = overlayOptions(location.search, navigator.userAgent);
document.body.classList.add('layout-' + options.layout, 'pos-' + options.pos);
document.body.classList.toggle('corner', options.layout === 'corner');
document.body.dataset.obs = String(options.obs);
// Full defaults retain the historical centred composition; only explicit pos opts out.
if (options.layout === 'full' && new URLSearchParams(location.search).has('pos'))
  document.body.dataset.fullPosition = 'true';
const fitOverlay = () => {
  const fit = Math.min(innerWidth / 1920, innerHeight / 1080);
  document.body.style.setProperty('--overlay-scale', String(options.scale * fit));
  // Full mode uses its original responsive CSS, without FHD fitting or safe-area shrink.
  document.body.style.setProperty('--overlay-requested-scale', String(options.scale));
  document.body.style.setProperty('--overlay-safe', `${48 * fit}px`);
  document.body.style.setProperty(
    '--corner-safe',
    `${Math.min(innerWidth, innerHeight) <= 256 ? 0 : 48 * fit}px`,
  );
  document.body.style.setProperty(
    '--corner-scale',
    String(Math.min(options.scale, innerWidth / 160, innerHeight / 160)),
  );
};
fitOverlay();
addEventListener('resize', fitOverlay);
const audio = createOverlayAudio({
  optedIn: new URLSearchParams(location.search).get('sound') === '1',
});
const cueFor = createCueTracker();
const cinema = createCinemaTracker();
const archiveNode = document.querySelector('.archive');
const effect = (name) => {
  const node = document.createElement('div');
  node.className = `p3-${name}`;
  node.hidden = true;
  node.setAttribute('aria-hidden', 'true');
  (options.layout !== 'full' || !['comet', 'flash', 'shock'].includes(name)
    ? archiveNode
    : document.body
  ).append(node);
  return node;
};
const effects = Object.fromEntries(
  ['comet', 'flash', 'shock', 'release', 'fusion'].map((name) => [name, effect(name)]),
);
const ns = 'http://www.w3.org/2000/svg';
const fusionSVG = document.createElementNS(ns, 'svg');
fusionSVG.setAttribute('viewBox', '0 0 120 120');
const fusionArcs = ['offer', 'accept', 'ring'].map((name) => {
  const c = document.createElementNS(ns, 'circle');
  c.setAttribute('cx', '60');
  c.setAttribute('cy', '60');
  c.setAttribute('r', '59');
  c.classList.add(`p3-fuse-${name}`);
  fusionSVG.append(c);
  return c;
});
effects.fusion.append(fusionSVG);
const ringPips = document.createElement('div');
ringPips.className = 'ring-pips';
ringPips.setAttribute('aria-label', 'Completed rings');
document.querySelector('.relic-overlay').append(ringPips);
const words = Array.from({ length: 8 }, () => {
  const word = document.createElement('span');
  word.className = 'p3-word';
  word.hidden = true;
  archiveNode.append(word);
  return word;
});
const ambient = Array.from({ length: 6 }, (_, i) => {
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.classList.add('p31-decorative');
  svg.dataset.decorative = 'true';
  svg.setAttribute('aria-hidden', 'true');
  svg.hidden = true;
  svg.setAttribute('hidden', '');
  const polygon = document.createElementNS(ns, 'polygon');
  polygon.setAttribute('points', decorativePoints(i));
  svg.append(polygon);
  archiveNode.append(svg);
  return svg;
});
const sourceCaption = document.createElement('p');
sourceCaption.className = 'p31-source';
sourceCaption.hidden = true;
archiveNode.after(sourceCaption);
function clearCinema() {
  for (const node of [...Object.values(effects), ...words, ...ambient, sourceCaption]) {
    node.hidden = true;
    if (node.classList.contains('p3-word')) node.textContent = '';
    if (node.classList.contains('p31-decorative')) node.setAttribute('hidden', '');
  }
  sourceCaption.textContent = '';
  archiveNode.dataset.ambientCount = '0';
  archiveNode.dataset.charge = 'false';
  archiveNode.style.setProperty('--charge-level', '0');
  archiveNode.style.setProperty('--charge-alpha', '0');
  archiveNode.dataset.fusionPending = 'false';
  archiveNode.style.setProperty('--p3-shake', '0px');
}

const soundButton = document.querySelector('#sound-toggle');
soundButton.hidden = new URLSearchParams(location.search).get('sound') !== '1';
soundButton.onclick = async (event) => {
  if (!event.isTrusted) return;
  if (soundButton.getAttribute('aria-pressed') === 'true') {
    await audio.mute();
    soundButton.setAttribute('aria-pressed', 'false');
    soundButton.textContent = 'Sound';
    soundButton.setAttribute('aria-label', 'Enable optional overlay sounds');
  } else {
    const enabled = await audio.arm();
    soundButton.setAttribute('aria-pressed', String(enabled));
    soundButton.textContent = enabled ? 'Mute' : 'Sound';
    soundButton.setAttribute(
      'aria-label',
      enabled
        ? 'Mute overlay sounds'
        : 'Enable optional overlay sounds; browser permission required',
    );
  }
};
addEventListener('pagehide', () => {
  audio.teardown();
  cueFor(null);
  soundButton.setAttribute('aria-pressed', 'false');
  soundButton.textContent = 'Sound';
  soundButton.setAttribute('aria-label', 'Enable optional overlay sounds');
});
let current = null;
let activityAt = performance.now(),
  activityKey = null;
let disconnectOverlay = null;
let receivedAt = 0;
let receiptServerTime = 0;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let relic3d,
  relic3dClosed = false;
let relic3dAbort = new AbortController(),
  relic3dEpoch = 0;
function loadRelicView() {
  const own = ++relic3dEpoch;
  relic3dAbort.abort();
  relic3dAbort = new AbortController();
  createRelic3D({
    signal: relic3dAbort.signal,
    archive: document.querySelector('.archive'),
    reducedMotion: motion,
    corner: options.layout !== 'full',
  }).then((view) => {
    if (relic3dClosed || own !== relic3dEpoch) {
      view?.dispose();
      return;
    }
    relic3d = view;
    view?.update(current);
  });
}
loadRelicView();
function syncRelicMotion() {
  relic3d?.dispose();
  relic3d = null;
  relic3dAbort.abort();
  if (!relic3dClosed) loadRelicView();
}
motion.addEventListener('change', syncRelicMotion);
addEventListener('pagehide', () => {
  clearCinema();
  relic3dClosed = true;
  relic3dAbort.abort();
  relic3d?.dispose();
});
function render(snapshot) {
  const nextActivity = snapshot
    ? `${snapshot.status}:${snapshot.approvedCount}:${snapshot.lineageRings}:${snapshot.handoff?.startedAt ?? ''}:${snapshot.handoff?.offers ?? ''}:${snapshot.handoff?.accepts ?? ''}`
    : null;
  if (nextActivity !== activityKey) {
    activityAt = performance.now();
    activityKey = nextActivity;
  }
  document.querySelector('#lineage').hidden = !snapshot?.lineageRings;
  if (options.preview) {
    document.querySelector('#simulator').hidden = false;
    document.querySelector('#simulator').textContent =
      'LOCAL TEST · fictional arrival · no live connection';
  }
  const cue = cueFor(snapshot);
  if (
    !snapshot ||
    !['ready', 'incoming', 'waiting'].includes(snapshot.status) ||
    (snapshot.status === 'waiting' && !snapshot.handoff?.completed)
  )
    audio.silence();
  cinema.observe(snapshot);
  clearCinema();
  archiveNode.dataset.fusionPending = String(
    cinema.pending(snapshot, snapshot?.serverNow ?? 0, motion.matches),
  );
  archiveNode.style.setProperty('--p3-fusion', '0');
  if (
    cue &&
    !(cue === 'claim' && snapshot?.handoff?.completedAt !== undefined) &&
    !motion.matches &&
    !document.hidden
  )
    audio.cue(cue);
  document.body.dataset.state = snapshot?.status ?? 'connecting';
  document.querySelector('#waiting-note').hidden =
    snapshot?.status !== 'waiting' || Boolean(snapshot?.movedToLogin || snapshot?.holderLogin);
  relic3d?.update(snapshot);
  current = snapshot;
  receivedAt = performance.now();
  receiptServerTime = snapshot?.serverNow ?? Date.now();
  ringPips.replaceChildren();
  for (let i = 0; i < Math.min(16, snapshot?.lineageRings ?? 0); i++) {
    const pip = document.createElement('span');
    pip.setAttribute('aria-hidden', 'true');
    ringPips.append(pip);
  }
  document.querySelector('#rings').replaceChildren();
  document.querySelector('#lineage').textContent = snapshot
    ? snapshot.mode === 'simulator'
      ? ringSummary(snapshot.lineageRings).text
      : `Ring ${snapshot.lineageRings}`
    : 'The relic rests…';
  if (snapshot?.streak) {
    const line = document.querySelector('#lineage');
    line.title = streakText(snapshot.streak);
    line.dataset.streak = snapshot.streak.known ? String(snapshot.streak.current) : 'unknown';
    line.textContent += snapshot.streak.known
      ? ` · Streak ${snapshot.streak.current}`
      : ' · Streak ?';
  } else {
    document.querySelector('#lineage').removeAttribute('data-streak');
    document.querySelector('#lineage').removeAttribute('title');
  }
  if (options.layout === 'card' && snapshot)
    document.querySelector('#lineage').textContent = `Ring ${snapshot.lineageRings}`;
  for (let i = 0; i < Math.min(16, snapshot?.lineageRings ?? 0); i++) {
    const ring = document.createElement('span');
    ring.style.inset = `${4 + i * 1.8}%`;
    document.querySelector('#rings').append(ring);
  }
  runes.replaceChildren();
  document.querySelector('#charge').style.width = '0%';
  if (!snapshot) {
    holderLink.remove();
    presentCarriedSummary(carriedSummary, [count, document.querySelector('#compact-count')], null);
    count.textContent = 'No current state';
    document.querySelector('#compact-count').textContent = 'No current state';
    return;
  }
  if (!options.preview)
    document.querySelector('#simulator').textContent =
      snapshot.mode === 'simulator' ? 'SIMULATOR · local test data' : '';
  if (!options.preview) document.querySelector('#simulator').hidden = snapshot.mode !== 'simulator';
  const simulated = snapshot.mode === 'simulator';
  const messages = {
    incoming: 'The relic arrives… bind it with two chats',
    ready: 'Bound by two chats',
    paused: 'The Keeper has paused the ritual',
    waiting: snapshot.movedToLogin
      ? `The relic has moved on to @${snapshot.movedToLogin}`
      : 'The relic stirs… awaiting a Keeper',
    unavailable: 'The relic is out of sight…',
  };
  const ownLogin = networkNames[channel];
  const idleHolder =
    snapshot.holderLogin &&
    !snapshot.handoff &&
    !snapshot.claimMeter &&
    ['ready', 'waiting'].includes(snapshot.status);
  if (idleHolder)
    messages[snapshot.status] =
      snapshot.holderLogin === ownLogin
        ? `@${snapshot.holderLogin} holds the relic · Ring ${snapshot.lineageRings} · raid to pass it on`
        : snapshot.movedToLogin
          ? `The relic has moved on to @${snapshot.holderLogin} · waiting for its next raid`
          : `The relic is with @${snapshot.holderLogin} · waiting for its next raid`;
  state.textContent = snapshot.claimMeter?.awaitingRaid
    ? 'Request received · waiting for Twitch confirmation; delivery can take time. Claiming opens only after verified arrival.'
    : messages[snapshot.status];
  if (options.layout === 'card' && !snapshot.claimMeter?.awaitingRaid)
    state.textContent = snapshot.holderLogin
      ? `With @${snapshot.holderLogin}`
      : {
          ready: 'The relic is here',
          incoming: 'Claim the relic',
          waiting: 'Waiting for a Keeper',
          paused: 'Keeper paused',
          unavailable: 'State unavailable',
        }[snapshot.status];
  if (snapshot.wanderArrival)
    state.textContent = `The relic wandered here to @${ownLogin} · no raid or audience transfer. Marks require a live opted-in stream.`;
  if (idleHolder && snapshot.holderLogin !== ownLogin) state.append(holderLink);
  document.querySelector('#compact-status').textContent = snapshot.movedToLogin
    ? `Moved to @${snapshot.movedToLogin}`
    : idleHolder
      ? snapshot.holderLogin === ownLogin
        ? `@${ownLogin} holds the relic`
        : `With @${snapshot.holderLogin}`
      : {
          incoming: 'Incoming · claim pending',
          ready: 'Relic connected',
          paused: 'Marks paused',
          waiting: 'Waiting for Keeper',
          unavailable: 'State unavailable',
        }[snapshot.status];
  if (snapshot.wanderArrival)
    document.querySelector('#compact-status').textContent = 'Wandered · no raid';
  document.querySelector('#compact-count').textContent = simulated
    ? `Charge ${snapshot.approvedCount}/160 · Rings ${snapshot.lineageRings}`
    : `Ring ${snapshot.lineageRings} · ${snapshot.approvedCount} runes`;
  if (snapshot.streak) {
    const compact = document.querySelector('#compact-count');
    compact.textContent = `Ring ${snapshot.lineageRings} · S${snapshot.streak.known ? snapshot.streak.current : '?'} · ${snapshot.approvedCount} runes`;
    compact.title = streakText(snapshot.streak);
    compact.setAttribute(
      'aria-label',
      (snapshot.streak.known
        ? `${snapshot.streak.current} consecutive verified hand-offs in tracked coverage. `
        : '') +
        streakText(snapshot.streak) +
        `. Ring ${snapshot.lineageRings}; ${snapshot.approvedCount} approved runes.`,
    );
  } else {
    document.querySelector('#compact-count').removeAttribute('title');
    document.querySelector('#compact-count').removeAttribute('aria-label');
  }
  if (!simulated)
    document.querySelector('#waiting-note').textContent = snapshot.movedToLogin
      ? `The relic has moved on to @${snapshot.movedToLogin}`
      : snapshot.holderLogin === ownLogin && snapshot.marks.length
        ? 'Retained approved runes · stream activity does not grant a new claim.'
        : 'The relic stirs… a confirmed raid will light the way here.';
  count.textContent = simulated
    ? `${snapshot.approvedCount} approved marks · charge ${snapshot.approvedCount}/160`
    : `${snapshot.approvedCount} approved runes`;
  if (options.layout === 'card') count.textContent = `${snapshot.approvedCount} approved runes`;
  presentCarriedSummary(
    carriedSummary,
    [count, document.querySelector('#compact-count')],
    carriedRuneLabel(snapshot.handoff),
  );
  document.querySelector('#charge').style.width = `${(snapshot.approvedCount / 160) * 100}%`;
  document.querySelector('.charge-track').hidden = !simulated;
  snapshot.marks.forEach((mark, index) => {
    const image = document.createElement('img');
    image.className = 'rune';
    image.alt = mark.faded
      ? 'Approved carried rune, dimmed after three holder stream closures; retained, not deleted'
      : 'Approved community rune';
    if (mark.faded) image.classList.add('faded');
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mark.runeSvg)}`;
    const angle = index * 2.399963;
    const radius = 30 + (index % 3) * 5;
    image.style.setProperty('--x', `${Math.cos(angle) * radius}%`);
    image.style.setProperty('--y', `${Math.sin(angle) * radius}%`);
    runes.append(image);
  });
  if (options.layout === 'full') fitOverlay();
}
let frameId = null;
if (channel && !options.preview)
  disconnectOverlay = connectOverlay({
    persistentRead: options.obs,
    url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${channel}`,
    render,
    status(value) {
      document.body.dataset.connection = value;
      if (value === 'suspended') {
        cancelAnimationFrame(frameId);
        frameId = null;
        count.textContent = 'Paused to save resources';
        document.querySelector('#compact-count').textContent = 'Focus to resume';
      } else if (
        frameId === null &&
        !document.hidden &&
        document.body.dataset.connection !== 'suspended'
      )
        frameId = requestAnimationFrame(frame);
      document.body.classList.toggle('disconnected', value !== 'connected');
      if (value !== 'connected')
        document.querySelector('#compact-status').textContent =
          value === 'suspended'
            ? 'Paused · focus to resume'
            : value === 'stale'
              ? 'State stale'
              : 'Reconnecting…';
      if (value !== 'connected')
        state.textContent = {
          connecting: 'Connecting to relic state…',
          reconnecting: 'Connection lost; reconnecting…',
          stale: 'State stale; reconnecting…',
          suspended: 'Paused to save resources—focus/interact to reconnect',
        }[value];
    },
  });

const previewMessage = (event) => {
  if (acceptedOverlayPreview(event, parent, location.origin))
    render(localOverlayArrival(event.data.role, Date.now()));
};
if (options.preview) {
  document.body.dataset.connection = 'local-test';
  render(localOverlayArrival('host', Date.now()));
  addEventListener('message', previewMessage);
  // Local listener readiness only: never a live connection or game-readiness claim.
  document.body.dataset.localPreviewReady = 'true';
}
addEventListener('pagehide', () => {
  disconnectOverlay?.();
  disconnectOverlay = null;
  removeEventListener('resize', fitOverlay);
  removeEventListener('message', previewMessage);
  delete document.body.dataset.localPreviewReady;
  cancelAnimationFrame(frameId);
  frameId = null;
});
let lastReduced = motion.matches,
  lastHidden = document.hidden;
function frame() {
  presentEdition(archiveNode, Date.now(), { label: false });
  frameId = null;
  if (document.hidden || document.body.dataset.connection === 'suspended') return;
  if (motion.matches !== lastReduced || document.hidden !== lastHidden) {
    const motionChanged = motion.matches !== lastReduced;
    lastReduced = motion.matches;
    lastHidden = document.hidden;
    if (motionChanged) syncRelicMotion();
    else relic3d?.wake();
  }
  const echoOn = resonanceActive(
    current?.resonance,
    receiptServerTime + performance.now() - receivedAt,
  );
  document.querySelector('.archive').classList.toggle('resonating', echoOn);
  const note = echoOn
    ? 'Decorative Shared-chat echo of an approved rune; not proof of raid membership'
    : '';
  if (echoNote.textContent !== note) echoNote.textContent = note;
  const time = receiptServerTime + performance.now() - receivedAt;
  const takeover = options.layout === 'card' ? overlayArrival(current, time) : null;
  document.body.classList.toggle('arrival-takeover', Boolean(takeover));
  document.querySelector('#arrival-panel').hidden = !takeover;
  if (takeover) {
    updateText('#arrival-countdown', String(takeover.seconds));
    updateText('#arrival-action', `${takeover.role}: ${takeover.command}`);
    updateText(
      '#arrival-counts',
      `Offers ${takeover.offers}/${takeover.threshold} · Accepts ${takeover.accepts}/${takeover.threshold}`,
    );
    document.querySelector('#arrival-progress').value = takeover.remaining;
  }
  document.body.classList.toggle(
    'ring-forged',
    Boolean(
      options.layout === 'card' &&
      current?.handoff?.clockPolicy === 'landing-v2' &&
      current.handoff.completed &&
      current.handoff.completedAt &&
      time >= current.handoff.completedAt &&
      time < current.handoff.completedAt + 600,
    ),
  );
  const idleAge = performance.now() - activityAt;
  document.querySelector('#command-coach').hidden =
    options.layout !== 'card' ||
    Boolean(takeover) ||
    !current ||
    idleAge < 600000 ||
    idleAge % 600000 >= 8000;
  document.body.classList.toggle('coach-visible', !document.querySelector('#command-coach').hidden);
  if (current?.handoff && time >= current.handoff.endsAt) audio.silence();
  const meter =
    current && ['ready', 'incoming', 'waiting'].includes(current.status)
      ? current.claimMeter
      : null;
  const progress = meterProgress(meter, time);
  document.querySelector('#claim-meter').hidden = !progress;
  document.querySelector('#claim-arcs').hidden = !progress;
  document.body.classList.toggle('voting', Boolean(progress));
  if (progress) {
    document.querySelector('#offer-arc').style.strokeDashoffset = String(
      339.292 * (1 - progress.offers),
    );
    document.querySelector('#accept-arc').style.strokeDashoffset = String(
      307.876 * (1 - progress.accepts),
    );
    updateText(
      '#claim-label',
      `${meter.awaitingRaid ? (current.mode === 'simulator' ? 'Awaiting verified raid · gathering light' : 'Waiting for Twitch to confirm the raid') : current.mode === 'simulator' ? 'The raid arrived · claim the relic' : 'Bind the relic · two chats'} · ${progress.seconds}s · Offer ${meter.offers}/${meter.threshold} · Accept ${meter.accepts}/${meter.threshold}`,
    );
  } else updateText('#claim-label', '');
  const cinematic = cinema.frame(current, time, {
    reduced: motion.matches,
    hidden: document.hidden,
  });
  archiveNode.dataset.cinematicElapsed = String(Math.floor(cinematic.elapsed));
  const chargeLevel = document.hidden ? 0 : cinematic.chargeLevel;
  archiveNode.dataset.charge = String(cinematic.charge && !motion.matches && !document.hidden);
  archiveNode.style.setProperty('--charge-level', String(chargeLevel));
  archiveNode.style.setProperty('--charge-blur', `${4 + chargeLevel * 12}px`);
  archiveNode.style.setProperty('--charge-alpha', String(0.08 + chargeLevel * 0.42));
  archiveNode.style.setProperty('--p3-shake', `${cinematic.shake}px`);
  for (const [name, value] of Object.entries({
    comet: cinematic.comet,
    flash: cinematic.flash || null,
    shock: cinematic.shock,
    release: cinematic.release,
    fusion: cinematic.fusion,
  })) {
    const node = effects[name];
    node.hidden = value === null || document.hidden;
    node.style.setProperty('--p3-progress', String(value ?? 0));
    if (name === 'flash') node.style.opacity = String(value ?? 0);
  }
  const bounds = archiveNode.getBoundingClientRect();
  const corner = document.body.classList.contains('corner');
  const anchorX = corner ? bounds.width / 2 : bounds.left + bounds.width / 2;
  const anchorY = corner ? bounds.height / 2 : bounds.top + bounds.height / 2;
  const startX = corner ? 0 : innerWidth * 0.12,
    startY = corner ? 0 : innerHeight * 0.12;
  const travel = cinematic.comet ?? 1;
  effects.comet.style.left = `${startX + (anchorX - startX) * travel}px`;
  effects.comet.style.top = `${startY + (anchorY - startY) * travel}px`;
  effects.comet.style.setProperty(
    '--comet-angle',
    `${Math.atan2(anchorY - startY, anchorX - startX)}rad`,
  );
  if (!corner) {
    effects.shock.style.left = `${anchorX}px`;
    effects.shock.style.top = `${anchorY}px`;
  }
  const ambientCount = document.hidden ? 0 : ambientSigils(current, cinematic, motion.matches);
  archiveNode.dataset.ambientCount = String(ambientCount);
  const ambientEdge = ((corner ? 8 : 38) / Math.max(1, archiveNode.clientWidth)) * 100;
  for (let i = 0; i < ambient.length; i++) {
    const glyph = ambient[i];
    glyph.hidden = i >= ambientCount;
    glyph.toggleAttribute('hidden', glyph.hidden);
    if (glyph.hidden) continue;
    const pose = runePose(i, 6, performance.now(), cinematic.unfurl);
    glyph.style.left = `${Math.max(ambientEdge, Math.min(100 - ambientEdge, pose.x))}%`;
    glyph.style.top = `${Math.max(ambientEdge, Math.min(100 - ambientEdge, pose.y))}%`;
    glyph.style.opacity = String(Math.min(1, 0.35 + pose.flight));
  }
  const showSource =
    cinematic.host &&
    validSourceLogin(current?.handoff?.sourceLogin) &&
    cinematic.elapsed >= 0 &&
    cinematic.elapsed < 20000 &&
    !document.hidden;
  sourceCaption.hidden = !showSource;
  sourceCaption.textContent = showSource ? `From @${current.handoff.sourceLogin}` : '';
  archiveNode.dataset.fusionPending = String(cinematic.fusionPending);
  archiveNode.style.setProperty(
    '--p3-fusion',
    String(cinematic.fusion ?? (cinematic.fusionPending ? 0 : 1)),
  );
  const fuse = cinematic.fusion ?? 0;
  archiveNode.style.setProperty('--fusion-glow', String(cinematic.fusionGlow));
  fusionArcs[0].style.transform = `translateX(${-(1 - fuse) * 18}px)`;
  fusionArcs[1].style.transform = `translateX(${(1 - fuse) * 18}px)`;
  fusionArcs[0].style.opacity = fusionArcs[1].style.opacity = String(1 - fuse);
  fusionArcs[2].style.opacity = String(fuse);
  const ringInset = archiveNode.classList.contains('webgl-relic') ? relic3d?.ringInset?.() : null;
  effects.fusion.style.inset = `${ringInset ?? 4 + Math.max(0, Math.min(16, current?.lineageRings ?? 0) - 1) * 1.8}%`;
  const batch = wordBatch(current?.marks ?? [], cinematic, motion.matches);
  for (let i = 0; i < words.length; i++) {
    const item = batch[i],
      node = words[i];
    node.hidden = !item || document.hidden;
    if (!item) {
      node.textContent = '';
      continue;
    }
    if (node.textContent !== item.mark.flightText) node.textContent = item.mark.flightText;
    const pose = runePose(
      item.index,
      current.marks.length,
      motion.matches ? 0 : performance.now(),
      cinematic.unfurl ?? 1,
    );
    node.dataset.orbitIndex = String(item.index);
    node.style.left = `${pose.x}%`;
    node.style.top = `${pose.y}%`;
    // Place a readable caption immediately below its real projected glyph.
    const bounds = archiveNode.getBoundingClientRect(),
      label = node.getBoundingClientRect();
    const x = Math.max(
      label.width / 2 + 3,
      Math.min(bounds.width - label.width / 2 - 3, (pose.x / 100) * bounds.width),
    );
    const y = Math.max(
      3,
      Math.min(
        bounds.height - label.height - 3,
        (pose.y / 100) * bounds.height + (document.body.classList.contains('corner') ? 5 : 14),
      ),
    );
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.opacity = String(
      (item.mark.faded ? 0.28 : 1) *
        (motion.matches
          ? 1
          : Math.min(1, item.progress * 6) * Math.min(1, (1 - item.progress) * 5)),
    );
  }
  if (!archiveNode.classList.contains('webgl-relic')) {
    for (let i = 0; i < runes.children.length; i++) {
      const pose = runePose(
        i,
        current?.marks.length ?? 0,
        motion.matches ? 0 : performance.now(),
        cinematic.unfurl ?? 1,
      );
      const glyph = runes.children[i];
      glyph.hidden = cinematic.unfurl !== null && pose.flight <= 0;
      glyph.style.left = `${Math.max(ambientEdge, Math.min(100 - ambientEdge, pose.x))}%`;
      glyph.style.top = `${Math.max(ambientEdge, Math.min(100 - ambientEdge, pose.y))}%`;
    }
  }
  if (cinematic.send) audio.cue('send');
  if (cinematic.chord) audio.cue('claim');
  const arrival = arrivalPhase(current?.handoff, time, motion.matches);
  const archive = document.querySelector('.archive');
  archive.dataset.phase = arrival.phase;
  archive.style.setProperty('--arrival', arrival.progress);
  const hop = current?.handoff;
  updateText(
    '#handoff',
    hop && time < hop.endsAt
      ? hop.completed
        ? ''
        : `${current.mode === 'simulator' ? 'App-local ritual' : 'Ritual'} · ${Math.max(0, Math.ceil((hop.endsAt - time) / 1000))}s · offer ${hop.offers}/${hop.threshold} · accept ${hop.accepts}/${hop.threshold}`
      : '',
  );
  updateText(
    '#compact-handoff',
    hop && time < hop.endsAt
      ? hop.completed
        ? current.movedToLogin
          ? ''
          : 'Bound by two chats'
        : `${current.mode === 'simulator' ? 'Local ' : ''}${Math.max(0, Math.ceil((hop.endsAt - time) / 1000))}s · O${hop.offers}/${hop.threshold} A${hop.accepts}/${hop.threshold}`
      : '',
  );
  frameId = requestAnimationFrame(frame);
}
if (frameId === null && !document.hidden && document.body.dataset.connection !== 'suspended')
  frameId = requestAnimationFrame(frame);
