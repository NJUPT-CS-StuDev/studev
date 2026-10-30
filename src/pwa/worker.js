/* Classic service worker; DATA_VERSION is injected by the static Astro endpoint. */
const SHELL = `studev-shell-2-${DATA_VERSION}`;
const DATA = `studev-data-${DATA_VERSION}`;
const META = 'studev-release';
const SHELL_PATHS = ['/', '/map/', '/search/', '/search/timetable/', '/search/exam/', '/search/classrooms/'];
const PUBLIC_PAGE = new Set(SHELL_PATHS);
const saved = new Set();

async function announce(message) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(client => client.postMessage(message));
}

async function remember(url, cache, recursive = false) {
    const absolute = new URL(url, self.location.origin).href;
    if (saved.has(absolute)) return;
    saved.add(absolute);
    try {
        const response = await fetch(absolute, { credentials: 'omit' });
        if (!response.ok || response.status === 206) throw new Error(`HTTP ${response.status}`);
        await cache.put(absolute, response.clone());
        const type = response.headers.get('Content-Type') || '';
        if (!recursive || !/(javascript|text\/css|text\/html)/.test(type)) return;
        const text = await response.text();
        // Vite emits template-literal asset URLs; HTML srcset includes space-separated descriptors.
        const references = [...text.matchAll(/["'`(,\s]((?:\.?\.\/|\/_astro\/)[^"'`()\s<>,]+)(?=["'`()\s,])/g)].map(match => match[1]);
        await Promise.all(references.map(reference => {
            const asset = new URL(reference, absolute);
            if (reference.includes('${') || asset.origin !== self.location.origin || !asset.pathname.startsWith('/_astro/')) return;
            return remember(asset.href, cache, true);
        }));
    } catch (error) { saved.delete(absolute); throw error; }
}

async function saveFiles(paths, cache, recursive = false) {
    let cursor = 0;
    let failed = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
        while (cursor < paths.length) {
            const path = paths[cursor++];
            try { await remember(path, cache, recursive); } catch { failed++; }
        }
    }));
    return failed;
}

async function warm(all = false) {
    await announce({ type: 'OFFLINE_SAVING' });
    const response = await fetch('/pwa-release.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('release unavailable');
    const release = await response.clone().json();
    // A page that is still running the previous worker must update before saving a new release.
    if (release.version !== DATA_VERSION) {
        await announce({ type: 'DATA_UPDATE', version: release.version });
        return;
    }
    await (await caches.open(META)).put('/pwa-release.json', response);
    const shell = await caches.open(SHELL);
    const shellFailed = await saveFiles([...SHELL_PATHS, '/manifest.webmanifest', '/pwa-icons/180.png', '/pwa-icons/192.png', '/pwa-icons/512.png', '/pwa-icons/512-maskable.png'], shell, true);
    const data = await caches.open(DATA);
    const failed = shellFailed + await saveFiles(all ? [...release.core, ...release.all] : release.core, data);
    if (!failed) await data.put('/__studev_offline_ready__', new Response(JSON.stringify({ version: DATA_VERSION, all }), { headers: { 'Content-Type': 'application/json' } }));
    await announce({ type: failed ? 'OFFLINE_PARTIAL' : 'OFFLINE_READY', version: DATA_VERSION, all, failed });
}

self.addEventListener('install', event => {
    event.waitUntil(warm().catch(() => announce({ type: 'OFFLINE_PARTIAL' })));
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        // Keep one previous release for open tabs; activating an update never strands their data.
        const keys = await caches.keys();
        for (const prefix of ['studev-shell-', 'studev-data-']) {
            const candidates = keys.filter(key => key.startsWith(prefix));
            await Promise.all(candidates.slice(0, -2).map(key => caches.delete(key)));
        }
        await self.clients.claim();
        await announce({ type: 'WORKER_ACTIVE', version: DATA_VERSION });
    })());
});
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data?.type === 'SAVE_OFFLINE') event.waitUntil(warm(Boolean(event.data.all)).catch(() => announce({ type: 'OFFLINE_PARTIAL' })));
});

async function rangeResponse(response, header) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 });
    const body = await response.arrayBuffer();
    const size = body.byteLength;
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] ? Math.min(match[2] ? Number(match[2]) : size - 1, size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const headers = new Headers(response.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(body.slice(start, end + 1), { status: 206, headers });
}

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;
    const path = url.pathname;
    if (path === '/pwa-release.json') {
        event.respondWith((async () => {
            const cache = await caches.open(META);
            const cached = await cache.match(path);
            const refresh = fetch(request, { cache: 'no-cache' }).then(async response => {
                if (response.ok) {
                    const release = await response.clone().json();
                    await cache.put(path, response.clone());
                    if (release.version !== DATA_VERSION) await announce({ type: 'DATA_UPDATE', version: release.version });
                }
                return response;
            });
            event.waitUntil(refresh.catch(() => undefined));
            return cached || refresh;
        })());
        return;
    }
    if (request.mode === 'navigate') {
        // Account, forms and submission pages are never written to an offline cache.
        if (!PUBLIC_PAGE.has(path)) return;
        event.respondWith((async () => {
            const cache = await caches.open(SHELL);
            try {
                const response = await fetch(request);
                if (response.ok) await cache.put(path, response.clone());
                return response;
            } catch { return (await cache.match(path)) || Response.error(); }
        })());
        return;
    }
    if (!path.startsWith('/data/') && !path.startsWith('/_astro/') && !path.startsWith('/map/') && !path.startsWith('/pwa-icons/') && path !== '/manifest.webmanifest') return;
    event.respondWith((async () => {
        const cache = await caches.open(path.startsWith('/data/') || path.startsWith('/map/') ? DATA : SHELL);
        // Cache full PMTiles, then serve byte ranges locally. Never cache a 206 as a whole archive.
        const range = request.headers.get('Range');
        const key = request.url;
        let response = await cache.match(key);
        if (!response) {
            const headers = new Headers(request.headers);
            headers.delete('Range');
            response = await fetch(new Request(request, { headers }));
            if (response.ok && response.status !== 206) await cache.put(key, response.clone());
        }
        return range && response.status === 200 ? rangeResponse(response, range) : response;
    })());
});
