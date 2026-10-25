import { connectOverlay } from './overlay-client.js';
const channel = /^\/overlay\/(\d{1,32})$/.exec(location.pathname)?.[1];
const runes = document.querySelector('#runes');
const state = document.querySelector('#status');
const count = document.querySelector('#count');
document.body.classList.toggle('corner', new URLSearchParams(location.search).get('corner') === '1');
function render(snapshot) {
  runes.replaceChildren();
  document.querySelector('#charge').style.width = '0%';
  if (!snapshot) { count.textContent = 'No current state'; return; }
  document.querySelector('#simulator').hidden = snapshot.mode !== 'simulator';
  const messages = { ready: 'Relic connected', paused: 'Marks paused by Keeper', waiting: 'Waiting for trusted Keeper and stream state', unavailable: 'State unavailable; runes hidden' };
  state.textContent = messages[snapshot.status];
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
    if (value !== 'connected') state.textContent = { connecting: 'Connecting to relic state…', reconnecting: 'Connection lost; reconnecting…', stale: 'State stale; reconnecting…' }[value];
  } });
