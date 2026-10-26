import { ringCardModel, ringCardPNG, saveRingCard } from './ring-card.js';
export function keeperCardFilename(ring, login, orientation) {
  if (
    !Number.isSafeInteger(ring) ||
    ring < 1 ||
    ring > 16 ||
    !/^[a-z0-9_]{1,25}$/.test(login) ||
    !['landscape', 'vertical'].includes(orientation)
  )
    throw Error('Keeper card metadata');
  return `raid-relic-keeper-${login}-ring-${ring}-${orientation}.png`;
}
export async function keeperCardPNG(model, orientation, audience) {
  keeperCardFilename(model.ringIndex, model.keeper.slice(1), orientation);
  if (
    audience !== undefined &&
    (!Number.isSafeInteger(audience) || audience < 0 || audience > 1000000)
  )
    throw Error('Audience metadata');
  const base = await ringCardPNG(model);
  const bitmap = await createImageBitmap(base);
  const canvas = document.createElement('canvas');
  canvas.width = orientation === 'landscape' ? 1200 : 720;
  canvas.height = orientation === 'landscape' ? 675 : 1280;
  try {
    const c = canvas.getContext('2d');
    if (!c) throw Error('Card canvas unavailable');
    c.fillStyle = model.edition?.design.palette[0] ?? '#101d30';
    c.fillRect(0, 0, canvas.width, canvas.height);
    const y = orientation === 'landscape' ? 0 : 350;
    c.drawImage(bitmap, 0, y, canvas.width, (canvas.width * 630) / 1200);
    c.fillStyle = '#dce4ed';
    c.font = '20px system-ui';
    if (orientation === 'vertical') {
      c.fillText('A ring received. A community remembered.', 32, 200, 656);
      c.fillText(model.caption, 32, 850, 656);
      if (model.disclaimer) {
        c.font = '16px system-ui';
        c.fillText('Unofficial fan edition; not endorsed by Twitch/TwitchCon.', 32, 910, 656);
      }
    }
    c.font = '18px system-ui';
    c.fillText(
      audience === undefined
        ? model.kind === 'wander'
          ? 'Wandered — no raid audience'
          : 'Raid audience not recorded'
        : `Twitch-reported raid audience: ${audience}`,
      32,
      orientation === 'landscape' ? 655 : 990,
      canvas.width - 64,
    );
    if (model.simulated)
      c.fillText(
        'SIMULATOR — no real Twitch',
        32,
        orientation === 'landscape' ? 30 : 80,
        canvas.width - 64,
      );
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.type !== 'image/png' || blob.size > 524288)
      throw Error('Bounded PNG required');
    return blob;
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
export async function downloadKeeperCard(
  profile,
  recorded,
  orientation,
  { signal, current = () => true } = {},
) {
  const own = new AbortController(),
    abort = () => own.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) own.abort();
  const timer = setTimeout(abort, 8000);
  try {
    const read = async (path) => {
      const r = await fetch(path, { signal: own.signal, cache: 'no-store', credentials: 'omit' });
      if (!r.ok) throw Error('Recorded stop unavailable');
      const raw = await r.text();
      if (raw.length > 131072 || own.signal.aborted) throw Error('Bounded response');
      return JSON.parse(raw);
    };
    keeperCardFilename(recorded.ringIndex, profile.login, orientation);
    if (!/^[a-f0-9]{64}$/.test(recorded.stopId) || !current()) throw Error('Stale stop');
    const value = await read('/api/keeper/' + profile.login);
    const stop = value.profile?.received?.find((s) => s.stopId === recorded.stopId);
    if (
      !stop ||
      !['live', 'simulator'].includes(value.mode) ||
      value.profile.login !== profile.login ||
      ['ringIndex', 'claimedAt', 'to', 'from', 'raidAudience', 'kind'].some(
        (k) => stop[k] !== recorded[k],
      )
    )
      throw Error('Changed stop');
    const exact = await read('/api/atlas/stops/' + recorded.stopId);
    const names = { 1591805230: 'raidrelichq', 1591806023: 'olsols2' };
    if (
      exact.mode !== value.mode ||
      names[exact.stop?.to] !== profile.login ||
      exact.stop?.ringIndex !== stop.ringIndex ||
      exact.stop?.claimedAt !== stop.claimedAt ||
      !current()
    )
      throw Error('Stop no longer public');
    const model = ringCardModel(
      {
        stopId: stop.stopId,
        keeper: '@' + profile.login,
        ringIndex: stop.ringIndex,
        claimedAt: stop.claimedAt,
      },
      { mode: value.mode, ...(stop.kind === 'wander' ? { kind: 'wander' } : {}) },
    );
    const blob = await keeperCardPNG(model, orientation, stop.raidAudience);
    if (own.signal.aborted || !current()) throw Error('Cancelled export');
    saveRingCard(
      blob,
      model.simulated,
      keeperCardFilename(stop.ringIndex, profile.login, orientation).replace(
        '-ring-',
        stop.kind === 'wander' ? '-wander-ring-' : '-ring-',
      ),
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
