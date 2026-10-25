let expiryRecovery = null;
const id = /^\/control\/(\d+)$/.exec(location.pathname)?.[1];
const names = { '1591805230': 'raidrelichq', '1591806023': 'olsols2' };
let csrf; let busy = false;
const labels = { bootstrap: 'Bootstrap / reconcile this channel', keep: 'Opt in / Keep', pause: 'Pause', resume: 'Resume', 'opt-out': 'Opt out', process: 'Process queued own send' };
const status = document.getElementById('result');
function disable(value) { busy = value; document.querySelectorAll('button').forEach(b => { b.disabled = value; }); document.getElementById('expire-handoff').disabled = value || !expiryRecovery?.canExpire; }
async function refresh() {
  document.getElementById('ledger').replaceChildren();
  try {
    const response = await fetch(`/control/${id}/status`, { cache: 'no-store' });
    if (!response.ok) throw new Error(); const value = await response.json(); csrf = value.csrf; document.getElementById('simulator').hidden = value.pilot.mode !== 'simulator';
    expiryRecovery = value.pilot.expiryRecovery;
    document.getElementById('expire-handoff').disabled = !expiryRecovery?.canExpire;
    document.getElementById('expiry-state').textContent = expiryRecovery ? JSON.stringify(expiryRecovery) : 'No source-owned ended confirmed handoff.';
    document.getElementById('account').textContent = `${names[id]} · Keeper control`;
    for (const key of ['account', 'online', 'optedIn', 'paused', 'holder', 'subscriptions', 'bothReadiness', 'eligibility', 'ownerStep', 'intent', 'dispatchDiagnostic', 'handoff', 'claimProgress']) {
      const dt = document.createElement('dt'); dt.textContent = key; const dd = document.createElement('dd'); dd.textContent = JSON.stringify(value.pilot[key], null, 2); document.getElementById('ledger').append(dt, dd);
    }
    for (const group of ['setup', 'keeper', 'raid']) document.getElementById(group).replaceChildren();
    for (const action of value.actions.filter(a => a !== 'logout')) {
      const button = document.createElement('button'); button.textContent = action.startsWith('send:') ? `Send Off to ${names[action.slice(5)]}` : labels[action];
      button.onclick = () => run(action); document.getElementById(action === 'bootstrap' ? 'setup' : action === 'process' || action.startsWith('send:') ? 'raid' : 'keeper').append(button);
    }
  } catch { expiryRecovery = null; document.getElementById('expire-handoff').disabled = true; csrf = null; status.textContent = 'Session/status unavailable. Reconnect this Keeper to continue.'; }
}
async function run(action) {
  if (busy || !csrf) return;
  if (action.startsWith('send:') && !confirm('Request a real Twitch raid to the named Keeper? This can affect your live broadcast.')) return;
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

document.getElementById('expire-handoff').onclick = async () => {
  if (busy || !csrf || !expiryRecovery?.canExpire || !confirm('Expire only this ended app claim window? Holder stays unchanged; no Twitch raid is cancelled.')) return;
  const expected = expiryRecovery; disable(true);
  try { const response = await fetch(`/control/${id}/expire-handoff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csrf, intentId: expected.intentId, hopId: expected.hopId }) }); status.textContent = await response.text(); await refresh(); }
  catch { status.textContent = 'Outcome unavailable. Refresh; do not blindly repeat Send Off.'; } finally { disable(false); document.getElementById('expire-handoff').disabled = !expiryRecovery?.canExpire; }
};
