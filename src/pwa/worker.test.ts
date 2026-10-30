import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const origin = 'https://campus.example';
const worker = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');

function harness() {
    const stores = new Map<string, Map<string, Response>>();
    const listeners = new Map<string, (event: unknown) => void>();
    const messages: unknown[] = [];
    const key = (input: string | Request) => new URL(typeof input === 'string' ? input : input.url, origin).href;
    const caches = {
        async open(name: string) {
            const store = stores.get(name) || new Map<string, Response>(); stores.set(name, store);
            return { async match(input: string | Request) { return store.get(key(input))?.clone(); }, async put(input: string | Request, response: Response) { store.set(key(input), response.clone()); } };
        }, async keys() { return [...stores.keys()]; }, async delete(name: string) { return stores.delete(name); },
    };
    const fetch = vi.fn(async (input: string | Request) => {
        const path = new URL(typeof input === 'string' ? input : input.url, origin).pathname;
        if (path === '/pwa-release.json') return new Response(JSON.stringify({ version: 'fixture', core: ['/data/fixture/space/test/basemap.pmtiles'], all: [] }), { headers: { 'Content-Type': 'application/json' } });
        if (path.endsWith('.pmtiles')) return new Response(new Uint8Array([0, 1, 2, 3, 4, 5]), { headers: { 'Content-Type': 'application/octet-stream' } });
        if (path === '/_astro/app.js') return new Response('import "./chunk.js";', { headers: { 'Content-Type': 'application/javascript' } });
        if (path === '/_astro/chunk.js') return new Response('const wasm=`/_astro/kernel.wasm`;', { headers: { 'Content-Type': 'application/javascript' } });
        if (path.startsWith('/_astro/')) return new Response('asset');
        return new Response('<script src="/_astro/app.js"></script>', { headers: { 'Content-Type': 'text/html' } });
    });
    runInNewContext(`const DATA_VERSION = 'fixture';\n${worker}`, {
        self: { location: { origin }, clients: { matchAll: async () => [{ postMessage: (message: unknown) => messages.push(message) }], claim: async () => undefined }, addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener), skipWaiting: vi.fn() },
        URL, Request, Response, Headers, caches, fetch, console,
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
        const shell = app.stores.get('studev-shell-2-fixture')!;
        expect(shell.has(`${origin}/map/`)).toBe(true);
        expect(shell.has(`${origin}/_astro/chunk.js`)).toBe(true);
        expect(shell.has(`${origin}/_astro/kernel.wasm`)).toBe(true);
        expect(app.stores.get('studev-data-fixture')?.has(`${origin}/data/fixture/space/test/basemap.pmtiles`)).toBe(true);
        expect(app.messages).toContainEqual({ type: 'OFFLINE_READY', version: 'fixture', all: false, failed: 0 });
    });
    it('serves correct PMTiles ranges offline without storing a partial response', async () => {
        const app = harness(); await app.dispatch('install'); app.fetch.mockRejectedValue(new Error('offline'));
        const response = await app.dispatch('fetch', new Request(`${origin}/data/fixture/space/test/basemap.pmtiles`, { headers: { Range: 'bytes=2-4' } }));
        expect(response?.status).toBe(206);
        expect(response?.headers.get('Content-Range')).toBe('bytes 2-4/6');
        expect([...new Uint8Array(await response!.arrayBuffer())]).toEqual([2, 3, 4]);
        const invalid = await app.dispatch('fetch', new Request(`${origin}/data/fixture/space/test/basemap.pmtiles`, { headers: { Range: 'bytes=7-' } }));
        expect(invalid?.status).toBe(416);
        const cached = await (await app.caches.open('studev-data-fixture')).match('/data/fixture/space/test/basemap.pmtiles');
        expect(cached?.status).toBe(200);
    });
    it('does not intercept or cache account, form or submission requests', async () => {
        const app = harness();
        for (const path of ['/account/', '/forms/', '/fill/?id=private', '/api/forms', '/submissions/']) {
            expect(await app.dispatch('fetch', new Request(`${origin}${path}`))).toBeUndefined();
        }
        expect(app.fetch).not.toHaveBeenCalled();
    });
    it('returns the cached release while checking for and announcing fresh data', async () => {
        const app = harness(); await app.dispatch('install');
        app.fetch.mockResolvedValue(new Response(JSON.stringify({ version: 'next' }), { headers: { 'Content-Type': 'application/json' } }));
        const response = await app.dispatch('fetch', new Request(`${origin}/pwa-release.json`));
        expect((await response!.json()).version).toBe('fixture');
        expect(app.messages).toContainEqual({ type: 'DATA_UPDATE', version: 'next' });
    });
});
