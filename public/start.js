import { keeperNames } from './keeper-network.js';
import { setupChannel, copyOBS } from './onboarding.js';
const $ = (id) => document.getElementById(id),
  select = $('start-channel');
$('start-confirm').checked = false;
// Public configured-name matching only, not account lookup or open enrollment.
select.oninput = () => {
  const links = setupChannel(select.value, keeperNames);
  for (const [id, url] of [
    ['start-connect', links?.connect],
    ['start-control', links?.control],
  ]) {
    const a = $(id);
    a.removeAttribute('href');
    a.setAttribute('aria-disabled', String(!url));
    if (url) a.href = url;
  }
  $('start-obs').value = links?.overlay ?? '';
  $('start-copy').disabled = !links;
  $('start-confirm').checked = false;
  $('start-copy-status').textContent =
    'Not copied. Check the source manually after adding it to OBS.';
  $('start-status').textContent = links
    ? `@${links.login} is configured, not verified ready. Only you can connect and opt in.`
    : 'Your channel is not admitted yet. Ask the owner for an invitation through your existing private contact. No account, consent or readiness has been verified here.';
};
$('start-copy').onclick = async () => {
  try {
    $('start-copy-status').textContent = await copyOBS($('start-obs').value, navigator.clipboard);
  } catch {
    $('start-obs').focus();
    $('start-obs').select();
    $('start-copy-status').textContent =
      'Copy failed. Select the URL and copy it manually; nothing is marked copied or installed.';
  }
};
