import { keeperNames as networkNames } from './keeper-network.js';
import { actionMessage, botConsentStartURL } from './control-view.js';
import { boundedResponse } from './control-read.js';
import { mountFirstRun } from './first-run.js';
const forgeLink = document.getElementById('forge-owner-link');
if (forgeLink) forgeLink.href = `${location.pathname}/forge`;
const consentURL = document.getElementById('p7-consent-url'),
  copyConsent = document.getElementById('p7-copy');
if (copyConsent)
  copyConsent.onclick = async () => {
    if (!consentURL.value) return;
    try {
      await navigator.clipboard.writeText(consentURL.value);
      document.getElementById('p7-copy-status').textContent =
        'App start URL copied. Open it in the raidrelicbot browser.';
    } catch {
      consentURL.focus();
      consentURL.select();
      document.getElementById('p7-copy-status').textContent =
        'Select and copy this app start URL manually, then open it in the raidrelicbot browser.';
    }
  };
let expiryRecovery = null;
const id = /^\/control\/(\d+)$/.exec(location.pathname)?.[1];
if (id) {
  document.getElementById('reconnect').href = `/oauth/keeper/${id}/start`;
  document.getElementById('own-overlay').href = `/overlay/${id}`;
  document.getElementById('own-overlay-sound').href = `/overlay/${id}?sound=1`;
}
const firstRun = mountFirstRun(id, (action) => run(action));
const names = networkNames;
let recovery = null;
let simulated = false;
let csrf;
let busy = false;
let candidates = [];
let readGeneration = 0,
  readController;
const target = document.getElementById('raid-target');
const empty = document.getElementById('target-empty');
const labels = {
  'mark-links': 'Send queued public mark-history link',
  'seek-on': 'Join public Seeker queue',
  'seek-off': 'Leave Seeker queue',
  'seek-status': 'Read Seeker choice',
  chronicle: 'Write Chronicle for latest received stop',
  bootstrap: 'Bootstrap / reconcile this channel',
  'refresh-authorization': 'Check / refresh my Keeper authorization',
  keep: 'Opt in / Keep',
  pause: 'Pause',
  resume: 'Resume',
  'opt-out': 'Opt out',
  process: 'Process queued own send',
};
const status = document.getElementById('result');
function disable(value) {
  busy = value;
  document.querySelectorAll('button').forEach((b) => {
    b.disabled = value || !csrf;
  });
  document.getElementById('refresh').disabled = value;
  document.getElementById('expire-handoff').disabled = value || !expiryRecovery?.canExpire;
  target.disabled = value || !csrf || !candidates.length;
  document.getElementById('cancel-queued').disabled = value || !recovery?.canCancel;
  firstRun.setBusy(value || !csrf);
}
function invalidate() {
  firstRun.clear();
  if (consentURL) {
    consentURL.value = '';
    copyConsent.disabled = true;
    document.getElementById('p7-consent-link').removeAttribute('href');
    document.getElementById('p7-consent-link').setAttribute('aria-disabled', 'true');
  }
  if (document.getElementById('p7-gates'))
    document.getElementById('p7-gates').textContent = 'Refresh to read operator-configured gates.';
  for (const key of ['bot', 'subscriptions', 'live']) {
    const light = document.getElementById(`light-${key}`);
    light.dataset.state = 'unknown';
    light.textContent = `${{ bot: 'Bot', subscriptions: 'Subscriptions', live: 'Stream' }[key]}: not yet checked`;
  }
  document.getElementById('keeper-summary').textContent = 'Read status before taking action.';
  csrf = null;
  candidates = [];
  recovery = expiryRecovery = null;
  for (const group of ['setup', 'keeper', 'raid']) document.getElementById(group).replaceChildren();
  disable(busy);
}
async function refresh({ preserveResult = false } = {}) {
  const generation = ++readGeneration;
  readController?.abort();
  const request = new AbortController();
  readController = request;
  invalidate();
  if (!preserveResult) status.textContent = 'Reading your session…';
  document.getElementById('ledger').replaceChildren();
  candidates = [];
  target.replaceChildren();
  target.disabled = true;
  empty.hidden = false;
  document.getElementById('raid').replaceChildren();
  try {
    const response = await boundedResponse(
      `/control/${id}/status`,
      { cache: 'no-store', signal: request.signal },
      { json: true },
    );
    if (generation !== readGeneration || request.signal.aborted) return;
    const value = response.value;
    if (
      !value ||
      value.keeperId !== id ||
      typeof value.csrf !== 'string' ||
      !Array.isArray(value.actions) ||
      !value.pilot
    )
      throw Error('Invalid status');
    const authorization = value.pilot.authorization;
    if (authorization !== undefined && !['not-checked'].includes(authorization))
      throw Error('Invalid authorization status');
    document.getElementById('authorization-status').textContent =
      'Fresh Keeper authorization is not checked by status. If targets are missing, use Check / refresh my Keeper authorization; reconnect this matching Keeper if it fails. Refresh status never renews tokens.';
    csrf = value.csrf;
    firstRun.observe(value.pilot, value.actions);
    document.getElementById('simulator').hidden = value.pilot.mode !== 'simulator';
    simulated = value.pilot.mode === 'simulator';
    document.getElementById('ledger').hidden = !simulated;
    const lights = {
      bot: value.pilot.botGrantStored === true,
      subscriptions: value.pilot.subscriptions?.ready === true,
      live: value.pilot.online === true,
    };
    for (const [key, ready] of Object.entries(lights)) {
      const light = document.getElementById(`light-${key}`);
      light.dataset.state = ready ? 'ready' : key === 'live' ? 'offline' : 'unknown';
      light.textContent = `${{ bot: 'Bot', subscriptions: 'Subscriptions', live: 'Stream' }[key]}: ${ready ? { bot: 'saved grant connected (not a live check)', subscriptions: 'all five enabled', live: 'observed live' }[key] : { bot: 'not connected', subscriptions: 'not ready', live: 'offline' }[key]}`;
    }
    if (consentURL) {
      consentURL.value = '';
      copyConsent.disabled = true;
      const url = botConsentStartURL(
        value.canonicalBotConsentStartURL,
        value.pilot.mode,
        location.origin,
      );
      if (url) {
        consentURL.value = url;
        document.getElementById('p7-consent-link').href = url;
        document.getElementById('p7-consent-link').removeAttribute('aria-disabled');
        copyConsent.disabled = false;
      }
    }
    const gate = value.pilot.optionalBotActions;
    if (document.getElementById('p7-gates')) {
      const c = gate?.configured,
        e = gate?.effective;
      document.getElementById('p7-gates').textContent = c
        ? `Configured — MASTER: ${c.master === true ? 'ON' : 'OFF'}; announcement: ${c.announcement === true ? 'ON' : 'OFF'}; pin: ${c.pin === true ? 'ON' : 'OFF'}; shoutout: ${c.shoutout === true ? 'ON' : 'OFF'}; pin-replace acknowledgement: ${c.pinReplace === true ? 'ON' : 'OFF'}; duration: ${Number.isInteger(c.duration) ? c.duration + ' seconds' : 'invalid'}. Effective actions — announcement: ${e?.announcement === true ? 'ON' : 'OFF'}, pin: ${e?.pin === true ? 'ON' : 'OFF'}, shoutout: ${e?.shoutout === true ? 'ON' : 'OFF'}.`
        : 'Gate settings unavailable.';
    }
    if (document.getElementById('p7-status'))
      document.getElementById('p7-status').textContent =
        value.pilot.optionalBotActions?.enabled === true
          ? value.pilot.optionalBotActions.moderatorChecked === true
            ? 'Optional actions enabled; moderator proof is cached. Only a new completed claim can trigger them, never Refresh. API acceptance does not verify viewer-visible delivery.'
            : 'Optional actions enabled by the operator. Bot consent and moderator proof are required; checked only on a new completed claim. API acceptance does not verify viewer-visible delivery.'
          : 'Off by default. Optional actions need separate operator gates, bot consent and moderator roles in both rooms.';
    document.getElementById('keeper-summary').textContent =
      `${value.pilot.seekers?.enabled ? 'Public Seeker queue: ' + (value.pilot.seekers.joined ? 'joined.' : 'not joined.') + ' ' : ''}Relic Keeper: @${names[value.pilot.holder] ?? 'unplaced'}. Your stream: ${value.pilot.online ? 'live' : 'offline'}. ${value.pilot.optedIn ? 'Opted in' : 'Not opted in'}. ${value.pilot.paused ? 'Paused.' : ''} ${Object.values(value.pilot.bothReadiness ?? {}).length >= 2 && Object.values(value.pilot.bothReadiness).every((v) => v === true) ? 'Configured channels are ready.' : 'Reconcile channels used for this hand-off until ready.'} ${value.pilot.claimProgress ? `Offer ${value.pilot.claimProgress.offers ?? 0}/${value.pilot.claimProgress.threshold} · Accept ${value.pilot.claimProgress.accepts ?? 0}/${value.pilot.claimProgress.threshold}${value.pilot.claimProgress.finalized ? ' · Bound by two chats' : ''}` : ''}`;
    document.querySelector('label[for=intent-confirm]').textContent = simulated
      ? 'Exact queued intent ID from your private status'
      : 'Type CANCEL to confirm only this never-dispatched queue';
    recovery = value.pilot.recovery;
    document.getElementById('cancel-queued').disabled = !recovery?.canCancel;
    document.getElementById('recovery-status').textContent = recovery
      ? simulated
        ? JSON.stringify(recovery)
        : recovery.canCancel
          ? 'A never-dispatched request can be cancelled with confirmation below.'
          : 'An existing request needs review. Accepted, unknown or processing requests must never be repeated.'
      : 'No own intent. No recovery mutation is needed.';
    expiryRecovery = value.pilot.expiryRecovery;
    document.getElementById('expire-handoff').disabled = !expiryRecovery?.canExpire;
    document.getElementById('expiry-state').textContent = expiryRecovery
      ? simulated
        ? JSON.stringify(expiryRecovery)
        : expiryRecovery.canExpire
          ? 'This ended ritual can be retired safely. The relic stays here.'
          : 'The current ritual has not ended.'
      : 'No source-owned ended confirmed handoff.';
    document.getElementById('account').textContent = `${names[id]} · Keeper control`;
    if (simulated)
      for (const key of [
        'chronicle',
        'account',
        'online',
        'optedIn',
        'paused',
        'holder',
        'subscriptions',
        'bothReadiness',
        'eligibility',
        'ownerStep',
        'intent',
        'dispatchDiagnostic',
        'handoff',
        'claimProgress',
      ]) {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = JSON.stringify(value.pilot[key], null, 2);
        document.getElementById('ledger').append(dt, dd);
      }
    for (const group of ['setup', 'keeper', 'raid'])
      document.getElementById(group).replaceChildren();
    candidates = (value.pilot.candidates ?? []).filter(
      (c) => c.id !== id && names[c.id] && c.observedOnline && c.optedIn && c.eligible,
    );
    for (const candidate of candidates) {
      const option = document.createElement('option');
      option.value = candidate.id;
      option.textContent = `${candidate.login} · observed online${Number.isSafeInteger(candidate.viewers) && candidate.viewers >= 0 ? ' · ' + candidate.viewers + ' Twitch-reported viewers' : ''}`;
      target.append(option);
    }
    target.disabled = busy || !candidates.length;
    empty.hidden = candidates.length > 0;
    if (candidates.length) {
      const send = document.createElement('button');
      const label = () => {
        send.className = 'send-off';
        send.textContent = `Send Off to ${names[target.value]}`;
      };
      label();
      target.onchange = label;
      send.onclick = () => run(`send:${target.value}`);
      document.getElementById('raid').append(send);
    }
    for (const action of value.actions.filter((a) => a !== 'logout' && !a.startsWith('send:'))) {
      const button = document.createElement('button');
      button.textContent = action.startsWith('send:')
        ? `Send Off to ${names[action.slice(5)]}`
        : labels[action];
      button.onclick = () => run(action);
      document
        .getElementById(
          action === 'bootstrap'
            ? 'setup'
            : action === 'process' || action.startsWith('send:')
              ? 'raid'
              : 'keeper',
        )
        .append(button);
    }
    if (!preserveResult)
      status.textContent = 'Status refreshed. Review both channels before Send Off.';
  } catch (error) {
    if (generation !== readGeneration || request.signal.aborted) return;
    invalidate();
    expiryRecovery = null;
    document.getElementById('expire-handoff').disabled = true;
    csrf = null;
    recovery = null;
    document.getElementById('cancel-queued').disabled = true;
    document.getElementById('recovery-status').textContent =
      'Recovery status unavailable. Reconnect and refresh; never repeat dispatch.';
    status.textContent =
      error?.code === 'timeout'
        ? 'Status timed out. Retry Refresh status; reconnect only this matching Keeper if authorization expired.'
        : error?.code === 'authorization'
          ? 'Control session expired or unauthorized. Reconnect this matching Keeper, then Retry Refresh status.'
          : 'Status unavailable or invalid. Retry Refresh status; actions are disabled until a fresh authorized status is read.';
  } finally {
    if (generation === readGeneration) disable(false);
  }
}
async function run(action) {
  if (busy || !csrf) return;
  if (action.startsWith('send:')) {
    if (!candidates.some((c) => c.id === action.slice(5))) {
      status.textContent = 'Refresh status to choose an observed eligible Keeper.';
      return;
    }
    if (
      !confirm(
        `Request a real Twitch raid to ${names[action.slice(5)]}? This can affect your live broadcast.`,
      )
    )
      return;
  }
  disable(true);
  try {
    const response = await boundedResponse(`/control/${id}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, csrf }),
    });
    if (action === 'logout' && response.ok) {
      location.assign(`/control/${id}`);
      return;
    }
    let value;
    try {
      value = JSON.parse(response.text);
    } catch {}
    status.textContent =
      simulated && response.ok ? response.text : actionMessage(value, names[target.value]);
    await refresh({ preserveResult: true });
  } catch {
    invalidate();
    status.textContent =
      'Request outcome unavailable. Refresh status; never blindly repeat a raid request.';
  } finally {
    disable(false);
  }
}
document.getElementById('refresh').onclick = async () => {
  if (busy) return;
  disable(true);
  await refresh();
};
document.getElementById('logout').onclick = () => run('logout');
disable(true);
refresh();
addEventListener('pagehide', () => {
  firstRun.dispose();
  readGeneration++;
  readController?.abort();
  invalidate();
});

document.getElementById('cancel-queued').onclick = async () => {
  const intentId = document.getElementById('intent-confirm').value;
  if (
    busy ||
    !recovery?.canCancel ||
    (simulated ? intentId !== recovery.intentId : intentId !== 'CANCEL') ||
    !confirm(
      'Cancel only this exact unclaimed queued intent? This cannot cancel a dispatched Twitch raid.',
    )
  )
    return;
  disable(true);
  try {
    const result = await boundedResponse(`${location.pathname}/cancel-queued`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csrf, intentId: recovery.intentId, generation: recovery.generation }),
    });
    const body = JSON.parse(result.text);
    status.textContent = result.ok ? actionMessage(body) : 'Recovery authorization failed';
    await refresh({ preserveResult: true });
  } catch {
    invalidate();
    status.textContent = 'Recovery unavailable. Refresh and inspect; do not repeat dispatch.';
  } finally {
    document.getElementById('intent-confirm').value = '';
    disable(false);
  }
};
document.getElementById('expire-handoff').onclick = async () => {
  if (
    busy ||
    !csrf ||
    !expiryRecovery?.canExpire ||
    !confirm(
      'Expire only this ended app claim window? Holder stays unchanged; no Twitch raid is cancelled.',
    )
  )
    return;
  const expected = expiryRecovery;
  disable(true);
  try {
    const response = await boundedResponse(`/control/${id}/expire-handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csrf, intentId: expected.intentId, hopId: expected.hopId }),
    });
    let value;
    try {
      value = JSON.parse(response.text);
    } catch {}
    status.textContent = actionMessage(value);
    await refresh({ preserveResult: true });
  } catch {
    invalidate();
    status.textContent = 'Outcome unavailable. Refresh; do not blindly repeat Send Off.';
  } finally {
    disable(false);
    document.getElementById('expire-handoff').disabled = !expiryRecovery?.canExpire;
  }
};
