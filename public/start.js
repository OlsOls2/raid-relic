import { keeperNames } from './keeper-network.js';
import { setupLinks, copyOBS } from './onboarding.js';
const $ = (id) => document.getElementById(id),
  select = $('start-channel');
$('start-confirm').checked = false;
for (const [id, login] of Object.entries(keeperNames)) {
  if (!setupLinks(id, keeperNames)) continue;
  const option = document.createElement('option');
  option.value = id;
  option.textContent = '@' + login;
  select.insertBefore(option, select.lastElementChild);
}
select.onchange = () => {
  const links = setupLinks(select.value, keeperNames);
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
    : 'Private pilot: ask the owner to configure your verified channel first. This page cannot enroll it.';
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
