// studev.hicancan.top moved to studev.cn. This worker replaces the old site's offline worker so no browser keeps
// serving the old copy: it clears what that worker stored, unregisters, and reloads each open page from the network,
// where the note about the move takes over.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
})()));
