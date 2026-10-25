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
addEventListener('pagehide', () => { relic3dClosed = true; relic3dAbort.abort(); relic3d?.dispose(); });
function render(snapshot) {
  const cue = cueFor(snapshot); if (!snapshot || !['ready', 'incoming', 'waiting'].includes(snapshot.status) || (snapshot.status === 'waiting' && !snapshot.handoff?.completed)) audio.silence();
  if (cue) audio.cue(cue);
  document.body.dataset.state = snapshot?.status ?? 'connecting';
  document.querySelector('#waiting-note').hidden = snapshot?.status !== 'waiting';
  relic3d?.update(snapshot);
  current = snapshot; receivedAt = performance.now(); receiptServerTime = snapshot?.serverNow ?? Date.now();
  document.querySelector('#rings').replaceChildren();
  document.querySelector('#lineage').textContent = snapshot ? ringSummary(snapshot.lineageRings).text : 'No current lineage state';
  for (let i = 0; i < Math.min(16, snapshot?.lineageRings ?? 0); i++) { const ring = document.createElement('span'); ring.style.inset = `${4 + i * 1.8}%`; document.querySelector('#rings').append(ring); }
  runes.replaceChildren();
  document.querySelector('#charge').style.width = '0%';
  if (!snapshot) { count.textContent = 'No current state'; document.querySelector('#compact-count').textContent = 'No current state'; return; }
  document.querySelector('#simulator').hidden = snapshot.mode !== 'simulator';
  const messages = { incoming: 'Incoming relic · awaiting two-chat claim', ready: 'Relic connected', paused: 'Marks paused by Keeper', waiting: 'Waiting for an active Keeper holding the relic', unavailable: 'State unavailable; runes hidden' };
  state.textContent = snapshot.claimMeter?.awaitingRaid ? (snapshot.status === 'waiting' ? 'Voting open · awaiting verified raid' : 'Relic held here · voting open') : messages[snapshot.status];
  document.querySelector('#compact-status').textContent = { incoming: 'Incoming · claim pending', ready: 'Relic connected', paused: 'Marks paused', waiting: 'Waiting for Keeper', unavailable: 'State unavailable' }[snapshot.status];
  document.querySelector('#compact-count').textContent = `Charge ${snapshot.approvedCount}/160 · Rings ${snapshot.lineageRings}`;
  count.textContent = `${snapshot.approvedCount} approved marks · charge ${snapshot.approvedCount}/160`;
  document.querySelector('#charge').style.width = `${snapshot.approvedCount / 160 * 100}%`;
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
    document.querySelector('#claim-label').textContent = `${meter.awaitingRaid ? 'Awaiting verified raid · provisional' : 'Verified raid · claim'} · ${progress.seconds}s · Offer ${meter.offers}/${meter.threshold} · Accept ${meter.accepts}/${meter.threshold}`;
  } else document.querySelector('#claim-label').textContent = '';
  const arrival = arrivalPhase(current?.handoff, time, motion.matches);
  const archive = document.querySelector('.archive'); archive.dataset.phase = arrival.phase;
  archive.style.setProperty('--arrival', arrival.progress);
  const hop = current?.handoff;
  document.querySelector('#handoff').textContent = hop && time < hop.endsAt
    ? hop.completed ? 'Two-chat claim complete' : `App-local ritual · ${Math.max(0, Math.ceil((hop.endsAt - time) / 1000))}s · offer ${hop.offers}/${hop.threshold} · accept ${hop.accepts}/${hop.threshold}` : '';
  document.querySelector('#compact-handoff').textContent = hop && time < hop.endsAt
    ? hop.completed ? 'Two-chat claim complete' : `Local ${Math.max(0, Math.ceil((hop.endsAt - time) / 1000))}s · O${hop.offers}/${hop.threshold} A${hop.accepts}/${hop.threshold}` : '';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
