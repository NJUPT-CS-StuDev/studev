/* Shell code and public campus snapshots have independent lifecycles. */
import { resourceAt } from '../campus/world/release.ts';
const SHELL = `studev-shell-${APP_VERSION}`;
const DATA = 'studev-public-data';
const META = 'studev-current-campus';
const ENTRY = `${DATA_ORIGIN}/campus-release.json`;
const RUNTIME = `${APP_ORIGIN}/app-release.json`;
const CURRENT = '/__studev_current_release__';
let knownOrigins;
const SHELL_PATHS = ['/', '/map/', '/search/'];
const PAGE = /^\/(?:[A-Za-z0-9_-]+\/)*$/;
const saved = new Set();

async function announce(message) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(client => client.postMessage(message));
}

/** The bundled assets a page, script or stylesheet names, as absolute URLs. */
function references(text, base) {
    // Vite emits absolute template-literal asset URLs. Relative strings are only
    // dependencies when imported or passed to new URL; WASM glue also contains
    // synthetic module identifiers such as "./kernel_bg.js" that are never fetched.
    return [
        ...text.matchAll(/["'`(,\s](\/_astro\/[^"'`()\s<>,]+)(?=["'`()\s,])/g),
        ...text.matchAll(/\b(?:from|import)\s*(?:\(\s*)?["'`]((?:\.\.?\/)[^"'`]+)["'`]/g),
        ...text.matchAll(/\bnew\s+URL\(\s*["'`]((?:\.\.?\/)[^"'`]+)["'`]/g),
    ].map(match => match[1]).filter(reference => !reference.includes('${')).map(reference => new URL(reference, base))
        .filter(asset => asset.origin === self.location.origin && asset.pathname.startsWith('/_astro/')).map(asset => asset.href);
}
const followed = type => /(javascript|text\/css|text\/html)/.test(type);

async function remember(url, cache, recursive = false) {
    const absolute = new URL(url, self.location.origin).href;
    if (saved.has(absolute)) return;
    saved.add(absolute);
    try {
        // Bundled assets are named by their content, so a saved one is final; pages and data are fetched again.
        let response = new URL(absolute).pathname.startsWith('/_astro/') ? await cache.match(absolute) : undefined;
        if (!response) {
            response = await fetch(absolute, { credentials: 'omit' });
            if (!response.ok || response.status === 206) throw new Error(`HTTP ${response.status}`);
            await cache.put(absolute, response.clone());
        }
        if (!recursive || !followed(response.headers.get('Content-Type') || '')) return;
        await Promise.all(references(await response.text(), absolute).map(asset => remember(asset, cache, true)));
    } catch (error) { saved.delete(absolute); throw error; }
}

/** Every bundled asset a saved page reaches, read from the saved copies alone. */
async function reach(cache, roots) {
    const seen = new Set(), queue = [...roots];
    while (queue.length) {
        const [url, text] = queue.pop();
        for (const asset of references(text, url)) {
            if (seen.has(asset)) continue;
            seen.add(asset);
            const response = await cache.match(asset);
            if (response && followed(response.headers.get('Content-Type') || '')) queue.push([asset, await response.text()]);
        }
    }
    return seen;
}

/**
 * A page is shown from its saved copy at once and confirmed from the network behind it. A copy is saved only together
 * with every bundled asset it reaches, so a saved page always runs, even after a deployment removed its old assets
 * from the server; assets only the replaced copy reached are then let go.
 */
async function page(event, request, path) {
    const cache = await caches.open(SHELL);
    const kept = await cache.match(path);
    const network = fetch(request).then(response => [response, response.clone(), response.clone()]);
    event.waitUntil(network.then(async ([, copy, saved]) => {
        const type = copy.headers.get('Content-Type') || '';
        if (!copy.ok || copy.redirected || !type.includes('text/html')) return;
        const html = await copy.text(), before = kept && await kept.clone().text();
        if (html === before) return;
        await Promise.all(references(html, copy.url || request.url).map(asset => remember(asset, cache, true)));
        await cache.put(path, saved);
        if (!before) return;
        const pages = await Promise.all((await cache.keys()).filter(key => new URL(key.url).pathname.endsWith('/'))
            .map(async key => [key.url, await (await cache.match(key)).text()]));
        const live = await reach(cache, pages);
        for (const asset of await reach(cache, [[request.url, before]])) if (!live.has(asset)) await cache.delete(asset);
    }).catch(() => undefined));
    if (kept) return kept;
    try { return (await network)[0]; } catch { return Response.error(); }
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

/** Discover one complete published snapshot, with an offline copy when unreachable. */
async function ownRelease() {
    const meta = await caches.open(META);
    let entry = ENTRY;
    const runtimeEntry = async response => {
        if (!response?.ok) throw new Error('application configuration unavailable');
        const value = await response.json();
        const url = new URL(value.campus_entry);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid campus entry');
        return url.href;
    };
    try { entry = await runtimeEntry(await meta.match(RUNTIME)); } catch { /* first start */ }
    const currentEntry = entry;
    const cancel = new AbortController();
    const pending = fetch(entry, { cache: 'no-cache', signal: cancel.signal }).catch(() => null);
    try {
        const response = await fetch(RUNTIME, { cache: 'no-cache' });
        entry = await runtimeEntry(response.clone());
        await meta.put(RUNTIME, response);
    } catch { /* Saved runtime configuration remains usable offline. */ }
    let response;
    try {
        if (entry !== currentEntry) cancel.abort();
        response = entry === currentEntry ? await pending : await fetch(entry, { cache: 'no-cache' });
        if (!response?.ok) throw new Error('release unavailable');
        await meta.put(entry, response.clone());
    } catch (error) { response = await meta.match(entry); if (!response) throw error; }
    const release = await response.json();
    const complete = { ...release, core: release.core.map(path => resourceAt(path, entry)), all: release.all.map(path => resourceAt(path, entry)) };
    for (const key of ['base', 'map_base', 'knowledge_base', 'search_base', 'texts_base']) if (release[key]) complete[key] = new URL(release[key], entry).href;
    await meta.put(CURRENT, new Response(JSON.stringify(complete), { headers: { 'Content-Type': 'application/json' } }));
    knownOrigins = new Set([complete.base, complete.map_base, complete.knowledge_base, complete.search_base, complete.texts_base].filter(Boolean).map(value => new URL(value).origin));
    // A search engine keeps one cache per bundle it read; only the current snapshot's bundles stay.
    const current = [complete.base, complete.search_base, complete.search_stable_base].filter(Boolean).map(value => `wasm-search ${value}/`);
    for (const key of await caches.keys()) if (key.startsWith('wasm-search ') && !current.some(prefix => key.startsWith(prefix))) await caches.delete(key);
    return complete;
}

async function publicOrigin(origin) {
    if (PUBLIC_ORIGINS.includes(origin)) return true;
    if (!knownOrigins) {
        knownOrigins = new Set();
        try {
            const response = await (await caches.open(META)).match(CURRENT);
            const release = response && await response.json();
            for (const value of [release?.base, release?.map_base, release?.knowledge_base, release?.search_base, release?.texts_base]) if (value) knownOrigins.add(new URL(value).origin);
        } catch { /* An unrelated origin is never written to this cache. */ }
    }
    return knownOrigins.has(origin);
}

/** Saves the shell and the release's core (or everything) and says how it went; returns how many files failed. */
async function save(release, all) {
    await announce({ type: 'OFFLINE_SAVING' });
    const shell = await caches.open(SHELL);
    const shellFailed = await saveFiles([...SHELL_PATHS, '/manifest.webmanifest', '/pwa-icons/180.png', '/pwa-icons/192.png', '/pwa-icons/512.png', '/pwa-icons/512-maskable.png'], shell, true);
    const data = await caches.open(DATA);
    const failed = shellFailed + await saveFiles(all ? [...release.core, ...release.all] : release.core, data);
    if (!failed) await data.put('/__studev_offline_ready__', new Response(JSON.stringify({ version: release.version, all }), { headers: { 'Content-Type': 'application/json' } }));
    await announce({ type: failed ? 'OFFLINE_PARTIAL' : 'OFFLINE_READY', version: release.version, all, failed });
    return failed;
}

// A worker is installed only with its whole shell and core saved, and only while it is the newest:
// otherwise installing fails and the browser tries again at its next check. So a worker waiting to
// take over is always complete, and the page offers the update only then.
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const release = await ownRelease();
        if (await save(release, false)) throw new Error('the core of this release is not saved');
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        // Versioned component URLs remain stable across data updates. Retire the
        // previous app-bound cache mechanism once this worker is active.
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => (key.startsWith('studev-shell-') || key.startsWith('studev-data-') || key === 'studev-release') && key !== SHELL).map(key => caches.delete(key)));
        await self.clients.claim();
        await announce({ type: 'WORKER_ACTIVE', version: APP_VERSION });
    })());
});
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data?.type === 'SAVE_OFFLINE') event.waitUntil((async () => {
        const release = await ownRelease();
        await save(release, Boolean(event.data.all));
    })().catch(() => announce({ type: 'OFFLINE_PARTIAL' })));
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
    const publicData = /^\/(data|space|knowledge|search|texts|map)\//.test(url.pathname);
    if (request.method !== 'GET' || (url.origin !== self.location.origin && !publicData && url.href !== ENTRY)) return;
    const path = url.pathname;
    if (url.href === ENTRY) {
        event.respondWith((async () => {
            const cache = await caches.open(META);
            const cached = await cache.match(ENTRY);
            const refresh = fetch(request, { cache: 'no-cache' }).then(async response => {
                if (response.ok) await cache.put(ENTRY, response.clone());
                return response;
            });
            try { return await refresh; } catch { return cached || Response.error(); }
        })());
        return;
    }
    if (request.mode === 'navigate') {
        // Pages are static shells: what anyone sees in them comes from the platform afterwards, never from the page.
        if (url.origin !== self.location.origin || !PAGE.test(path)) return;
        event.respondWith(page(event, request, path));
        return;
    }
    if (!publicData && !path.startsWith('/_astro/') && !path.startsWith('/pwa-icons/') && path !== '/manifest.webmanifest') return;
    event.respondWith((async () => {
        if (publicData && !await publicOrigin(url.origin)) return fetch(request);
        const cache = await caches.open(publicData ? DATA : SHELL);
        // Reuse a complete offline archive when present. An online range read
        // stays a range read: search must not wait for an entire pack to cache.
        const range = request.headers.get('Range');
        const key = request.url;
        let response = await cache.match(key);
        if (!response) {
            response = await fetch(request);
            if (response.ok && response.status !== 206) event.waitUntil(cache.put(key, response.clone()));
        }
        return range && response.status === 200 ? rangeResponse(response, range) : response;
    })());
});
