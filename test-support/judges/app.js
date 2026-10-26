let generation = null;
const result = document.getElementById('result');
const buttons = [...document.querySelectorAll('button')];
function render(data) {
  const share = document.getElementById('own-share');
  share.hidden = !data.ownSharePath;
  if (
    typeof data.ownSharePath === 'string' &&
    /^\/my-marks#[A-Za-z0-9_-]+$/.test(data.ownSharePath)
  )
    share.href = data.ownSharePath;
  else share.removeAttribute('href');
  document.getElementById('ledger').textContent = JSON.stringify(data, null, 2).replace(
    /(?<!Simulated )\b(1591805230|1591806023|1591804828)\b/g,
    'Simulated $1',
  );
  const target = document.getElementById('target');
  target.replaceChildren();
  for (const candidate of data.candidates) {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = `${candidate.label} · observed online / opted in`;
    target.append(option);
  }
  if (!data.candidates.length) {
    const option = document.createElement('option');
    option.textContent = 'No observed eligible simulated target';
    target.append(option);
  }
  target.disabled = !data.candidates.length;
  if (generation !== null && generation !== data.generation)
    for (const frame of document.querySelectorAll('iframe')) frame.src = frame.getAttribute('src');
  generation = data.generation;
}
async function run(action) {
  buttons.forEach((button) => {
    button.disabled = true;
  });
  result.textContent = 'SIMULATOR processing local step…';
  try {
    const response = await fetch(
      action ? '/api/judges/action' : '/api/judges/status',
      action
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action }),
          }
        : { cache: 'no-store' },
    );
    const data = await response.json();
    if (!response.ok || data.mode !== 'simulator') throw Error();
    render(data);
    result.textContent =
      action === 'send'
        ? 'SIMULATOR: mock API accepted; NO travel yet. Next simulate verified receipt.'
        : action === 'reset'
          ? 'SIMULATOR reset: fresh isolated memory; preview frames reloaded.'
          : 'SIMULATOR local state refreshed. No actual Twitch activity.';
  } catch {
    result.textContent =
      'SIMULATOR step unavailable. Follow the order, refresh or reset local memory.';
    document.getElementById('ledger').textContent = '';
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}
for (const button of document.querySelectorAll('[data-action]'))
  button.onclick = () => run(button.dataset.action);
document.getElementById('refresh').onclick = () => run();
run();
