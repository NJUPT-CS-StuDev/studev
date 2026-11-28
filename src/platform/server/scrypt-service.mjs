// The Node function behind /node/scrypt: it runs the password function for the edge platform and nothing else.
import { scrypt } from './scrypt.mjs';
import { equalBytes, fromBase64 } from './crypto.mjs';
import { scryptProof } from './scrypt.edge.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequest({ request, env }) {
  const secret = env.PLATFORM_SESSION_SECRET;
  if (request.method !== 'POST' || typeof secret !== 'string' || secret.length < 32) return reply({ error: 'unavailable' }, 404);
  let body;
  try { body = JSON.parse(await request.text()); } catch { return reply({ error: 'invalid' }, 400); }
  const { password, salt, at, proof } = body ?? {};
  if (typeof password !== 'string' || password.length > 256 || typeof salt !== 'string' || !/^[a-f0-9]{32}$/.test(salt) ||
      !Number.isSafeInteger(at) || Math.abs(Date.now() - at) > 60_000 || typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
      !equalBytes(fromBase64(proof), scryptProof(secret, password, salt, at))) return reply({ error: 'rejected' }, 403);
  return reply({ key: await scrypt(password, salt) });
}
