// The password function, run natively in Node. The edge build replaces this module with ./scrypt.edge.mjs.
import { scrypt as scryptCallback } from 'node:crypto';

/** scrypt(N=16384, r=8, p=1) of a password and salt, as 64 hex digits. */
export function scrypt(password, salt) {
  return new Promise((resolve, reject) => scryptCallback(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key.toString('hex'))));
}
