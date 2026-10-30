import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { optimizeContactPNG } from '../test-support/png-contact.js';
import { pngRGBA } from '../test-support/png-rgba.js';
const width = 1280,
  height = 720;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crc = (bytes) => {
  let n = 0xffffffff;
  for (const byte of bytes) {
    n ^= byte;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
};
const chunk = (type, bytes) => {
  const out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length);
  out.write(type, 4);
  bytes.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4);
  return out;
};
const paeth = (a, b, c) => {
  const p = a + b - c,
    x = Math.abs(p - a),
    y = Math.abs(p - b),
    z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
};
function fixture({
  alpha = false,
  opaqueAlpha = false,
  noise = false,
  badFilter = false,
  badGeometry = false,
} = {}) {
  const bpp = alpha ? 4 : 3,
    stride = width * bpp;
  const pixels = Buffer.alloc(stride * height),
    raw = Buffer.alloc((stride + 1) * height);
  let seed = 1234567;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * bpp;
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels[i] = noise ? (seed >>> 27) * 8 : (x >>> 3) & 255;
      pixels[i + 1] = noise ? 0 : (y >>> 2) & 255;
      pixels[i + 2] = noise ? 0 : (x + y) & 255;
      if (alpha) pixels[i + 3] = opaqueAlpha || x % 3 ? 255 : y % 256;
    }
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    raw[y * (stride + 1)] = badFilter ? 5 : filter;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = y && x >= bpp ? pixels[(y - 1) * stride + x - bpp] : 0;
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      raw[y * (stride + 1) + x + 1] = (pixels[y * stride + x] - prediction) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(badGeometry ? width + 1 : width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  const png = Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, pixels, bpp };
}
for (const options of [{ alpha: false }, { alpha: true }, { alpha: true, opaqueAlpha: true }])
  test(`contact PNG losslessly roundtrips every ${JSON.stringify(options)} pixel and all filters`, () => {
    const { alpha, opaqueAlpha } = options;
    const { png, pixels, bpp } = fixture(options);
    const output = optimizeContactPNG(png);
    assert.ok(output.length <= 524288);
    assert.equal(output[25], alpha && !opaqueAlpha ? 6 : 2);
    const decoded = pngRGBA(output);
    assert.equal(decoded.width, width);
    assert.equal(decoded.height, height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * bpp,
          actual = decoded.pixel(x, y);
        assert.equal(actual[0], pixels[i]);
        assert.equal(actual[1], pixels[i + 1]);
        assert.equal(actual[2], pixels[i + 2]);
        assert.equal(actual[3], alpha ? pixels[i + 3] : 255);
      }
  });
test('contact PNG rejects invalid geometry, CRC, filters, truncation and input/output caps', () => {
  assert.throws(() => optimizeContactPNG(fixture({ badGeometry: true }).png), /geometry/);
  assert.throws(() => optimizeContactPNG(fixture({ badFilter: true }).png));
  const { png } = fixture();
  const corrupt = Buffer.from(png);
  corrupt[29] ^= 1;
  assert.throws(() => optimizeContactPNG(corrupt), /CRC/);
  assert.throws(() => optimizeContactPNG(png.subarray(0, -12)), /incomplete/);
  assert.throws(() => optimizeContactPNG(Buffer.alloc(1048577)), /input/);
  const noisy = fixture({ noise: true }).png;
  assert.ok(noisy.length <= 1048576, 'bounded input exercises final output cap');
  assert.throws(() => optimizeContactPNG(noisy), /output cap/);
});

test('contact PNG accepts bounded consecutive split IDAT and rejects excessive, reordered or corrupt chunks', () => {
  const { png, pixels } = fixture();
  // This fixture has one IHDR, one IDAT and IEND; split only the original
  // compressed stream, preserving all bytes and recalculating each chunk CRC.
  const idatLength = png.readUInt32BE(33);
  const compressed = png.subarray(41, 41 + idatLength);
  const split = (parts, interrupt = false) => {
    const chunks = [signature, png.subarray(8, 33)];
    for (let i = 0; i < parts; i++) {
      chunks.push(
        chunk(
          'IDAT',
          compressed.subarray(
            Math.floor((i * compressed.length) / parts),
            Math.floor(((i + 1) * compressed.length) / parts),
          ),
        ),
      );
      if (interrupt && i === 0) chunks.push(chunk('sRGB', Buffer.from([0])));
    }
    chunks.push(chunk('IEND', Buffer.alloc(0)));
    return Buffer.concat(chunks);
  };
  const segmented = split(200);
  assert.ok(segmented.length <= 1048576);
  const output = optimizeContactPNG(segmented);
  assert.ok(output.length <= 524288);
  const decoded = pngRGBA(output);
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3,
        actual = decoded.pixel(x, y);
      assert.equal(actual[0], pixels[i]);
      assert.equal(actual[1], pixels[i + 1]);
      assert.equal(actual[2], pixels[i + 2]);
      assert.equal(actual[3], 255);
    }
  assert.throws(() => optimizeContactPNG(split(257)), /chunks/);
  assert.throws(() => optimizeContactPNG(split(200, true)), /order/);
  const corrupt = Buffer.from(segmented);
  corrupt[41] ^= 1;
  assert.throws(() => optimizeContactPNG(corrupt), /CRC/);
});
