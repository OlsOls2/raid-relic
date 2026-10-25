const $ = id => document.getElementById(id);
const stopId = /^\/stops\/([a-f0-9]{64})$/.exec(location.pathname)?.[1];
let offset = 0; let next = null; let generation = 0; let controller;
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
function clear() { $('journey').replaceChildren(); $('marks').replaceChildren(); $('rings').textContent = 'No current state'; $('next').hidden = true; }
async function load() {
  const current = ++generation; controller?.abort(); controller = new AbortController(); const activeController = controller;
  // Clear immediately: no cache or old page may retain purged public content.
  clear(); $('status').textContent = 'Reading the archive…'; $('refresh').disabled = true;
  const timer = setTimeout(() => activeController.abort(), 8000);
  try {
    const response = await fetch(`/api/atlas${stopId ? `/stops/${stopId}` : ''}?offset=${offset}&limit=${stopId ? 20 : 8}`, { cache: 'no-store', signal: activeController.signal });
    if (!response.ok) throw new Error('Unavailable'); const data = await response.json(); if (current !== generation) return;
    $('simulator').hidden = data.mode !== 'simulator'; $('rings').textContent = `${data.rings} completed growth rings`;
    $('status').textContent = data.total ? `Showing ${offset + 1}–${Math.min(offset + (stopId ? data.marks.length : data.stops.length), data.total)} of ${data.total}` : stopId ? 'No approved marks retained at this stop.' : 'No completed hops yet. The relic has no recorded journey. Refresh after a completed two-chat claim.';
    if (stopId) {
      $('title').textContent = `Stop ${data.stop.ringIndex}`; $('description').textContent = `Channel ${data.stop.from} to channel ${data.stop.to}. Claimed ${new Date(data.stop.claimedAt).toLocaleString()}. ${data.stop.raidSize} reported raid viewers.`;
      $('detail').hidden = false;
      for (const mark of data.marks) { const item = node('li'); const img = node('img'); img.alt = 'Original approved rune'; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mark.runeSvg)}`; item.append(img, node('span', mark.text)); $('marks').append(item); }
    } else for (const stop of data.stops) {
      const item = node('li', undefined, 'stop'); const link = node('a', 'Open this stop'); link.href = `/stops/${stop.stopId}`;
      item.append(node('h2', `Ring ${stop.ringIndex}`), node('p', `Channel ${stop.from} to ${stop.to}`), node('p', new Date(stop.claimedAt).toLocaleString()), node('p', `${stop.approvedCount} approved marks retained`), link); $('journey').append(item);
    }
    next = data.nextOffset; $('next').hidden = next === null;
  } catch { if (current !== generation) return; clear(); $('status').textContent = 'Archive unavailable. Previous content hidden. Refresh to try again.'; }
  finally { clearTimeout(timer); if (current === generation) $('refresh').disabled = false; }
}
$('refresh').onclick = () => { offset = 0; load(); };
$('next').onclick = () => { if (next !== null) { offset = next; load(); } };
// No polling. Hide old content when leaving; a restored page must read anew.
addEventListener('pagehide', () => { generation++; controller?.abort(); clear(); });
addEventListener('pageshow', event => { if (event.persisted) load(); });
load();
