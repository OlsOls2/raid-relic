import { createOverlayAudio, createCueTracker } from './overlay-audio.js';
import { arrivalPhase } from './arrival.js';
import { connectOverlay } from './overlay-client.js';
const channel = /^\/overlay\/(\d{1,32})$/.exec(location.pathname)?.[1];
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
function render(snapshot) {
  const cue = cueFor(snapshot); if (!snapshot || !['ready', 'incoming', 'waiting'].includes(snapshot.status) || (snapshot.status === 'waiting' && !snapshot.handoff?.completed)) audio.silence();
  if (cue) audio.cue(cue);
  current = snapshot; receivedAt = performance.now(); receiptServerTime = snapshot?.serverNow ?? Date.now();
  document.querySelector('#rings').replaceChildren();
  document.querySelector('#lineage').textContent = snapshot ? `${snapshot.lineageRings} completed growth rings` : 'No current lineage state';
  for (let i = 0; i < (snapshot?.lineageRings ?? 0); i++) { const ring = document.createElement('span'); ring.style.inset = `${4 + i * 1.8}%`; document.querySelector('#rings').append(ring); }
  runes.replaceChildren();
  document.querySelector('#charge').style.width = '0%';
  if (!snapshot) { count.textContent = 'No current state'; document.querySelector('#compact-count').textContent = 'No current state'; return; }
  document.querySelector('#simulator').hidden = snapshot.mode !== 'simulator';
  const messages = { incoming: 'Incoming relic · awaiting two-chat claim', ready: 'Relic connected', paused: 'Marks paused by Keeper', waiting: 'Waiting for trusted Keeper and stream state', unavailable: 'State unavailable; runes hidden' };
  state.textContent = messages[snapshot.status];
  document.querySelector('#compact-status').textContent = { incoming: 'Incoming · claim pending', ready: 'Relic connected', paused: 'Marks paused', waiting: 'Waiting for Keeper', unavailable: 'State unavailable' }[snapshot.status];
  document.querySelector('#compact-count').textContent = `Charge ${snapshot.approvedCount}/160 · Rings ${snapshot.lineageRings}`;
  count.textContent = `${snapshot.approvedCount} approved marks · charge ${snapshot.approvedCount}/160`;
  document.querySelector('#charge').style.width = `${snapshot.approvedCount / 160 * 100}%`;
  snapshot.marks.forEach((mark, index) => {
    const image = document.createElement('img'); image.className = 'rune'; image.alt = 'Approved community rune';
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

function frame() {
  const time = receiptServerTime + performance.now() - receivedAt;
  if (current?.handoff && time >= current.handoff.endsAt) audio.silence();
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
