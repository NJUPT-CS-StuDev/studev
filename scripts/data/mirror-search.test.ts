import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { mirrorSearch } from './mirror-search.mjs';

const base = resolve(process.platform === 'win32' ? 'D:/Temp/codex/search-mirror' : join(tmpdir(), 'codex-search-mirror'));
const directories: string[] = [];
const env = { OSCA_DOWNLOAD_ENDPOINT: 'https://store.example.test', OSCA_DOWNLOAD_BUCKET: 'test', OSCA_DOWNLOAD_ACCESS_KEY: 'test', OSCA_DOWNLOAD_SECRET_KEY: 'test' };

async function bundle() {
    await mkdir(base, { recursive: true });
    const directory = await mkdtemp(join(base, 'bundle-'));
    directories.push(directory);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ packs: ['pack-000.bin'] }));
    await writeFile(join(directory, 'pack-000.bin'), 'correct');
    return directory;
}

afterEach(async () => {
    vi.unstubAllGlobals();
    for (const directory of directories.splice(0)) {
        if (!resolve(directory).startsWith(base + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('unexpected scratch directory');
        await rm(directory, { recursive: true, force: true });
    }
});

it('refuses to overwrite different published bytes even when their length matches', async () => {
    const directory = await bundle();
    const request = vi.fn(async () => new Response('corrupt'));
    vi.stubGlobal('fetch', request);
    await expect(mirrorSearch(directory, 'release', env)).rejects.toThrow('published search pack differs');
    expect(request).toHaveBeenCalledTimes(1);
});

it('reuses identical published bytes and only renews their mirror addresses', async () => {
    const directory = await bundle();
    const request = vi.fn(async (url: URL, _init?: RequestInit) => new Response(url.pathname.endsWith('pack-000.bin') ? 'correct' : '<ListBucketResult/>'));
    vi.stubGlobal('fetch', request);
    await mirrorSearch(directory, 'release', env);
    expect(request.mock.calls.every(call => call[1]?.method === 'GET')).toBe(true);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    expect(manifest.mirrors[0]).toContain('/search/release/pack-000.bin?');
});
