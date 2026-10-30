export const OVERLAY_WALL_MS = 7200000;
export function overlaySoakOptions(args = []) {
  if (
    args.some(
      (a) =>
        !/^--(?:mode=(?:smoke|wall|wall-probe|obs-wall|obs-probe|logical)|duration-ms=(?:7200000|600000|3600000|20000))$/.test(
          a,
        ),
    ) ||
    new Set(args.map((a) => a.split('=')[0])).size !== args.length
  )
    throw Error('Invalid soak options');
  const mode = args.find((a) => a.startsWith('--mode='))?.slice(7) ?? 'smoke';
  const requested = args.find((a) => a.startsWith('--duration-ms='));
  const required = {
    wall: '--duration-ms=7200000',
    'wall-probe': '--duration-ms=600000',
    'obs-wall': '--duration-ms=3600000',
    'obs-probe': '--duration-ms=20000',
  }[mode];
  if (requested !== required) throw Error('Wall modes require their exact explicit duration');
  return {
    mode,
    durationMs: ['smoke', 'obs-probe'].includes(mode)
      ? 20000
      : mode === 'wall-probe'
        ? 600000
        : mode === 'obs-wall'
          ? 3600000
          : OVERLAY_WALL_MS,
    warmupMs: mode === 'wall' ? 120000 : 2000,
    logical: mode === 'logical',
  };
}
// Floor cumulative elapsed time, not each interval: preserve sub-ms remainder
// without passing fractional timestamps into a Date.now()-based fixture.
export function overlayFixtureElapsed(elapsed, duration) {
  if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isSafeInteger(duration) || duration < 1)
    throw Error('Invalid fixture clock');
  return Math.floor(Math.min(elapsed, duration));
}
export function overlaySoakBounds(samples) {
  if (samples.length < 2 || samples.length > 25) return false;
  const a = samples[0],
    b = samples.at(-1);
  return (
    samples.every(
      (s) =>
        Object.values(s).every(Number.isFinite) &&
        s.canvases === 1 &&
        s.geometry <= a.geometry + 2 &&
        s.textures <= a.textures + 2 &&
        s.nodes <= a.nodes + 64 &&
        s.listeners <= a.listeners + 8 &&
        s.documents <= a.documents + 1 &&
        s.triangles < 20000,
    ) &&
    b.heap <= a.heap * 1.1 + 8 * 1024 * 1024 &&
    b.frames > a.frames
  );
}
