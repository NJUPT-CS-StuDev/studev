import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
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
    throw new Error('Use a password or collection code containing 6–256 characters.');
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

export function mac(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function sealSession(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${mac(secret, encoded)}`;
}

export function openSession(token, secret, nowSeconds) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra || !safeEqual(mac(secret, encoded), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (payload.v !== 1 || payload.role !== 'admin' || typeof payload.sid !== 'string' || !/^[a-f0-9]{48}$/.test(payload.sid)) return null;
    if (!Number.isSafeInteger(payload.exp) || payload.exp <= nowSeconds || payload.exp > nowSeconds + 7200) return null;
    return payload;
  } catch {
    return null;
  }
}
