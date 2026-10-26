// Bounded PNG evidence decoder for local browser screenshots; no external package.
import { inflateSync } from 'node:zlib';
export function pngRGBA(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw Error('png');
  let at = 8,
    width,
    height,
    depth,
    color;
  const chunks = [];
  while (at + 12 <= bytes.length) {
    const n = bytes.readUInt32BE(at),
      kind = bytes.toString('ascii', at + 4, at + 8);
    if (n > 4 * 1024 * 1024 || at + 12 + n > bytes.length) throw Error('png');
    const body = bytes.subarray(at + 8, at + 8 + n);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      color = body[9];
      if (body[12] !== 0) throw Error('png');
    }
    if (kind === 'IDAT') chunks.push(body);
    at += 12 + n;
    if (kind === 'IEND') break;
  }
  if (!width || !height || width * height > 1280 * 1080 || depth !== 8 || ![2, 6].includes(color))
    throw Error('png');
  const bpp = color === 6 ? 4 : 3,
    stride = width * bpp,
    raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw Error('png');
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error('png');
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[y * stride + x - bpp] : 0,
        b = y ? pixels[(y - 1) * stride + x] : 0,
        c = y && x >= bpp ? pixels[(y - 1) * stride + x - bpp] : 0;
      pixels[y * stride + x] =
        (raw[y * (stride + 1) + 1 + x] +
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) &
        255;
    }
  }
  return {
    width,
    height,
    pixel(x, y) {
      const p = (y * width + x) * bpp;
      return [pixels[p], pixels[p + 1], pixels[p + 2], bpp === 4 ? pixels[p + 3] : 255];
    },
  };
}
