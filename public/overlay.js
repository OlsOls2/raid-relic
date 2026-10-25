import { createCinemaTracker, wordBatch, runePose, ambientSigils, decorativePoints, validSourceLogin } from './cinematic.js';
import { createRelic3D, ringSummary } from './relic3d.js';
import { meterProgress } from './claim-meter.js';
import { createOverlayAudio, createCueTracker } from './overlay-audio.js';
import { arrivalPhase } from './arrival.js';
import { connectOverlay, resonanceActive } from './overlay-client.js';
const channel = /^\/overlay\/(\d{1,32})$/.exec(location.pathname)?.[1];
const echoNote = document.createElement('span'); echoNote.className = 'echo-note'; echoNote.setAttribute('role', 'status'); document.querySelector('.archive').append(echoNote);
const runes = document.querySelector('#runes');
const state = document.querySelector('#status');
const count = document.querySelector('#count');
document.body.classList.toggle('corner', new URLSearchParams(location.search).get('corner') === '1');
const audio = createOverlayAudio({ optedIn: new URLSearchParams(location.search).get('sound') === '1' });
const cueFor = createCueTracker();
const cinema = createCinemaTracker();
const archiveNode = document.querySelector('.archive');
const effect = name => { const node = document.createElement('div'); node.className = `p3-${name}`; node.hidden = true; node.setAttribute('aria-hidden', 'true'); (document.body.classList.contains('corner') || !['comet','flash','shock'].includes(name) ? archiveNode : document.body).append(node); return node; };
const effects = Object.fromEntries(['comet', 'flash', 'shock', 'release', 'fusion'].map(name => [name, effect(name)]));
const ns = 'http://www.w3.org/2000/svg';
const fusionSVG = document.createElementNS(ns, 'svg'); fusionSVG.setAttribute('viewBox', '0 0 120 120');
const fusionArcs = ['offer', 'accept', 'ring'].map(name => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx','60'); c.setAttribute('cy','60'); c.setAttribute('r','59'); c.classList.add(`p3-fuse-${name}`); fusionSVG.append(c); return c; });
effects.fusion.append(fusionSVG);
const ringPips = document.createElement('div'); ringPips.className = 'ring-pips'; ringPips.setAttribute('aria-label','Completed rings'); document.querySelector('.relic-overlay').append(ringPips);
const words = Array.from({ length: 8 }, () => { const word = document.createElement('span'); word.className = 'p3-word'; word.hidden = true; archiveNode.append(word); return word; });
const ambient = Array.from({ length: 6 }, (_, i) => {
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox','0 0 64 64'); svg.classList.add('p31-decorative'); svg.dataset.decorative = 'true'; svg.setAttribute('aria-hidden','true'); svg.hidden = true; svg.setAttribute('hidden','');
  const polygon = document.createElementNS(ns,'polygon'); polygon.setAttribute('points',decorativePoints(i)); svg.append(polygon); archiveNode.append(svg); return svg;
});
const sourceCaption = document.createElement('p'); sourceCaption.className = 'p31-source'; sourceCaption.hidden = true; archiveNode.append(sourceCaption);
function clearCinema() { for (const node of [...Object.values(effects), ...words, ...ambient, sourceCaption]) { node.hidden = true; if (node.classList.contains('p3-word')) node.textContent = ''; if (node.classList.contains('p31-decorative')) node.setAttribute('hidden',''); } sourceCaption.textContent = ''; archiveNode.dataset.ambientCount = '0'; archiveNode.dataset.charge = 'false'; archiveNode.style.setProperty('--charge-level', '0'); archiveNode.style.setProperty('--charge-alpha', '0'); archiveNode.dataset.fusionPending = 'false'; archiveNode.style.setProperty('--p3-shake', '0px'); }

const soundButton = document.querySelector('#sound-toggle');
soundButton.hidden = new URLSearchParams(location.search).get('sound') !== '1';
soundButton.onclick = async event => {
  if (!event.isTrusted) return;
  if (soundButton.getAttribute('aria-pressed') === 'true') { await audio.mute(); soundButton.setAttribute('aria-pressed', 'false'); soundButton.textContent = 'Sound'; soundButton.setAttribute('aria-label', 'Enable optional overlay sounds'); }
  else { const enabled = await audio.arm(); soundButton.setAttribute('aria-pressed', String(enabled)); soundButton.textContent = enabled ? 'Mute' : 'Sound'; soundButton.setAttribute('aria-label', enabled ? 'Mute overlay sounds' : 'Enable optional overlay sounds; browser permission required'); }
};
addEventListener('pagehide', () => { audio.teardown(); cueFor(null); soundButton.setAttribute('aria-pressed', 'false'); soundButton.textContent = 'Sound'; soundButton.setAttribute('aria-label', 'Enable optional overlay sounds'); });
let current = null; let receivedAt = 0; let receiptServerTime = 0;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let relic3d, relic3dClosed = false; const relic3dAbort = new AbortController();
createRelic3D({ signal: relic3dAbort.signal, archive: document.querySelector('.archive'), reducedMotion: motion, corner: document.body.classList.contains('corner') }).then(view => { if (relic3dClosed) { view?.dispose(); return; } relic3d = view; view?.update(current); });
addEventListener('pagehide', () => { clearCinema(); relic3dClosed = true; relic3dAbort.abort(); relic3d?.dispose(); });
function render(snapshot) {
  const cue = cueFor(snapshot); if (!snapshot || !['ready', 'incoming', 'waiting'].includes(snapshot.status) || (snapshot.status === 'waiting' && !snapshot.handoff?.completed)) audio.silence();
  cinema.observe(snapshot); clearCinema(); archiveNode.dataset.fusionPending = String(cinema.pending(snapshot, snapshot?.serverNow ?? 0, motion.matches)); archiveNode.style.setProperty('--p3-fusion', '0');
  if (cue && !(cue === 'claim' && snapshot?.handoff?.completedAt !== undefined) && !motion.matches && !document.hidden) audio.cue(cue);
  document.body.dataset.state = snapshot?.status ?? 'connecting';
  document.querySelector('#waiting-note').hidden = snapshot?.status !== 'waiting' || Boolean(snapshot?.movedToLogin);
  relic3d?.update(snapshot);
  current = snapshot; receivedAt = performance.now(); receiptServerTime = snapshot?.serverNow ?? Date.now();
  ringPips.replaceChildren(); for (let i=0;i<Math.min(16,snapshot?.lineageRings??0);i++) { const pip=document.createElement('span'); pip.setAttribute('aria-hidden','true'); ringPips.append(pip); }
  document.querySelector('#rings').replaceChildren();
  document.querySelector('#lineage').textContent = snapshot ? snapshot.mode === 'simulator' ? ringSummary(snapshot.lineageRings).text : `Ring ${snapshot.lineageRings}` : 'The relic rests…';
  for (let i = 0; i < Math.min(16, snapshot?.lineageRings ?? 0); i++) { const ring = document.createElement('span'); ring.style.inset = `${4 + i * 1.8}%`; document.querySelector('#rings').append(ring); }
  runes.replaceChildren();
  document.querySelector('#charge').style.width = '0%';
  if (!snapshot) { count.textContent = 'No current state'; document.querySelector('#compact-count').textContent = 'No current state'; return; }
  document.querySelector('#simulator').hidden = snapshot.mode !== 'simulator';
  const simulated = snapshot.mode === 'simulator';
  const messages = { incoming: 'The relic arrives… bind it with two chats', ready: 'Bound by two chats', paused: 'The Keeper has paused the ritual', waiting: snapshot.movedToLogin ? `The relic has moved on to @${snapshot.movedToLogin}` : 'The relic stirs… awaiting a Keeper', unavailable: 'The relic is out of sight…' };
  state.textContent = snapshot.claimMeter?.awaitingRaid ? 'The relic stirs… waiting for Twitch to confirm the raid' : messages[snapshot.status];
  document.querySelector('#compact-status').textContent = snapshot.movedToLogin ? `Moved to @${snapshot.movedToLogin}` : { incoming: 'Incoming · claim pending', ready: 'Relic connected', paused: 'Marks paused', waiting: 'Waiting for Keeper', unavailable: 'State unavailable' }[snapshot.status];
  document.querySelector('#compact-count').textContent = simulated ? `Charge ${snapshot.approvedCount}/160 · Rings ${snapshot.lineageRings}` : `Ring ${snapshot.lineageRings} · ${snapshot.approvedCount} runes`;
  if (!simulated) document.querySelector('#waiting-note').textContent = snapshot.movedToLogin ? `The relic has moved on to @${snapshot.movedToLogin}` : 'The relic stirs… a confirmed raid will light the way here.';
  count.textContent = simulated ? `${snapshot.approvedCount} approved marks · charge ${snapshot.approvedCount}/160` : `${snapshot.approvedCount} approved runes`;
  document.querySelector('#charge').style.width = `${snapshot.approvedCount / 160 * 100}%`;
  document.querySelector('.charge-track').hidden = !simulated;
  snapshot.marks.forEach((mark, index) => {
    const image = document.createElement('img'); image.className = 'rune'; image.alt = mark.faded ? 'Approved carried rune, dimmed after three holder stream closures; retained, not deleted' : 'Approved community rune';
    if (mark.faded) image.classList.add('faded');
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mark.runeSvg)}`;
    const angle = index * 2.399963; const radius = 30 + index % 3 * 5;
    image.style.setProperty('--x', `${Math.cos(angle) * radius}%`); image.style.setProperty('--y', `${Math.sin(angle) * radius}%`);
    runes.append(image);
  });
}
if (channel) connectOverlay({ url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${channel}`, render,
  status(value) {
    document.body.classList.toggle('disconnected', value !== 'connected');
    if (value !== 'connected') document.querySelector('#compact-status').textContent = value === 'stale' ? 'State stale' : 'Reconnecting…';
    if (value !== 'connected') state.textContent = { connecting: 'Connecting to relic state…', reconnecting: 'Connection lost; reconnecting…', stale: 'State stale; reconnecting…' }[value];
  } });

let lastReduced = motion.matches, lastHidden = document.hidden;
function frame() {
  if (motion.matches !== lastReduced || document.hidden !== lastHidden) {
    lastReduced = motion.matches; lastHidden = document.hidden; relic3d?.wake();
  }
  const echoOn = resonanceActive(current?.resonance, receiptServerTime + performance.now() - receivedAt);
  document.querySelector('.archive').classList.toggle('resonating', echoOn);
  const note = echoOn ? 'Decorative Shared-chat echo of an approved rune; not proof of raid membership' : '';
  if (echoNote.textContent !== note) echoNote.textContent = note;
  const time = receiptServerTime + performance.now() - receivedAt;
  if (current?.handoff && time >= current.handoff.endsAt) audio.silence();
  const meter = current && ['ready', 'incoming', 'waiting'].includes(current.status) ? current.claimMeter : null;
  const progress = meterProgress(meter, time);
  document.querySelector('#claim-meter').hidden = !progress; document.querySelector('#claim-arcs').hidden = !progress;
  document.body.classList.toggle('voting', Boolean(progress));
  if (progress) {
    document.querySelector('#offer-arc').style.strokeDashoffset = String(339.292 * (1 - progress.offers));
    document.querySelector('#accept-arc').style.strokeDashoffset = String(307.876 * (1 - progress.accepts));
    document.querySelector('#claim-label').textContent = `${meter.awaitingRaid ? (current.mode === 'simulator' ? 'Awaiting verified raid · gathering light' : 'Waiting for Twitch to confirm the raid') : (current.mode === 'simulator' ? 'The raid arrived · claim the relic' : 'Bind the relic · two chats')} · ${progress.seconds}s · Offer ${meter.offers}/${meter.threshold} · Accept ${meter.accepts}/${meter.threshold}`;
  } else document.querySelector('#claim-label').textContent = '';
  const cinematic = cinema.frame(current, time, { reduced: motion.matches, hidden: document.hidden });
  archiveNode.dataset.cinematicElapsed = String(Math.floor(cinematic.elapsed));
  const chargeLevel = document.hidden ? 0 : cinematic.chargeLevel;
  archiveNode.dataset.charge = String(cinematic.charge && !motion.matches && !document.hidden);
  archiveNode.style.setProperty('--charge-level', String(chargeLevel));
  archiveNode.style.setProperty('--charge-blur', `${4 + chargeLevel * 12}px`);
  archiveNode.style.setProperty('--charge-alpha', String(.08 + chargeLevel * .42));
  archiveNode.style.setProperty('--p3-shake', `${cinematic.shake}px`);
  for (const [name, value] of Object.entries({ comet: cinematic.comet, flash: cinematic.flash || null, shock: cinematic.shock, release: cinematic.release, fusion: cinematic.fusion })) {
    const node = effects[name]; node.hidden = value === null || document.hidden; node.style.setProperty('--p3-progress', String(value ?? 0));
    if (name === 'flash') node.style.opacity = String(value ?? 0);
  }
  const bounds = archiveNode.getBoundingClientRect();
  const corner = document.body.classList.contains('corner');
  const anchorX = corner ? bounds.width / 2 : bounds.left + bounds.width / 2;
  const anchorY = corner ? bounds.height / 2 : bounds.top + bounds.height / 2;
  const startX = corner ? 0 : innerWidth * .12, startY = corner ? 0 : innerHeight * .12;
  const travel = cinematic.comet ?? 1;
  effects.comet.style.left = `${startX + (anchorX - startX) * travel}px`;
  effects.comet.style.top = `${startY + (anchorY - startY) * travel}px`;
  effects.comet.style.setProperty('--comet-angle', `${Math.atan2(anchorY-startY,anchorX-startX)}rad`);
  if (!corner) { effects.shock.style.left = `${anchorX}px`; effects.shock.style.top = `${anchorY}px`; }
  const ambientCount = document.hidden ? 0 : ambientSigils(current, cinematic, motion.matches);
  archiveNode.dataset.ambientCount = String(ambientCount);
  for (let i = 0; i < ambient.length; i++) {
    const glyph = ambient[i]; glyph.hidden = i >= ambientCount; glyph.toggleAttribute('hidden', glyph.hidden);
    if (glyph.hidden) continue;
    const pose = runePose(i, 6, performance.now(), cinematic.unfurl);
    glyph.style.left = `${pose.x}%`; glyph.style.top = `${pose.y}%`;
    glyph.style.opacity = String(Math.min(1, .35 + pose.flight));
  }
  const showSource = cinematic.host && validSourceLogin(current?.handoff?.sourceLogin) && cinematic.elapsed >= 0 && cinematic.elapsed < 20000 && !document.hidden;
  sourceCaption.hidden = !showSource;
  sourceCaption.textContent = showSource ? `From @${current.handoff.sourceLogin}` : '';
  archiveNode.dataset.fusionPending = String(cinematic.fusionPending);
  archiveNode.style.setProperty('--p3-fusion', String(cinematic.fusion ?? (cinematic.fusionPending ? 0 : 1)));
  const fuse = cinematic.fusion ?? 0;
  archiveNode.style.setProperty('--fusion-glow', String(cinematic.fusion === null ? 0 : Math.sin(Math.PI * fuse)));
  fusionArcs[0].style.transform = `translateX(${-(1-fuse)*18}px)`; fusionArcs[1].style.transform = `translateX(${(1-fuse)*18}px)`;
  fusionArcs[0].style.opacity = fusionArcs[1].style.opacity = String(1-fuse); fusionArcs[2].style.opacity = String(fuse);
  const ringInset = archiveNode.classList.contains('webgl-relic') ? relic3d?.ringInset?.() : null;
  effects.fusion.style.inset = `${ringInset ?? (4 + Math.max(0, Math.min(16, current?.lineageRings ?? 0) - 1) * 1.8)}%`;
  const batch = wordBatch(current?.marks ?? [], cinematic, motion.matches);
  for (let i = 0; i < words.length; i++) {
    const item = batch[i], node = words[i]; node.hidden = !item || document.hidden;
    if (!item) { node.textContent = ''; continue; }
    if (node.textContent !== item.mark.flightText) node.textContent = item.mark.flightText;
    const pose = runePose(item.index, current.marks.length, motion.matches ? 0 : performance.now(), cinematic.unfurl ?? 1);
    node.dataset.orbitIndex = String(item.index);
    node.style.left = `${pose.x}%`; node.style.top = `${pose.y}%`;
    // Place a readable caption immediately below its real projected glyph.
    const bounds = archiveNode.getBoundingClientRect(), label = node.getBoundingClientRect();
    const x = Math.max(label.width / 2 + 3, Math.min(bounds.width - label.width / 2 - 3, pose.x / 100 * bounds.width));
    const y = Math.max(3, Math.min(bounds.height - label.height - 3, pose.y / 100 * bounds.height + (document.body.classList.contains('corner') ? 5 : 14)));
    node.style.left = `${x}px`; node.style.top = `${y}px`;
    node.style.opacity = String((item.mark.faded ? .28 : 1) * (motion.matches ? 1 : Math.min(1, item.progress * 6) * Math.min(1, (1 - item.progress) * 5)));
  }
  if (!archiveNode.classList.contains('webgl-relic')) {
    for (let i = 0; i < runes.children.length; i++) { const pose = runePose(i, current?.marks.length ?? 0, motion.matches ? 0 : performance.now(), cinematic.unfurl ?? 1); const glyph = runes.children[i]; glyph.hidden = cinematic.unfurl !== null && pose.flight <= 0; glyph.style.left = `${pose.x}%`; glyph.style.top = `${pose.y}%`; }
  }
  if (cinematic.send) audio.cue('send');
  if (cinematic.chord) audio.cue('claim');
  const arrival = arrivalPhase(current?.handoff, time, motion.matches);
  const archive = document.querySelector('.archive'); archive.dataset.phase = arrival.phase;
  archive.style.setProperty('--arrival', arrival.progress);
  const hop = current?.handoff;
  document.querySelector('#handoff').textContent = hop && time < hop.endsAt
    ? hop.completed ? '' : `${current.mode === 'simulator' ? 'App-local ritual' : 'Ritual'} · ${Math.max(0, Math.ceil((hop.endsAt - time) / 1000))}s · offer ${hop.offers}/${hop.threshold} · accept ${hop.accepts}/${hop.threshold}` : '';
  document.querySelector('#compact-handoff').textContent = hop && time < hop.endsAt
    ? hop.completed ? (current.movedToLogin ? '' : 'Bound by two chats') : `${current.mode === 'simulator' ? 'Local ' : ''}${Math.max(0, Math.ceil((hop.endsAt - time) / 1000))}s · O${hop.offers}/${hop.threshold} A${hop.accepts}/${hop.threshold}` : '';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
