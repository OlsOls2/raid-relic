// Fragment is never sent to the server. Remove it from this history entry
// immediately; keep only transient memory and a POST body, never storage/logs.
let capability = location.hash.slice(1);
history.replaceState(null, '', '/my-marks');
const list = document.getElementById('matches'), status = document.getElementById('status'), next = document.getElementById('next');
let offset = 0, generation = 0, controller;
function clear() { generation++; controller?.abort(); list.replaceChildren(); next.hidden = true; }
async function load(start = 0) {
  clear(); const current = generation; controller = new AbortController(); const active = controller; const timer = setTimeout(() => active.abort(), 8000);
  status.textContent = 'Reading fresh shared history…';
  try {
    if (!capability) throw Error();
    const response = await fetch('/api/my-marks', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capability, offset: start, limit: 20 }), signal: active.signal });
    if (!response.ok) throw Error(); const data = await response.json(); if (generation !== current) return;
    document.getElementById('simulator').hidden = data.mode !== 'simulator';
    status.textContent = `${data.total} retained approved entries. Shared link, not identity proof.`;
    for (const match of data.matches) {
      const item = document.createElement('li'), text = document.createElement('span'), image = document.createElement('img'), link = document.createElement('a');
      text.textContent = match.text; image.alt = 'Approved original rune'; image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(match.runeSvg)}`;
      link.textContent = `Ring ${match.ringIndex}: channel ${match.from} to ${match.to}`; link.href = `/stops/${match.stopId}`;
      item.append(image, text, link); list.append(item);
    }
    offset = data.nextOffset; next.hidden = offset === null;
  } catch { if (generation === current) { list.replaceChildren(); status.textContent = 'Shared history unavailable or expired. Previous content hidden; request a fresh link in original chat.'; } }
  finally { clearTimeout(timer); }
}
next.onclick = () => { if (offset !== null) load(offset); };
document.getElementById('refresh').onclick = () => load();
document.getElementById('clear').onclick = () => { capability = ''; clear(); status.textContent = 'Link cleared from this tab.'; };
addEventListener('pagehide', () => { capability = ''; clear(); });
addEventListener('pageshow', event => { if (event.persisted) { capability = ''; clear(); status.textContent = 'Link cleared on navigation. Open a fresh shared link.'; } });
load();
