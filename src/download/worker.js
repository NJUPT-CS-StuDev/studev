import { apkResponse } from './stream.js';

/** The download worker owns exactly one route and does no install work.
 *
 * It is a separate registration from the PWA worker on purpose. That one
 * precaches the whole app shell and core campus data on install, which measured
 * 13.5 s, and navigator.serviceWorker.ready does not resolve until install
 * finishes. Sharing one worker meant the download page waited out that 13.5 s
 * before it could even read the version metadata, for a feature that has
 * nothing to do with offline use.
 *
 * Scope is /download/, so this worker never sees the rest of the site and the
 * PWA worker keeps its behaviour, its install cost and its "offline ready"
 * timing exactly as they were. */
async function announce(message) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(client => client.postMessage(message));
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('message', event => {
    if (event.data?.type === 'APK_READY') event.ports[0]?.postMessage({ ready: true });
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (!/^\/download\/[1-9][0-9]*\/studev-[A-Za-z0-9._-]+\.apk$/.test(url.pathname)) return;
    event.respondWith(apkResponse(request, message => { void announce(message); }).catch(async () => {
        await announce({ type: 'APK_DOWNLOAD', path: url.pathname, state: 'error' });
        return Response.error();
    }));
});
