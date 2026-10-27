import { keeperNames } from './keeper-network.js';
import { setupLinks, setupReadiness, copyOBS } from './onboarding.js';
// Uses only the existing authenticated status response; never reads a new API.
export function mountFirstRun(id, run) {
  const $ = (key) => document.getElementById(key),
    links = setupLinks(id, keeperNames);
  let pilot = null,
    actions = [],
    readAt = null,
    busy = true,
    timer = null;
  $('first-obs-confirm').checked = false;
  if (links) $('first-obs-url').value = links.overlay;
  function render() {
    const r = setupReadiness(pilot, {
      own: Boolean(pilot),
      readAt,
      id,
      obs: $('first-obs-confirm').checked,
    });
    for (const [key, ready, label] of [
      ['session', r.session, 'Matching private session (not a fresh grant check)'],
      ['optin', r.optedIn, 'Explicit Keeper opt-in'],
      ['subscriptions', r.subscriptions, 'Five subscriptions observed ready'],
      ['obs', r.obs, 'OBS manually checked by you, not server verified'],
    ]) {
      const node = $('first-' + key);
      node.dataset.state = ready ? 'ready' : 'unknown';
      node.textContent = (ready ? '✓ ' : '○ ') + label;
    }
    $('first-freshness').textContent = r.fresh
      ? 'Status just read; ticks expire after 10 seconds. No background polling.'
      : 'Not freshly verified. Use Refresh status; no setup action runs automatically.';
    $('first-queue').textContent = {
      unchecked: 'Queue: not checked.',
      holding: 'You hold the relic. Pass it on before joining the Seeker queue.',
      'opt-in-first': 'Queue off. Opt in first, then choose Become a Seeker.',
      disabled: 'Seeker queue is disabled by the operator.',
      joined: 'Explicit Seeker membership observed; live eligibility is checked separately.',
      off: 'Queue off. Become a Seeker only if you want to receive the relic.',
    }[r.queue];
    for (const [node, action] of [
      ['first-bootstrap', 'bootstrap'],
      ['first-keep', 'keep'],
      ['first-seek', 'seek-on'],
    ])
      $(node).disabled =
        busy ||
        !r.fresh ||
        !actions.includes(action) ||
        (action === 'seek-on' && ['holding', 'opt-in-first', 'disabled'].includes(r.queue));
    $('first-obs-copy').disabled = busy || !links || !r.fresh;
  }
  for (const [node, action] of [
    ['first-bootstrap', 'bootstrap'],
    ['first-keep', 'keep'],
    ['first-seek', 'seek-on'],
  ])
    $(node).onclick = () => run(action);
  $('first-obs-confirm').onchange = render;
  $('first-obs-copy').onclick = async () => {
    try {
      $('first-copy-status').textContent = await copyOBS(links.overlay, navigator.clipboard);
    } catch {
      $('first-obs-url').focus();
      $('first-obs-url').select();
      $('first-copy-status').textContent =
        'Copy failed. Select and copy manually; OBS installation is not verified.';
    }
  };
  return {
    clear() {
      clearTimeout(timer);
      pilot = null;
      actions = [];
      readAt = null;
      render();
    },
    observe(value, allowed) {
      clearTimeout(timer);
      pilot = value;
      actions = allowed;
      readAt = Date.now();
      render();
      timer = setTimeout(render, 10001);
    },
    setBusy(value) {
      busy = value;
      render();
    },
    dispose() {
      clearTimeout(timer);
      pilot = null;
      readAt = null;
    },
  };
}
