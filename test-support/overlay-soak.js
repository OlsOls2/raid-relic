export const OVERLAY_WALL_MS = 7200000;
export function overlaySoakOptions(args = []) {
  if (
    args.some((a) => !/^--(?:mode=(?:smoke|wall|logical)|duration-ms=7200000)$/.test(a)) ||
    new Set(args.map((a) => a.split('=')[0])).size !== args.length
  )
    throw Error('Invalid soak options');
  const mode = args.find((a) => a.startsWith('--mode='))?.slice(7) ?? 'smoke';
  const duration = args.includes('--duration-ms=7200000');
  if ((mode === 'wall') !== duration) throw Error('Wall mode requires explicit two-hour duration');
  return {
    mode,
    durationMs: mode === 'smoke' ? 20000 : OVERLAY_WALL_MS,
    warmupMs: mode === 'wall' ? 120000 : 2000,
    logical: mode === 'logical',
  };
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
