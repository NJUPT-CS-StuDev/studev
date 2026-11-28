// Cryptography the platform needs, in plain JavaScript and Web Crypto, so the same code runs on the edge and in Node.
// Hashes and MACs are synchronous (they hash a few hundred bytes); only the password function is expensive, and it
// comes from ./password.mjs, which runs in the Node function alone.
import { sha256 } from '@noble/hashes/sha2.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { hmac as nobleHmac } from '@noble/hashes/hmac.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { scrypt } from './password.mjs';

export { bytesToHex as hex, concatBytes as concat, utf8ToBytes as utf8 };

const bytes = (value) => typeof value === 'string' ? utf8ToBytes(value) : value;

/** SHA-256 of the text of a value, as hex. */
export function digest(value) {
  return bytesToHex(sha256(utf8ToBytes(String(value))));
}

/** HMAC of the parts (strings or bytes) in order. */
export function hmac(key, ...parts) {
  const mac = nobleHmac.create(sha256, bytes(key));
  for (const part of parts) mac.update(bytes(part));
  return mac.digest();
}
export const hmacSha1 = (key, message) => nobleHmac(sha1, bytes(key), bytes(message));

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}
export const randomHex = (length) => bytesToHex(randomBytes(length));
export const randomToken = (length = 32) => base64url(randomBytes(length));
export const randomUUID = () => crypto.randomUUID();
/** A uniform integer in [min, max). */
export function randomInt(min, max) {
  if (max === undefined) [min, max] = [0, min];
  const range = max - min, limit = Math.floor(0x100000000 / range) * range, word = new Uint32Array(1);
  do crypto.getRandomValues(word); while (word[0] >= limit);
  return min + (word[0] % range);
}

export function base64(value) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export const base64url = (value) => base64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function fromBase64(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Compares in time that depends only on the lengths. */
export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export const safeEqual = (left, right) => equalBytes(utf8ToBytes(String(left)), utf8ToBytes(String(right)));

// Provisioning helper. Never call this with a password taken from a public request.
export async function hashPassword(password, salt = randomHex(16)) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 256) {
    throw new Error('Use a password containing 6–256 characters.');
  }
  return `scrypt$16384$8$1$${salt}$${await scrypt(password, salt)}`;
}

export function validPasswordHash(value) {
  return /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(String(value));
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 256 || !validPasswordHash(encoded)) return false;
  const [, , , , salt, expected] = encoded.split('$');
  return safeEqual(await scrypt(password, salt), expected);
}
