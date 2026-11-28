// The platform at the edge: the requests in routes.mjs are answered here; every other one goes to the Node function.
import { createPlatformHandler } from './app.mjs';
import { hex, hmac } from './crypto.mjs';
import { edgeRoute, forwardProof } from './routes.mjs';

const handle = createPlatformHandler({ academicYear: __STUDEV_ACADEMIC_YEAR__ });
const hmacHex = (secret, text) => hex(hmac(secret, text));

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (edgeRoute(request.method, url.pathname)) return handle(context);
  const path = url.pathname, at = Date.now(), address = String(context.eo?.clientIp ?? '');
  const headers = new Headers(request.headers);
  for (const name of ['host', 'content-length']) headers.delete(name);
  headers.set('x-studev-client', address);
  headers.set('x-studev-at', String(at));
  headers.set('x-studev-proof', forwardProof(hmacHex, String(env.PLATFORM_SESSION_SECRET ?? ''), at, address, request.method, path));
  const target = new URL(path.replace(/^\/api\/platform/, '/node/platform') + url.search, url);
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  return fetch(target, { method: request.method, headers, body, redirect: 'manual' });
}
