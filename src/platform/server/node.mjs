// The platform in Node, behind /node/platform: the requests the edge hands over (routes.mjs), with the visitor's address.
import { createPlatformHandler } from './app.mjs';
import { hex, hmac, safeEqual } from './crypto.mjs';
import { forwardProof } from './routes.mjs';

const handle = createPlatformHandler({ academicYear: __STUDEV_ACADEMIC_YEAR__ });
const hmacHex = (secret, text) => hex(hmac(secret, text));
const refuse = () => new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/node\/platform/, '/api/platform');
  const address = request.headers.get('x-studev-client') ?? '', at = Number(request.headers.get('x-studev-at'));
  const secret = String(env.PLATFORM_SESSION_SECRET ?? '');
  if (secret.length < 32 || !Number.isSafeInteger(at) || Math.abs(Date.now() - at) > 60_000 ||
      !safeEqual(request.headers.get('x-studev-proof') ?? '', forwardProof(hmacHex, secret, at, address, request.method, path))) return refuse();
  // EdgeOne's Node wrapper replaces Request.body; the bytes it read are kept in _rawBodyBuffer.
  const raw = request._rawBodyBuffer ?? (['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer());
  const headers = new Headers(request.headers);
  for (const name of ['x-studev-client', 'x-studev-at', 'x-studev-proof']) headers.delete(name);
  const forwarded = new Request(new URL(path + url.search, url), { method: request.method, headers, body: raw && raw.byteLength ? raw : undefined });
  return handle({ ...context, request: forwarded, eo: { clientIp: address } });
}
