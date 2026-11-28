import { base64, equalBytes, fromBase64, hmacSha1, randomBytes, utf8 } from './crypto.mjs';

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
  return Uint8Array.from(output);
}

export function newTotpSecret() { return base32Encode(randomBytes(20)); }

export function totpCode(secret, counter, digits = 6) {
  if (!Number.isSafeInteger(counter) || counter < 0 || ![6, 8].includes(digits)) throw new Error('Invalid TOTP counter.');
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const digest = hmacSha1(base32Decode(secret), message);
  const offset = digest[digest.length - 1] & 15;
  return String((new DataView(digest.buffer, digest.byteOffset).getUint32(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}

export function matchedTotpCounter(secret, code, milliseconds) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(milliseconds / 30_000);
  // Prefer the current step when a rare six-digit collision occurs.
  for (const counter of [current, current - 1, current + 1]) {
    if (counter < 0) continue;
    if (equalBytes(utf8(totpCode(secret, counter)), utf8(code))) return counter;
  }
  return null;
}

function encryptionKey(encoded, usage) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('Invalid encryption key.');
  const key = fromBase64(encoded);
  if (key.length !== 32) throw new Error('Invalid encryption key.');
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, [usage]);
}

// AES-256-GCM with the account bound as associated data. Web Crypto appends the 16-byte tag to the ciphertext;
// the stored record keeps them apart.
export async function encryptTotp(secret, key, userId) {
  const iv = randomBytes(12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`studev-totp-v1:${userId}`) },
    await encryptionKey(key, 'encrypt'), utf8(secret)));
  return { version: 1, iv: base64(iv), data: base64(sealed.subarray(0, -16)), tag: base64(sealed.subarray(-16)) };
}

export async function decryptTotp(value, key, userId) {
  if (!value || value.version !== 1) throw new Error('Invalid encrypted TOTP.');
  const iv = fromBase64(value.iv), tag = fromBase64(value.tag), data = fromBase64(value.data);
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted TOTP.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8(`studev-totp-v1:${userId}`) },
    await encryptionKey(key, 'decrypt'), new Uint8Array([...data, ...tag]));
  return new TextDecoder().decode(plain);
}
