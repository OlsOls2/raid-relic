import { keeperNames } from './keeper-network.js';
import { setupLinks, setupReadiness, copyOBS } from './onboarding.js';
// Cached own-session presentation, never an authorization or a provider operation.
export function mountFirstRun(id, run) {
  const $ = (key) => document.getElementById(key),
    links = setupLinks(id, keeperNames);
  let pilot = null,
    actions = [],
    readAt = null,
    busy = true,
    previewTimer = null,
    previewEpoch = 0,
    pickedStep = null,
    ageTimer = null;
  const stepIds = ['connect-step', 'setup-step', 'overlay-step', 'send-step'];
  const focusStep = (step) => {
    pickedStep = step;
    if (step !== 'overlay-step' && frame.hasAttribute('src')) {
      previewEpoch++;
      clearTimeout(previewTimer);
      frame.onload = null;
      frame.removeAttribute('src');
      frame.hidden = true;
    }
    for (const key of stepIds) $(key).open = key === step;
    for (const a of document.querySelectorAll('[aria-label="Setup steps"] a'))
      a.setAttribute('aria-current', a.hash === '#' + step ? 'step' : 'false');
  };
  for (const a of document.querySelectorAll('[aria-label="Setup steps"] a'))
    a.onclick = () => focusStep(a.hash.slice(1));
  for (const key of stepIds)
    $(key).ontoggle = () => {
      if (pilot && $(key).open && pickedStep !== key) focusStep(key);
      if (key === 'overlay-step' && !$(key).open && frame.hasAttribute('src')) {
        previewEpoch++;
        clearTimeout(previewTimer);
        frame.onload = null;
        frame.removeAttribute('src');
        frame.hidden = true;
      }
    };
  $('first-obs-confirm').checked = false;
  if (links) $('first-obs-url').value = links.overlay;
  function renderAge() {
    clearTimeout(ageTimer);
    ageTimer = null;
    const r = setupReadiness(pilot, { own: Boolean(pilot), readAt, id });
    const ageText = r.fresh
      ? `Status read ${r.ageSeconds} s ago; these are saved observations, not fresh Twitch authorization. ${document.hidden ? 'Updates paused while hidden.' : 'Visible pending steps update every 5 seconds; idle every 30 seconds.'}`
      : 'Sign in with Twitch to manage your relic; status is not checked.';
    if ($('first-freshness').textContent !== ageText) $('first-freshness').textContent = ageText;
    if (pilot && !document.hidden) ageTimer = setTimeout(renderAge, 1000);
  }
  function render() {
    const r = setupReadiness(pilot, {
      own: Boolean(pilot),
      readAt,
      id,
      obs: $('first-obs-confirm').checked,
    });
    for (const [key, ready, label] of [
      ['session', r.session, 'Matching private session read (not a fresh grant check)'],
      ['optin', r.optedIn, 'Explicit Keeper opt-in'],
      ['subscriptions', r.subscriptions, 'Five subscriptions observed ready'],
      ['obs', r.obs, 'OBS manually checked by you, not server verified'],
    ]) {
      const n = $('first-' + key);
      n.dataset.state = ready ? 'ready' : 'unknown';
      n.textContent = (ready ? '✓ ' : '○ ') + label;
    }
    if (!pickedStep) {
      for (const key of stepIds)
        $(key).open =
          key ===
          (r.fresh
            ? !r.optedIn || !r.subscriptions || !pilot.online
              ? 'setup-step'
              : pilot.holder === id
                ? 'send-step'
                : 'overlay-step'
            : 'connect-step');
      if (r.fresh)
        focusStep(
          !r.optedIn || !r.subscriptions || !pilot.online
            ? 'setup-step'
            : pilot.holder === id
              ? 'send-step'
              : 'overlay-step',
        );
    }
    renderAge();
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
      ['first-authorize', 'refresh-authorization'],
    ]) {
      $(node).disabled =
        busy ||
        !r.fresh ||
        !actions.includes(action) ||
        (action === 'seek-on' && ['holding', 'opt-in-first', 'disabled'].includes(r.queue));
      $(node).setAttribute(
        'aria-describedby',
        action === 'seek-on' ? 'first-queue' : 'first-action-reason',
      );
    }
    $('first-obs-copy').disabled = busy || !links || !r.fresh;
    $('preview-arrival').disabled = busy || !links;
    $('first-action-reason').textContent = !r.fresh
      ? 'Sign in first; actions need your matching private session.'
      : busy
        ? 'Wait for the current request to finish.'
        : 'Each action rechecks your current permission and channel policy on the server.';
  }
  for (const [node, action] of [
    ['first-bootstrap', 'bootstrap'],
    ['first-keep', 'keep'],
    ['first-seek', 'seek-on'],
    ['first-authorize', 'refresh-authorization'],
  ])
    $(node).onclick = () => run(action);
  $('first-obs-confirm').onchange = () => {
    if ($('first-obs-confirm').checked) focusStep('send-step');
    render();
  };
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
  const frame = $('local-overlay-preview');
  $('preview-arrival').onclick = () => {
    const own = ++previewEpoch;
    clearTimeout(previewTimer);
    $('preview-status').textContent =
      'LOCAL TEST · loading a fictional receiving-room arrival; no live connection.';
    frame.hidden = false;
    frame.onload = () => {
      let tries = 0;
      const ready = () => {
        if (own !== previewEpoch) return;
        if (frame.contentDocument?.body?.dataset.localPreviewReady === 'true') {
          frame.contentWindow.postMessage(
            { type: 'raid-relic-preview-arrival', role: 'host' },
            location.origin,
          );
          $('preview-status').textContent =
            'LOCAL TEST · fictional arrival in this page only; no raid, chat or live overlay broadcast.';
          return;
        }
        if (++tries >= 50) {
          $('preview-status').textContent =
            'LOCAL TEST unavailable. No live connection or action was made.';
          return;
        }
        previewTimer = setTimeout(ready, 100);
      };
      ready();
    };
    frame.src = `/overlay/${id}?preview=arrival&layout=card`;
  };
  return {
    clear() {
      pilot = null;
      actions = [];
      readAt = null;
      render();
    },
    observe(value, allowed) {
      pilot = value;
      actions = allowed;
      readAt = Date.now();
      render();
    },
    setBusy(value) {
      busy = value;
      render();
    },
    age: render,
    focusStep,
    pending() {
      return (
        !pilot ||
        !pilot.optedIn ||
        !pilot.subscriptions?.ready ||
        !pilot.online ||
        pilot.paused ||
        !$('first-obs-confirm').checked
      );
    },
    dispose() {
      previewEpoch++;
      clearTimeout(previewTimer);
      clearTimeout(ageTimer);
      frame.onload = null;
      frame.removeAttribute('src');
      frame.hidden = true;
      pilot = null;
      readAt = null;
    },
  };
}
