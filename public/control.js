const forgeLink = document.getElementById('forge-owner-link');
if (forgeLink) forgeLink.href = `${location.pathname}/forge`;
let expiryRecovery = null;
const id = /^\/control\/(\d+)$/.exec(location.pathname)?.[1];
if (id) { document.getElementById('own-overlay').href = `/overlay/${id}`; document.getElementById('own-overlay-sound').href = `/overlay/${id}?sound=1`; }
const names = { '1591805230': 'raidrelichq', '1591806023': 'olsols2' };
let recovery = null;
let csrf; let busy = false; let candidates = [];
const target = document.getElementById('raid-target');
const empty = document.getElementById('target-empty');
const labels = { 'mark-links': 'Send queued public mark-history link', chronicle: 'Write Chronicle for latest received stop', bootstrap: 'Bootstrap / reconcile this channel', keep: 'Opt in / Keep', pause: 'Pause', resume: 'Resume', 'opt-out': 'Opt out', process: 'Process queued own send' };
const status = document.getElementById('result');
function disable(value) { busy = value; document.querySelectorAll('button').forEach(b => { b.disabled = value; }); document.getElementById('expire-handoff').disabled = value || !expiryRecovery?.canExpire; target.disabled = value || !candidates.length; document.getElementById('cancel-queued').disabled = value || !recovery?.canCancel; }
async function refresh() {
  document.getElementById('ledger').replaceChildren();
  candidates = []; target.replaceChildren(); target.disabled = true; empty.hidden = false; document.getElementById('raid').replaceChildren();
  try {
    const response = await fetch(`/control/${id}/status`, { cache: 'no-store' });
    if (!response.ok) throw new Error(); const value = await response.json(); csrf = value.csrf; document.getElementById('simulator').hidden = value.pilot.mode !== 'simulator';
    recovery = value.pilot.recovery; document.getElementById('cancel-queued').disabled = !recovery?.canCancel;
    document.getElementById('recovery-status').textContent = recovery ? JSON.stringify(recovery) : 'No own intent. No recovery mutation is needed.';
    expiryRecovery = value.pilot.expiryRecovery;
    document.getElementById('expire-handoff').disabled = !expiryRecovery?.canExpire;
    document.getElementById('expiry-state').textContent = expiryRecovery ? JSON.stringify(expiryRecovery) : 'No source-owned ended confirmed handoff.';
    document.getElementById('account').textContent = `${names[id]} · Keeper control`;
    for (const key of ['chronicle', 'account', 'online', 'optedIn', 'paused', 'holder', 'subscriptions', 'bothReadiness', 'eligibility', 'ownerStep', 'intent', 'dispatchDiagnostic', 'handoff', 'claimProgress']) {
      const dt = document.createElement('dt'); dt.textContent = key; const dd = document.createElement('dd'); dd.textContent = JSON.stringify(value.pilot[key], null, 2); document.getElementById('ledger').append(dt, dd);
    }
    for (const group of ['setup', 'keeper', 'raid']) document.getElementById(group).replaceChildren();
    candidates = (value.pilot.candidates ?? []).filter(c => c.id !== id && names[c.id] && c.observedOnline && c.optedIn && c.eligible);
    for (const candidate of candidates) { const option = document.createElement('option'); option.value = candidate.id; option.textContent = `${candidate.login} · observed online`; target.append(option); }
    target.disabled = busy || !candidates.length; empty.hidden = candidates.length > 0;
    if (candidates.length) {
      const send = document.createElement('button'); const label = () => { send.textContent = `Send Off to ${names[target.value]}`; }; label();
      target.onchange = label; send.onclick = () => run(`send:${target.value}`); document.getElementById('raid').append(send);
    }
    for (const action of value.actions.filter(a => a !== 'logout' && !a.startsWith('send:'))) {
      const button = document.createElement('button'); button.textContent = action.startsWith('send:') ? `Send Off to ${names[action.slice(5)]}` : labels[action];
      button.onclick = () => run(action); document.getElementById(action === 'bootstrap' ? 'setup' : action === 'process' || action.startsWith('send:') ? 'raid' : 'keeper').append(button);
    }
  } catch { expiryRecovery = null; document.getElementById('expire-handoff').disabled = true; csrf = null; recovery = null; document.getElementById('cancel-queued').disabled = true; document.getElementById('recovery-status').textContent = 'Recovery status unavailable. Reconnect and refresh; never repeat dispatch.'; status.textContent = 'Session/status unavailable. Reconnect this Keeper to continue.'; }
}
async function run(action) {
  if (busy || !csrf) return;
  if (action.startsWith('send:')) {
    if (!candidates.some(c => c.id === action.slice(5))) { status.textContent = 'Refresh status to choose an observed eligible Keeper.'; return; }
    if (!confirm(`Request a real Twitch raid to ${names[action.slice(5)]}? This can affect your live broadcast.`)) return;
  }
  disable(true);
  try {
    const response = await fetch(`/control/${id}`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, csrf }) });
    if (action === 'logout' && response.ok) { location.assign(`/control/${id}`); return; }
    const text = await response.text(); status.textContent = response.ok ? text : `Action failed (${response.status}). Refresh and review setup before retrying.`;
    await refresh();
  } catch { status.textContent = 'Request outcome unavailable. Refresh status; never blindly repeat a raid request.'; }
  finally { disable(false); }
}
document.getElementById('refresh').onclick = async () => { if (busy) return; disable(true); await refresh(); disable(false); };
document.getElementById('logout').onclick = () => run('logout');
refresh();

document.getElementById('cancel-queued').onclick = async () => {
  const intentId = document.getElementById('intent-confirm').value;
  if (busy || !recovery?.canCancel || intentId !== recovery.intentId || !confirm('Cancel only this exact unclaimed queued intent? This cannot cancel a dispatched Twitch raid.')) return;
  disable(true);
  try { const result = await fetch(`${location.pathname}/cancel-queued`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csrf, intentId, generation: recovery.generation }) });
    const body = await result.json(); status.textContent = result.ok ? body.status : 'Recovery authorization failed';
  } catch { status.textContent = 'Recovery unavailable. Refresh and inspect; do not repeat dispatch.'; }
  finally { document.getElementById('intent-confirm').value = ''; disable(false); await refresh(); }
};
document.getElementById('expire-handoff').onclick = async () => {
  if (busy || !csrf || !expiryRecovery?.canExpire || !confirm('Expire only this ended app claim window? Holder stays unchanged; no Twitch raid is cancelled.')) return;
  const expected = expiryRecovery; disable(true);
  try { const response = await fetch(`/control/${id}/expire-handoff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csrf, intentId: expected.intentId, hopId: expected.hopId }) }); status.textContent = await response.text(); await refresh(); }
  catch { status.textContent = 'Outcome unavailable. Refresh; do not blindly repeat Send Off.'; } finally { disable(false); document.getElementById('expire-handoff').disabled = !expiryRecovery?.canExpire; }
};
