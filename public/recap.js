const keeperName = (id) =>
  ({ 1591805230: '@raidrelichq', 1591806023: '@olsols2' })[id] ?? 'Unknown Keeper';
const $ = (id) => document.getElementById(id);
let previewURL,
  generation = 0,
  controller;
function clear() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = null;
  $('card').removeAttribute('src');
  $('card').hidden = true;
  $('route').replaceChildren();
  $('summary').textContent = 'No current snapshot';
  $('svg').disabled = $('png').disabled = true;
}
async function read() {
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  const active = controller;
  clear();
  $('status').textContent = 'Reading fresh retained archive…';
  const timer = setTimeout(() => active.abort(), 8000);
  try {
    const response = await fetch('/api/recap', { cache: 'no-store', signal: active.signal });
    if (!response.ok) throw Error();
    const raw = await response.text();
    if (raw.length > 131072) throw Error();
    const data = JSON.parse(raw);
    if (current !== generation) return null;
    if (
      !['live', 'simulator'].includes(data.mode) ||
      typeof data.svg !== 'string' ||
      data.svg.length > 65536 ||
      !Array.isArray(data.route) ||
      data.route.length > 16
    )
      throw Error();
    if (
      !Number.isInteger(data.rings) ||
      data.rings !== data.route.length ||
      data.completedStops !== data.rings ||
      !Number.isInteger(data.retainedMarkEntries) ||
      data.retainedMarkEntries < 0 ||
      data.retainedMarkEntries > 2560 ||
      !Number.isInteger(data.shownRunes) ||
      data.shownRunes !== Math.min(24, data.retainedMarkEntries) ||
      data.route.some(
        (stop, i) =>
          !/^[a-f0-9]{64}$/.test(stop.stopId) ||
          stop.ringIndex !== i + 1 ||
          ![stop.from, stop.to].every((id) => typeof id === 'string' && /^\d{1,32}$/.test(id)) ||
          !Number.isInteger(stop.retainedEntries) ||
          stop.retainedEntries < 0 ||
          stop.retainedEntries > 160,
      ) ||
      /<script|<foreignObject|<image|(?:href|on[a-z]+)\s*=/i.test(data.svg)
    )
      throw Error();
    if (data.mode === 'simulator' && !data.svg.includes('SIMULATOR')) throw Error();
    $('simulator').hidden = data.mode !== 'simulator';
    previewURL = URL.createObjectURL(new Blob([data.svg], { type: 'image/svg+xml' }));
    $('card').src = previewURL;
    $('card').hidden = false;
    $('summary').textContent =
      `${data.completedStops} completed stops · ${data.rings} growth rings${data.wanderStops ? ' · ' + data.wanderStops + ' Wandered (no raid)' : ''} · ${data.retainedMarkEntries} retained approved mark entries (not unique people). ${data.shownRunes} rune entries pictured.`;
    if (!data.route.length) $('summary').textContent += ' No completed hops yet.';
    for (const stop of data.route) {
      const item = document.createElement('li'),
        link = document.createElement('a');
      link.href = `/stops/${stop.stopId}`;
      link.textContent = `Ring ${stop.ringIndex}: ${keeperName(stop.from)} → ${keeperName(stop.to)} · ${stop.retainedEntries} retained entries · ${new Date(stop.claimedAt).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC'}`;
      item.append(link);
      $('route').append(item);
    }
    $('status').textContent = 'Fresh local snapshot ready. Downloads are not automatically shared.';
    $('svg').disabled = $('png').disabled = false;
    return data;
  } catch {
    if (current === generation) {
      clear();
      $('status').textContent =
        'Recap unavailable. Previous snapshot cleared; refresh to try again.';
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function save(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function png(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  let timer;
  try {
    const image = new Image();
    image.src = url;
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error()), 8000);
      }),
    ]);
    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(1200, 630)
        : Object.assign(document.createElement('canvas'), { width: 1200, height: 630 });
    const context = canvas.getContext('2d');
    if (!context) throw Error();
    context.drawImage(image, 0, 0, 1200, 630);
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.type !== 'image/png') throw Error();
    return blob;
  } finally {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
}
$('refresh').onclick = read;
for (const kind of ['svg', 'png'])
  $(kind).onclick = async () => {
    const data = await read();
    if (!data) return;
    const current = generation;
    try {
      const blob =
        kind === 'svg' ? new Blob([data.svg], { type: 'image/svg+xml' }) : await png(data.svg);
      if (current !== generation) return;
      save(blob, `raid-relic-${data.mode}-recap.${kind}`);
      $('status').textContent =
        'Local snapshot downloaded. Old files cannot be recalled after erasure.';
    } catch {
      $('status').textContent =
        'PNG export unavailable in this browser. Download SVG instead; no public sharing occurred.';
    }
  };
addEventListener('pagehide', () => {
  generation++;
  controller?.abort();
  clear();
});
addEventListener('pageshow', (event) => {
  if (event.persisted) read();
});
read();
