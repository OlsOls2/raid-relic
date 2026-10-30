// Test-only lossless contact-sheet encoder. Never used by application exports.
import { deflateSync } from 'node:zlib';
import { pngRGBA } from './png-rgba.js';
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const WIDTH = 1280,
  HEIGHT = 720,
  OUTPUT_CAP = 524288;
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4);
  return out;
}
const paeth = (a, b, c) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
export function optimizeContactPNG(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1048576 || !bytes.subarray(0, 8).equals(SIGNATURE))
    throw Error('Contact PNG input');
  let at = 8,
    count = 0,
    nonDataCount = 0,
    header,
    ended = false,
    seenData = false,
    dataEnded = false;
  const metadata = [];
  while (at < bytes.length) {
    // Native canvas may split IDAT into 4096-byte pieces. Bound the physical
    // container to ceil(1 MiB / 4096) + IHDR/IEND, without changing byte caps.
    if (++count > 258 || at + 12 > bytes.length) throw Error('Contact PNG chunks');
    const length = bytes.readUInt32BE(at);
    if (length > 1048576 || at + 12 + length > bytes.length) throw Error('Contact PNG chunks');
    const type = bytes.toString('ascii', at + 4, at + 8);
    if (type !== 'IDAT' && ++nonDataCount > 128) throw Error('Contact PNG chunks');
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (crc(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(at + 8 + length))
      throw Error('Contact PNG CRC');
    if (count === 1 && type !== 'IHDR') throw Error('Contact PNG header');
    if (type === 'IHDR') {
      if (
        header ||
        length !== 13 ||
        body.readUInt32BE(0) !== WIDTH ||
        body.readUInt32BE(4) !== HEIGHT ||
        body[8] !== 8 ||
        ![2, 6].includes(body[9]) ||
        body[10] !== 0 ||
        body[11] !== 0 ||
        body[12] !== 0
      )
        throw Error('Contact PNG geometry');
      header = Buffer.from(body);
    } else if (type === 'IDAT') {
      if (dataEnded) throw Error('Contact PNG order');
      seenData = true;
    } else if (type === 'IEND') {
      if (!seenData || length !== 0 || at + 12 !== bytes.length) throw Error('Contact PNG end');
      ended = true;
    } else {
      if (!['sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(type) || length > 64)
        throw Error('Contact PNG metadata');
      metadata.push(chunk(type, body));
      if (seenData) dataEnded = true;
    }
    at += length + 12;
  }
  if (!header || !ended) throw Error('Contact PNG incomplete');
  // The existing decoder bounds inflation to exactly the expected scanline size
  // (at most 3,687,120 bytes) and reverses all five standard PNG filters.
  const decoded = pngRGBA(bytes);
  let opaque = true;
  if (header[9] === 6) {
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) if (decoded.pixel(x, y)[3] !== 255) opaque = false;
  }
  const bpp = opaque ? 3 : 4,
    stride = WIDTH * bpp;
  const pixels = Buffer.alloc(stride * HEIGHT);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const pixel = decoded.pixel(x, y);
      for (let c = 0; c < bpp; c++) pixels[y * stride + x * bpp + c] = pixel[c];
    }
  const filtered = Buffer.alloc((stride + 1) * HEIGHT);
  const candidate = Buffer.alloc(stride),
    best = Buffer.alloc(stride);
  for (let y = 0; y < HEIGHT; y++) {
    let bestScore = Infinity,
      bestFilter = 0;
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? pixels[y * stride + x - bpp] : 0;
        const b = y ? pixels[(y - 1) * stride + x] : 0;
        const c = y && x >= bpp ? pixels[(y - 1) * stride + x - bpp] : 0;
        const prediction =
          filter === 0
            ? 0
            : filter === 1
              ? a
              : filter === 2
                ? b
                : filter === 3
                  ? Math.floor((a + b) / 2)
                  : paeth(a, b, c);
        const value = (pixels[y * stride + x] - prediction) & 255;
        candidate[x] = value;
        score += Math.min(value, 256 - value);
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        candidate.copy(best);
      }
    }
    filtered[y * (stride + 1)] = bestFilter;
    best.copy(filtered, y * (stride + 1) + 1);
  }
  header[9] = opaque ? 2 : 6;
  const out = Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    ...metadata,
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  if (out.length > OUTPUT_CAP) throw Error('Contact PNG output cap');
  return out;
}
