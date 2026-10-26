import { validStreak } from '../public/streak-view.js';
import { validFlightText } from '../public/cinematic.js';
import { validClaimMeter } from '../public/claim-meter.js';
// One mutation queue for every configured feed. Never wrap a wrapped store.
export function createOverlayHub(store, channels, { simulator = false, now = Date.now } = {}) {
  if (
    !channels.length ||
    channels.length > 4 ||
    !channels.every((channel) => /^\d{1,32}$/.test(channel))
  )
    throw new Error('Configured overlay channels required');
  let queue = Promise.resolve();
  let revision = 0;
  const enqueue = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const listeners = new Map(channels.map((id) => [id, new Set()]));
  async function read(channel) {
    try {
      const state = await store.getOverlayState(channel, now());
      if (
        !['ready', 'waiting', 'paused'].includes(state.status) ||
        !Array.isArray(state.marks) ||
        state.marks.length > 160
      )
        throw new Error('Invalid public state');
      const serverNow = now();
      const journey = store.getPublicPresentation
        ? await store.getPublicPresentation(channel, serverNow)
        : { rings: 0, handoff: null };
      if (journey.streak !== undefined && !validStreak(journey.streak))
        throw Error('Invalid streak');
      const echo = journey.resonance;
      if (
        echo &&
        (!Number.isFinite(echo.receivedAt) ||
          !Number.isFinite(echo.expiresAt) ||
          echo.expiresAt - echo.receivedAt !== 1200 ||
          !/^[a-f0-9]{64}$/.test(echo.id))
      )
        throw new Error('Invalid decorative cue');
      const resonance = echo
        ? { receivedAt: echo.receivedAt, expiresAt: echo.expiresAt, id: echo.id }
        : null;
      const marks = state.marks.map(({ id, runeSvg, faded, flightText }) => {
        if (faded !== undefined && typeof faded !== 'boolean')
          throw new Error('Invalid faded flag');
        if (flightText !== undefined && !validFlightText(flightText))
          throw Error('Invalid approved caption');
        return {
          id,
          runeSvg,
          ...(flightText === undefined ? {} : { flightText }),
          ...(faded === true ? { faded: true } : {}),
        };
      });
      if (journey.claimMeter != null && !validClaimMeter(journey.claimMeter))
        throw Error('Invalid claim meter');
      if (
        journey.handoff?.sourceLogin !== undefined &&
        !['raidrelichq', 'olsols2'].includes(journey.handoff.sourceLogin)
      )
        throw Error('Invalid source Keeper');
      if (
        journey.holderLogin !== undefined &&
        !['raidrelichq', 'olsols2'].includes(journey.holderLogin)
      )
        throw Error('Invalid registry holder');
      if (
        journey.movedToLogin !== undefined &&
        !['raidrelichq', 'olsols2'].includes(journey.movedToLogin)
      )
        throw Error('Invalid holder');
      const incoming = journey.handoff?.role === 'host' && !journey.handoff.completed;
      const status = incoming && state.status !== 'paused' ? 'incoming' : state.status;
      return {
        type: 'snapshot',
        revision,
        mode: simulator ? 'simulator' : 'live',
        status,
        ...(journey.holderLogin ? { holderLogin: journey.holderLogin } : {}),
        ...(status === 'waiting' && journey.movedToLogin
          ? { movedToLogin: journey.movedToLogin }
          : {}),
        ...(journey.streak === undefined ? {} : { streak: journey.streak }),
        marks,
        approvedCount: marks.length,
        lineageRings: journey.rings,
        handoff: journey.handoff,
        claimMeter: journey.claimMeter ?? null,
        ...(resonance ? { resonance } : {}),
        serverNow,
      };
    } catch {
      return {
        type: 'snapshot',
        revision,
        mode: simulator ? 'simulator' : 'live',
        status: 'unavailable',
        marks: [],
        approvedCount: 0,
        lineageRings: 0,
      };
    }
  }
  const wrapped = Object.create(store);
  for (const name of [
    'accept',
    'setKeeperContext',
    'controlMarks',
    'setChannelPolicy',
    'sendOffStep',
  ]) {
    if (!store[name]) continue;
    wrapped[name] = (...args) =>
      enqueue(async () => {
        const result = await store[name](...args);
        if (name === 'accept') {
          const input = args[0];
          const quiet =
            input.chat &&
            !input.chat.markAction &&
            !input.raid &&
            !input.lifecycle &&
            !input.observation;
          if (
            (quiet && result !== 'resonance') ||
            !(
              ['accepted', 'resonance', 'applied'].includes(result) ||
              ['reserved', 'accepted'].includes(result?.status)
            )
          )
            return result;
        }
        revision++;
        for (const channel of channels) {
          const snapshot = await read(channel);
          for (const listener of listeners.get(channel)) {
            try {
              listener(snapshot);
            } catch {
              /* Client cannot fail commit. */
            }
          }
        }
        return result;
      });
  }
  const feeds = Object.fromEntries(
    channels.map((channel) => [
      channel,
      {
        store: wrapped,
        channel,
        simulator,
        snapshot: () => enqueue(() => read(channel)),
        subscribe(listener) {
          listeners.get(channel).add(listener);
          return () => listeners.get(channel).delete(listener);
        },
      },
    ]),
  );
  return { store: wrapped, feeds };
}
export function createOverlayFeed(store, channel, options) {
  return createOverlayHub(store, [channel], options).feeds[channel];
}
