// The password function on the edge. scrypt costs about as much CPU as an edge request may spend, so the edge asks
// the Node function at /node/scrypt, which runs it natively. The request is bound to the platform secret and a
// timestamp, so the endpoint answers only this platform and a recorded request cannot be replayed later.
import { base64url, hmac } from './crypto.mjs';

let service;
export function bindScrypt(env) {
  service = { url: new URL('/node/scrypt', env.PLATFORM_ORIGIN).href, secret: env.PLATFORM_SESSION_SECRET };
}

export async function scrypt(password, salt) {
  if (!service) throw new Error('The password service is not bound.');
  const at = Date.now();
  const response = await fetch(service.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, salt, at, proof: base64url(scryptProof(service.secret, password, salt, at)) }),
  });
  const result = response.ok ? await response.json() : null;
  if (typeof result?.key !== 'string' || !/^[a-f0-9]{64}$/.test(result.key)) throw new Error(`The password service failed (${response.status}).`);
  return result.key;
}

export const scryptProof = (secret, password, salt, at) => hmac(secret, 'studev-scrypt\0', String(at), '\0', salt, '\0', password);
