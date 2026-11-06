import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  if (!/^[A-Z2-7]{16,128}$/.test(value)) throw new Error('Invalid TOTP secret.');
  let bits = 0, accumulator = 0;
  const output = [];
  for (const char of value) {
    accumulator = (accumulator << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) { output.push((accumulator >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(output);
}

export function newTotpSecret() { return base32Encode(randomBytes(20)); }

export function totpCode(secret, counter, digits = 6) {
  if (!Number.isSafeInteger(counter) || counter < 0 || ![6, 8].includes(digits)) throw new Error('Invalid TOTP counter.');
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}

export function matchedTotpCounter(secret, code, milliseconds) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(milliseconds / 30_000);
  // Prefer the current step when a rare six-digit collision occurs.
  for (const counter of [current, current - 1, current + 1]) {
    if (counter < 0) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, counter)), Buffer.from(code))) return counter;
  }
  return null;
}

function encryptionKey(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('Invalid encryption key.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('Invalid encryption key.');
  return key;
}

export function encryptTotp(secret, key, userId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(`studev-totp-v1:${userId}`));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptTotp(value, key, userId) {
  if (!value || value.version !== 1) throw new Error('Invalid encrypted TOTP.');
  const iv = Buffer.from(value.iv, 'base64'), tag = Buffer.from(value.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted TOTP.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(key), iv);
  decipher.setAAD(Buffer.from(`studev-totp-v1:${userId}`));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}
