import { boundedCardRead, freshShareSnapshot, assertFreshShare } from './ring-card-client.js';
import { keeperNames as networkNames } from './keeper-network.js';
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
    const y = orientation === 'landscape' ? 0 : model.share ? 280 : 350;
    c.drawImage(bitmap, 0, y, canvas.width, (canvas.width * 630) / 1200);
    c.fillStyle = '#dce4ed';
    c.font = '20px system-ui';
    if (orientation === 'vertical' && model.share) {
      c.font = '26px system-ui';
      c.fillText('Keeper at this stop: ' + model.keeper, 32, 150, 656);
      c.font = '22px system-ui';
      c.fillText(
        'Current holder at export: ' + (model.share.holder ?? 'not recorded'),
        32,
        195,
        656,
      );
      c.font = '20px system-ui';
      c.fillText(
        model.share.hops + ' retained completed hops · Ring ' + model.ringIndex + ' at this stop',
        32,
        235,
        656,
      );
      c.fillText(
        'Approved engravings · ' +
          model.share.engravings.length +
          ' of ' +
          model.share.totalEngravings +
          ' shown',
        32,
        720,
        656,
      );
      for (const [i, word] of model.share.engravings.entries())
        c.fillText(word, 32 + (i % 2) * 330, 766 + Math.floor(i / 2) * 36, 306);
      c.fillText(model.caption, 32, 930, 656);
      const recent = model.share.route.slice(-4);
      c.fillText(
        'Retained journey · last ' + recent.length + ' of ' + model.share.hops + ' stops',
        32,
        1040,
        656,
      );
      c.font = '18px system-ui';
      for (const [i, stop] of recent.entries())
        c.fillText(
          stop.ringIndex +
            ': ' +
            stop.from +
            ' → ' +
            stop.to +
            (stop.kind === 'wander' ? ' · Wander, no raid' : ''),
          32,
          1075 + i * 28,
          656,
        );
      if (model.disclaimer) {
        c.font = '16px system-ui';
        c.fillText('Unofficial fan project. Not affiliated with Twitch.', 32, 1240, 656);
      }
    } else if (orientation === 'vertical') {
      c.fillText('A ring received. A community remembered.', 32, 200, 656);
      c.fillText(model.caption, 32, 850, 656);
      if (model.disclaimer) {
        c.font = '16px system-ui';
        c.fillText('Unofficial fan project. Not affiliated with Twitch.', 32, 910, 656);
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
    const read = boundedCardRead(own.signal);
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
    const snapshot = await freshShareSnapshot(recorded.stopId, read);
    const exact = snapshot.exact;
    const names = networkNames;
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
      {
        mode: value.mode,
        share: snapshot.share,
        ...(stop.kind === 'wander' ? { kind: 'wander' } : {}),
      },
    );
    const blob = await keeperCardPNG(model, orientation, stop.raidAudience);
    await assertFreshShare(snapshot, recorded.stopId, read);
    const latestProfile = await read('/api/keeper/' + profile.login);
    const latestStop = latestProfile.profile?.received?.find((s) => s.stopId === recorded.stopId);
    if (
      latestProfile.mode !== value.mode ||
      latestProfile.profile?.login !== profile.login ||
      JSON.stringify(latestStop) !== JSON.stringify(stop) ||
      own.signal.aborted ||
      !current()
    )
      throw Error('Cancelled export');
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

// A real rendered card preview from the current public profile, not an export grant.
// Downloads still use the independent fresh-read/recheck path above.
export async function keeperCardThumbnail(profile, stop, mode) {
  keeperCardFilename(stop.ringIndex, profile.login, 'landscape');
  if (stop.to !== profile.login) throw Error('Keeper preview mismatch');
  const model = ringCardModel(
    {
      stopId: stop.stopId,
      keeper: '@' + profile.login,
      ringIndex: stop.ringIndex,
      claimedAt: stop.claimedAt,
    },
    {
      mode,
      ...(stop.kind === 'wander' ? { kind: 'wander' } : {}),
    },
  );
  const original = await keeperCardPNG(model, 'landscape', stop.raidAudience);
  const bitmap = await createImageBitmap(original);
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw Error('Preview canvas unavailable');
    context.drawImage(bitmap, 0, 0, 320, 180);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.type !== 'image/png' || blob.size > 32768)
      throw Error('Bounded preview required');
    return blob;
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
