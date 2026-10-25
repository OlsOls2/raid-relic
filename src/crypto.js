import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
export function createTokenCipher(encodedKey) {
  if (typeof encodedKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes in canonical base64');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) throw new Error('Invalid encryption key');
  return {
    seal(value, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
    },
    open(record, context) {
      try {
        if (record.v !== 1) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
      } catch { throw new Error('Encrypted token unavailable'); }
    },
  };
}
