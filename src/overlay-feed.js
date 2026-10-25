// One mutation queue for every configured feed. Never wrap a wrapped store.
export function createOverlayHub(store, channels, { simulator = false, now = Date.now } = {}) {
  if (!channels.length || channels.length > 4 || !channels.every(channel => /^\d{1,32}$/.test(channel))) throw new Error('Configured overlay channels required');
  let queue = Promise.resolve(); let revision = 0;
  const enqueue = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
  const listeners = new Map(channels.map(id => [id, new Set()]));
  async function read(channel) {
    try {
      const state = await store.getOverlayState(channel, now());
      if (!['ready', 'waiting', 'paused'].includes(state.status) || !Array.isArray(state.marks) || state.marks.length > 160) throw new Error('Invalid public state');
      const serverNow = now(); const journey = store.getPublicPresentation ? await store.getPublicPresentation(channel, serverNow) : { rings: 0, handoff: null };
      const marks = state.marks.map(({ id, runeSvg }) => ({ id, runeSvg }));
      const incoming = journey.handoff?.role === 'host' && !journey.handoff.completed;
      return { type: 'snapshot', revision, mode: simulator ? 'simulator' : 'live', status: incoming && state.status !== 'paused' ? 'incoming' : state.status,
        marks, approvedCount: marks.length, lineageRings: journey.rings, handoff: journey.handoff, serverNow };
    } catch { return { type: 'snapshot', revision, mode: simulator ? 'simulator' : 'live', status: 'unavailable', marks: [], approvedCount: 0, lineageRings: 0 }; }
  }
  const wrapped = Object.create(store);
  for (const name of ['accept', 'setKeeperContext', 'controlMarks', 'setChannelPolicy', 'sendOffStep']) {
    if (!store[name]) continue;
    wrapped[name] = (...args) => enqueue(async () => {
      const result = await store[name](...args);
      if (name === 'accept') {
        const input = args[0];
        const quiet = input.chat && !input.chat.markAction && !input.raid && !input.lifecycle && !input.observation;
        if (quiet || !(result === 'accepted' || result === 'applied' || result?.status === 'reserved')) return result;
      }
      revision++;
      for (const channel of channels) { const snapshot = await read(channel); for (const listener of listeners.get(channel)) { try { listener(snapshot); } catch { /* Client cannot fail commit. */ } } }
      return result;
    });
  }
  const feeds = Object.fromEntries(channels.map(channel => [channel, { store: wrapped, channel, simulator,
    snapshot: () => enqueue(() => read(channel)), subscribe(listener) { listeners.get(channel).add(listener); return () => listeners.get(channel).delete(listener); } }]));
  return { store: wrapped, feeds };
}
export function createOverlayFeed(store, channel, options) { return createOverlayHub(store, [channel], options).feeds[channel]; }
