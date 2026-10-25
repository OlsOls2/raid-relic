const id = /^\/control\/(\d{1,32})\/forge$/.exec(location.pathname)?.[1]; const $ = name => document.getElementById(name);
let csrf, enabled = false, current, previewURL, downloadURL;
const clear = () => { current = null; if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null; $('preview-image').hidden = true; $('preview-image').removeAttribute('src'); $('design-json').textContent = ''; $('download').disabled = true; };
$('owner-form').onsubmit = async event => {
  event.preventDefault(); if (!enabled || !csrf || !$('acknowledge').checked) return; clear(); $('generate').disabled = true;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`/control/${id}/forge`, { method: 'POST', cache: 'no-store', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csrf, description: $('description').value, acknowledge: true }) });
    const text = await response.text(); if (!response.ok || text.length > 16384) throw Error(); const data = JSON.parse(text);
    if (!['template', 'model'].includes(data.source) || !['live', 'simulator'].includes(data.mode) || data.applied !== false || typeof data.svg !== 'string' || data.svg.length > 12000) throw Error();
    $('simulator').hidden = data.mode !== 'simulator'; current = { schemaVersion: data.schemaVersion, source: data.source, mode: data.mode, applied: false, design: data.design };
    $('design-json').textContent = JSON.stringify(current, null, 2); previewURL = URL.createObjectURL(new Blob([data.svg], { type: 'image/svg+xml' })); $('preview-image').src = previewURL; $('preview-image').hidden = false; $('download').disabled = false;
    $('status').textContent = `Source: ${data.source}. Preview only; nothing applied. Template may indicate off, unavailable, moderation failure or a consumed attempt.`;
  } catch { clear(); $('status').textContent = 'Outcome unavailable. Do not blindly retry; an attempt may already be consumed. Use the public template path.'; }
  finally { clearTimeout(timer); }
};
$('description').oninput = clear;
$('download').onclick = () => { if (!current) return; if (downloadURL) URL.revokeObjectURL(downloadURL); downloadURL = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = downloadURL; link.download = `raid-relic-${current.mode}-forge.json`; link.click(); };
$('acknowledge').onchange = () => { $('generate').disabled = !enabled || !$('acknowledge').checked; };
addEventListener('pagehide', () => { clear(); if (downloadURL) URL.revokeObjectURL(downloadURL); $('description').value = ''; csrf = null; });
(async () => { try { const response = await fetch(`/control/${id}/status`, { cache: 'no-store' }); if (!response.ok) throw Error(); const data = await response.json(); csrf = data.csrf; enabled = data.forgeEnabled === true;
  $('description').disabled = $('acknowledge').disabled = !enabled; $('status').textContent = enabled ? 'Paid gates enabled. Review upload/cost warning and acknowledge before clicking.' : 'Provider generation OFF. Public templates work without a key, stop or consent. No model action is enabled.';
} catch { $('status').textContent = 'Private session unavailable. No provider request sent.'; } })();
