import { describe, expect, it, vi } from 'vitest';
import { buildWorker } from './build-worker';
import { runInNewContext } from 'node:vm';

const origin = 'https://campus.example';
const worker = buildWorker('fixture', origin);

function harness() {
    const stores = new Map<string, Map<string, Response>>();
    const listeners = new Map<string, (event: unknown) => void>();
    const messages: unknown[] = [];
    const key = (input: string | Request) => new URL(typeof input === 'string' ? input : input.url, origin).href;
    const caches = {
        async open(name: string) {
            const store = stores.get(name) || new Map<string, Response>(); stores.set(name, store);
            return { async match(input: string | Request) { return store.get(key(input))?.clone(); }, async put(input: string | Request, response: Response) { store.set(key(input), response.clone()); }, async keys() { return [...store.keys()].map(url => new Request(url)); }, async delete(input: string | Request) { return store.delete(key(input)); } };
        }, async keys() { return [...stores.keys()]; }, async delete(name: string) { return stores.delete(name); },
    };
    const fetch = vi.fn(async (input: string | Request) => {
        const path = new URL(typeof input === 'string' ? input : input.url, origin).pathname;
        if (path === '/app-release.json') return new Response(JSON.stringify({ campus_entry: `${origin}/campus-release.json` }), { headers: { 'Content-Type': 'application/json' } });
        if (path === '/campus-release.json') return new Response(JSON.stringify({ version: 'fixture', base: '/data/fixture', map_base: '/space/map1', knowledge_base: '/knowledge/k1', search_base: '/search/s1', formats: { search: 'wasm-search-bundle-v5', models: 'models-planes-v1' }, texts_base: '/texts/s1', core: ['/space/map1/test/basemap.pmtiles'], all: [] }), { headers: { 'Content-Type': 'application/json' } });
        if (path.endsWith('.pmtiles')) return new Response(new Uint8Array([0, 1, 2, 3, 4, 5]), { headers: { 'Content-Type': 'application/octet-stream' } });
        if (path === '/_astro/app.js') return new Response('import "./chunk.js";', { headers: { 'Content-Type': 'application/javascript' } });
        if (path === '/_astro/chunk.js') return new Response('const wasm=`/_astro/kernel.wasm`; const imports={"./kernel_bg.js":{}};', { headers: { 'Content-Type': 'application/javascript' } });
        if (path.startsWith('/_astro/')) return new Response('asset');
        return new Response('<script src="/_astro/app.js"></script>', { headers: { 'Content-Type': 'text/html' } });
    });
    runInNewContext(worker, {
        self: { location: { origin }, clients: { matchAll: async () => [{ postMessage: (message: unknown) => messages.push(message) }], claim: async () => undefined }, addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener), skipWaiting: vi.fn() },
        URL, Request, Response, Headers, AbortController, caches, fetch, console, Uint8Array, Uint32Array, TextEncoder,
    });
    async function dispatch(type: string, request?: Request) {
        let response: Promise<Response> | undefined;
        const waits: Promise<unknown>[] = [];
        listeners.get(type)?.({ request, respondWith: (value: Promise<Response>) => { response = value; }, waitUntil: (value: Promise<unknown>) => waits.push(value) });
        const result = response ? await response : undefined;
        await Promise.all(waits);
        return result;
    }
    return { stores, messages, fetch, dispatch, caches };
}

describe('offline worker', () => {
    it('warms the shell, its imported chunks/WASM and the entire current campus archive', async () => {
        const app = harness(); await app.dispatch('install');
        const shell = app.stores.get('studev-shell-fixture')!;
        expect(shell.has(`${origin}/map/`)).toBe(true);
        expect(shell.has(`${origin}/_astro/chunk.js`)).toBe(true);
        expect(shell.has(`${origin}/_astro/kernel.wasm`)).toBe(true);
        expect(shell.has(`${origin}/_astro/kernel_bg.js`)).toBe(false);
        expect(app.stores.get('studev-public-data')?.has(`${origin}/space/map1/test/basemap.pmtiles`)).toBe(true);
        expect(app.messages).toContainEqual({ type: 'OFFLINE_READY', version: 'fixture', all: false, failed: 0 });
    });
    it('serves correct PMTiles ranges offline without storing a partial response', async () => {
        const app = harness(); await app.dispatch('install'); app.fetch.mockRejectedValue(new Error('offline'));
        const response = await app.dispatch('fetch', new Request(`${origin}/space/map1/test/basemap.pmtiles`, { headers: { Range: 'bytes=2-4' } }));
        expect(response?.status).toBe(206);
        expect(response?.headers.get('Content-Range')).toBe('bytes 2-4/6');
        expect([...new Uint8Array(await response!.arrayBuffer())]).toEqual([2, 3, 4]);
        const invalid = await app.dispatch('fetch', new Request(`${origin}/space/map1/test/basemap.pmtiles`, { headers: { Range: 'bytes=7-' } }));
        expect(invalid?.status).toBe(416);
        const cached = await (await app.caches.open('studev-public-data')).match('/space/map1/test/basemap.pmtiles');
        expect(cached?.status).toBe(200);
    });
    it('forwards an uncached search range and returns its partial response without fetching or caching the whole pack', async () => {
        const app = harness();
        const pack = `${origin}/search/s1/pack-0.wsb`;
        app.fetch.mockImplementation(async input => {
            expect(input).toBeInstanceOf(Request);
            expect((input as Request).headers.get('Range')).toBe('bytes=2-4');
            return new Response(new Uint8Array([2, 3, 4]), { status: 206, headers: { 'Content-Range': 'bytes 2-4/16777216' } });
        });
        const response = await app.dispatch('fetch', new Request(pack, { headers: { Range: 'bytes=2-4' } }));
        expect(response?.status).toBe(206);
        expect([...new Uint8Array(await response!.arrayBuffer())]).toEqual([2, 3, 4]);
        expect(app.fetch).toHaveBeenCalledTimes(1);
        expect(await (await app.caches.open('studev-public-data')).match(pack)).toBeUndefined();
    });
    it('does not intercept or cache account, form or submission requests', async () => {
        const app = harness();
        for (const path of ['/account/', '/forms/?id=private', '/api/platform/collections', '/members/']) {
            expect(await app.dispatch('fetch', new Request(`${origin}${path}`))).toBeUndefined();
        }
        expect(app.fetch).not.toHaveBeenCalled();
    });
    it('reads new campus metadata without requiring a new application worker', async () => {
        const app = harness(); await app.dispatch('install');
        app.fetch.mockResolvedValue(new Response(JSON.stringify({ version: 'next' }), { headers: { 'Content-Type': 'application/json' } }));
        const response = await app.dispatch('fetch', new Request(`${origin}/campus-release.json`));
        expect((await response!.json()).version).toBe('next');
        expect(app.messages.some(message => (message as { type: string }).type === 'DATA_UPDATE')).toBe(false);
    });
    it('installs against the current data revision and refuses an incomplete offline core', async () => {
        const newer = harness();
        const original = newer.fetch.getMockImplementation()!;
        newer.fetch.mockImplementation(async input => new URL(typeof input === 'string' ? input : input.url, origin).pathname === '/campus-release.json'
            ? new Response(JSON.stringify({ version: 'next', base: '/data/next', core: [], all: [] }), { headers: { 'Content-Type': 'application/json' } }) : original(input));
        await newer.dispatch('install');
        expect(newer.messages).toContainEqual({ type: 'OFFLINE_READY', version: 'next', all: false, failed: 0 });
        const broken = harness();
        const real = broken.fetch.getMockImplementation()!;
        broken.fetch.mockImplementation(async input => new URL(typeof input === 'string' ? input : input.url, origin).pathname.endsWith('.pmtiles') ? new Response(null, { status: 503 }) : real(input));
        await expect(broken.dispatch('install')).rejects.toThrow('not saved');
        expect(broken.stores.get('studev-public-data')?.has(`${origin}/__studev_offline_ready__`)).toBe(false);
    });
    it('follows a changed data domain from application metadata and keeps its map usable offline', async () => {
        const app = harness();
        const original = app.fetch.getMockImplementation()!;
        app.fetch.mockImplementation(async input => {
            const url = new URL(typeof input === 'string' ? input : input.url, origin);
            if (url.pathname === '/app-release.json') return new Response(JSON.stringify({ campus_entry: 'https://new-data.example/campus-release.json' }));
            if (url.pathname === '/campus-release.json') return new Response(JSON.stringify({ version: 'moved', base: '/data/moved', map_base: '/space/map1', core: ['/space/map1/test/basemap.pmtiles'], all: [] }));
            return original(input);
        });
        await app.dispatch('install');
        expect(app.fetch.mock.calls.some(([input]) => String(input) === 'https://new-data.example/campus-release.json')).toBe(true);
        app.fetch.mockRejectedValue(new Error('offline'));
        const response = await app.dispatch('fetch', new Request('https://new-data.example/space/map1/test/basemap.pmtiles', { headers: { Range: 'bytes=0-1' } }));
        expect(response?.status).toBe(206);
    });
    it('shows a saved page at once, saves a new one only with every asset it reaches, and lets go of assets only the old one reached', async () => {
        const app = harness();
        const html = (asset: string) => new Response(`<script type="module" src="/_astro/${asset}"></script>`, { headers: { 'Content-Type': 'text/html' } });
        const navigate = (path: string) => app.dispatch('fetch', { url: `${origin}${path}`, method: 'GET', mode: 'navigate', headers: new Headers() } as unknown as Request);
        let build = 'one.js';
        app.fetch.mockImplementation(async (input: string | Request) => {
            const path = new URL(typeof input === 'string' ? input : input.url, origin).pathname;
            if (path === '/forms/') return html(build);
            if (path === `/_astro/${build}`) return new Response(`import "./${build.replace('.js', '-lazy.js')}";`, { headers: { 'Content-Type': 'application/javascript' } });
            return new Response('chunk', { headers: { 'Content-Type': 'application/javascript' } });
        });
        expect(await (await navigate('/forms/'))!.text()).toContain('one.js');
        const shell = app.stores.get('studev-shell-fixture')!;
        expect([...shell.keys()].sort()).toEqual([`${origin}/_astro/one-lazy.js`, `${origin}/_astro/one.js`, `${origin}/forms/`]);
        build = 'two.js';
        app.fetch.mockClear();
        expect(await (await navigate('/forms/'))!.text()).toContain('one.js');
        expect([...shell.keys()].sort()).toEqual([`${origin}/_astro/two-lazy.js`, `${origin}/_astro/two.js`, `${origin}/forms/`]);
        app.fetch.mockRejectedValue(new Error('offline'));
        expect(await (await navigate('/forms/'))!.text()).toContain('two.js');
        expect(await navigate('/never-seen/')).toMatchObject({ type: 'error' });
    });
    it('keeps only the current snapshot\'s search caches', async () => {
        const app = harness();
        for (const path of ['/search/s0/', '/search/s1/', '/data/old/entities/course-search/', '/data/fixture/entities/course-search/']) await app.caches.open(`wasm-search ${origin}${path}`);
        await app.dispatch('install');
        const kept = (await app.caches.keys()).filter(name => name.startsWith('wasm-search ')).sort();
        expect(kept).toEqual([`wasm-search ${origin}/data/fixture/entities/course-search/`, `wasm-search ${origin}/search/s1/`]);
    });
});
