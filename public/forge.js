let preview3d, preview3dAbort;
function clear3d() { preview3dAbort?.abort(); preview3d?.dispose(); preview3d = null; document.getElementById('forge-3d').hidden = true; document.getElementById('preview-3d').disabled = true; }
const $ = id => document.getElementById(id);
let current, previewURL, generation = 0, controller; const downloads = new Set();
function clear() { clear3d(); generation++; controller?.abort(); current = null; if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null;
  for (const url of downloads) URL.revokeObjectURL(url); downloads.clear();
  $('preview-image').removeAttribute('src'); $('preview-image').hidden = true; $('design-json').textContent = ''; for (const id of ['copy', 'download-json', 'download-svg']) $(id).disabled = true; }
function envelope(data) { return { schemaVersion: data.schemaVersion, source: data.source, mode: data.mode, applied: false, design: data.design }; }
async function preview(event) {
  event.preventDefault(); clear(); const active = generation; controller = new AbortController(); const request = controller;
  $('status').textContent = 'Rendering deterministic template…'; const timer = setTimeout(() => request.abort(), 8000);
  try {
    const response = await fetch('/api/forge', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, signal: request.signal, body: JSON.stringify({ description: $('description').value }) });
    const text = await response.text(); if (!response.ok || text.length > 16384) throw Error(); const data = JSON.parse(text); if (active !== generation) return;
    if (data.source !== 'template' || data.schemaVersion !== 1 || !['live', 'simulator'].includes(data.mode) || typeof data.svg !== 'string' || data.svg.length > 12000 || data.applied !== false) throw Error();
    if (data.mode === 'simulator' && !data.svg.includes('SIMULATOR')) throw Error();
    current = data; $('preview-3d').disabled = false; $('simulator').hidden = data.mode !== 'simulator'; $('design-json').textContent = JSON.stringify(envelope(data), null, 2);
    previewURL = URL.createObjectURL(new Blob([data.svg], { type: 'image/svg+xml' })); $('preview-image').src = previewURL; $('preview-image').hidden = false;
    for (const id of ['copy', 'download-json', 'download-svg']) $(id).disabled = false;
    $('status').textContent = 'Template preview · schema v1 · not AI · not applied to the live relic.';
  } catch { if (active === generation) { clear(); $('status').textContent = 'Preview unavailable or invalid. Previous preview cleared; use a plain description up to240 characters.'; } }
  finally { clearTimeout(timer); }
}
function save(kind) { if (!current) return; const blob = new Blob([kind === 'json' ? JSON.stringify(envelope(current), null, 2) : current.svg], { type: kind === 'json' ? 'application/json' : 'image/svg+xml' });
  const url = URL.createObjectURL(blob); downloads.add(url); const link = document.createElement('a'); link.href = url; link.download = `raid-relic-${current.mode}-forge.${kind}`; link.click(); setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000); }
$('forge-form').onsubmit = preview;
$('clear').onclick = () => { clear(); $('description').value = ''; $('status').textContent = 'Template cleared. No design was applied.'; $('description').focus(); };
$('description').oninput = () => { clear(); $('status').textContent = 'Description changed; preview the new template explicitly.'; };
$('download-json').onclick = () => save('json'); $('download-svg').onclick = () => save('svg');
$('copy').onclick = async () => { if (!current) return; try { await navigator.clipboard.writeText(JSON.stringify(envelope(current), null, 2)); $('status').textContent = 'Design JSON copied. Nothing applied.'; } catch { $('status').textContent = 'Clipboard unavailable. Use Download JSON or select the JSON text.'; } };
addEventListener('pagehide', () => { clear(); $('description').value = ''; }); addEventListener('pageshow', event => { if (event.persisted) { clear(); $('description').value = ''; } });
$('description').disabled = $('preview').disabled = false;

$('preview-3d').onclick = async () => {
  clear3d(); if (!current) return; const active = generation; const request = new AbortController(); preview3dAbort = request;
  $('preview-3d-status').textContent = 'Loading local 3D preview only…';
  try {
    const { createRelic3D, validRelicDesign } = await import('./relic3d.js');
    if (request.signal.aborted || active !== generation) return;
    if (!validRelicDesign(current.design)) throw Error();
    const archive = $('forge-3d'); archive.hidden = false;
    const view = await createRelic3D({ signal: request.signal, archive, design: current.design, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)') });
    if (request.signal.aborted || active !== generation) { view.dispose(); return; }
    preview3d = view; view.update({ lineageRings: 0, marks: [] });
    $('preview-3d-status').textContent = view.available ? 'Local 3D template preview. Not saved or applied to the live relic.' : '3D unavailable or reduced motion enabled. The SVG template and downloads remain available.';
  } catch { if (!request.signal.aborted) $('preview-3d-status').textContent = '3D unavailable. The SVG template and downloads remain available.'; }
  finally { if (active === generation) $('preview-3d').disabled = !current; }
};
