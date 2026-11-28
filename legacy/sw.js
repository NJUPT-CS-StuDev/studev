// studev.hicancan.top moved to studev.cn. Every other address there answers with a permanent redirect; this worker
// replaces the site's old offline worker so no browser keeps serving the old copy: it clears what that worker stored,
// unregisters, and sends each open page to the same address on studev.cn.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: 'window' })) {
    const from = new URL(client.url);
    client.navigate('https://studev.cn' + from.pathname + from.search + from.hash);
  }
})()));
