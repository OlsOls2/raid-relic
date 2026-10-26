// Pure local QA raster planner. No browser, filesystem, network or app effects.
export const RASTER_LIMIT = 16 * 1024 * 1024;
export function captureTiles(
  width,
  viewportHeight,
  documentHeight,
  { overlap = 64, maxTiles = 8 } = {},
) {
  if (
    ![width, viewportHeight, documentHeight, overlap, maxTiles].every(Number.isSafeInteger) ||
    width < 1 ||
    viewportHeight < 1 ||
    viewportHeight > 1080 ||
    documentHeight < 1 ||
    overlap < 0 ||
    overlap >= viewportHeight ||
    maxTiles < 1 ||
    maxTiles > 8 ||
    width * viewportHeight * 4 >= RASTER_LIMIT
  )
    throw Error('Bounded raster rejected');
  const ranges = [{ start: 0, end: Math.min(viewportHeight, documentHeight) }];
  while (ranges.at(-1).end < documentHeight) {
    if (ranges.length >= maxTiles) throw Error('Document exceeds tile coverage bound');
    const start = Math.min(ranges.at(-1).end - overlap, documentHeight - viewportHeight);
    if (start <= ranges.at(-1).start) throw Error('Invalid tile progression');
    ranges.push({ start, end: Math.min(start + viewportHeight, documentHeight) });
  }
  return ranges;
}
