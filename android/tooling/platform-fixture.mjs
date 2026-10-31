// Local acceptance uses the production handler and injected Blob/storage adapters.
// No cloud credentials, production requests or alternate application branches.
import { createServer } from 'node:http';
import { createPlatformHandler } from '../../src/server/platform-app.mjs';
import { memoryBlob, memoryGateway, testEnvironment } from '../../tests/helpers/platform-fixtures.mjs';

const origin = 'http://127.0.0.1:4319';
const { env } = await testEnvironment();
env.PLATFORM_ORIGIN = origin;
const store = memoryBlob(), gateway = memoryGateway();
const handle = createPlatformHandler({ getStore: () => store, getGateway: () => gateway });
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin);
    if (!url.pathname.startsWith('/api/platform/')) { outgoing.writeHead(404); outgoing.end(); return; }
    const parts = []; let bytes = 0;
    for await (const part of incoming) { bytes += part.length; if (bytes > 65_536) { outgoing.writeHead(413); outgoing.end(); return; } parts.push(part); }
    const response = await handle({ env, clientIp: 'loopback-acceptance', request: new Request(url, {
      method: incoming.method, headers: incoming.headers,
      ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(parts) }),
    }) });
    const headers = Object.fromEntries(response.headers);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    outgoing.writeHead(response.status, headers); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end(); }
});
server.listen(4319, '127.0.0.1', () => console.log(JSON.stringify({ origin, storage: 'in-memory', production: false })));
