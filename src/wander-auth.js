import { createHmac, timingSafeEqual } from 'node:crypto';
export const WANDER_PURPOSE = 'raid-relic-wander-v1';
export function wanderSignature(encodedKey, raw) {
  if (
    typeof encodedKey !== 'string' ||
    !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey) ||
    !Buffer.isBuffer(raw) ||
    raw.length > 512
  )
    throw Error('Wander signature input');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw Error('Wander key');
  const purpose = createHmac('sha256', key).update('raid-relic/internal/wander/v1').digest();
  return createHmac('sha256', purpose).update(raw).digest('hex');
}
export function verifyWanderRequest(key, raw, signature, now) {
  if (
    !Buffer.isBuffer(raw) ||
    raw.length > 512 ||
    typeof signature !== 'string' ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return null;
  const expected = Buffer.from(wanderSignature(key, raw), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw),
      v = JSON.parse(text);
    if (
      Object.keys(v).sort().join(',') !== 'nonce,purpose,timestamp' ||
      (text.match(/"(?:nonce|purpose|timestamp)"\s*:/g) ?? []).length !== 3 ||
      v.purpose !== WANDER_PURPOSE ||
      !/^[a-f0-9]{32}$/.test(v.nonce) ||
      !Number.isSafeInteger(v.timestamp) ||
      !Number.isSafeInteger(now) ||
      Math.abs(now - v.timestamp) > 60000
    )
      return null;
    return v;
  } catch {
    return null;
  }
}
