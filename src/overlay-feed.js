// One-process ordered commit/read/publish queue. Cross-instance fanout is absent.
export function createOverlayFeed(store, channel, { simulator = false, now = Date.now } = {}) {
  if (!/^\d{1,32}$/.test(channel ?? '')) throw new Error('Configured overlay channel required');
  let queue = Promise.resolve(); let revision = 0;
  const listeners = new Set();
  const enqueue = operation => {
    const result = queue.then(operation); queue = result.catch(() => {}); return result;
  };
  async function read() {
    try {
      const state = await store.getOverlayState(channel);
      if (!['ready', 'waiting', 'paused'].includes(state.status) || !Array.isArray(state.marks) || state.marks.length > 160) throw new Error('Invalid public state');
      const serverNow = now();
      const journey = store.getPublicPresentation ? await store.getPublicPresentation(channel, serverNow)
        : { rings: 0, handoff: null };
      const marks = state.marks.map(({ id, runeSvg }) => ({ id, runeSvg }));
      return { type: 'snapshot', revision, mode: simulator ? 'simulator' : 'live', status: state.status, marks,
        approvedCount: marks.length, lineageRings: journey.rings, handoff: journey.handoff, serverNow };
    } catch {
      return { type: 'snapshot', revision, mode: simulator ? 'simulator' : 'live', status: 'unavailable', marks: [], approvedCount: 0, lineageRings: 0 };
    }
  }
  const wrapped = Object.create(store);
  for (const name of ['accept', 'setKeeperContext', 'controlMarks', 'setChannelPolicy']) {
    wrapped[name] = (...args) => enqueue(async () => {
      const result = await store[name](...args);
      revision++;
      const snapshot = await read();
      for (const listener of listeners) { try { listener(snapshot); } catch { /* A client cannot fail the commit. */ } }
      return result;
    });
  }
  return { store: wrapped, channel, simulator, snapshot: () => enqueue(read), subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
