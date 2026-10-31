import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

// Provisioning helper. Never call this with a password taken from a public request.
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 256) {
    throw new Error('Use a password containing 6–256 characters.');
  }
  const result = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt}$${Buffer.from(result).toString('hex')}`;
}

export function validPasswordHash(value) {
  return /^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(String(value));
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 256 || !validPasswordHash(encoded)) return false;
  const [, , , , salt, expected] = encoded.split('$');
  const actual = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return safeEqual(Buffer.from(actual).toString('hex'), expected);
}

