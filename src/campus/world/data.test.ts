import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadRoomDay } from './data';
import { fetchJson } from './fetch';

it('retries a failed room-day read and retains the real published result', async () => {
    const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
    const folder = join('public', release.base, 'rooms', release.rooms);
    const date = (await readdir(folder)).find(file => file.endsWith('.json'))!.slice(0, -5);
    const actual = JSON.parse(await readFile(join(folder, `${date}.json`), 'utf8'));
    let attempts = 0;
    const fetch = vi.fn(async (input: string) => {
        const path = new URL(input, 'https://data.example').pathname;
        if (path.endsWith(`/${date}.json`) && attempts++ === 0) return new Response(null, { status: 503 });
        return new Response(await readFile(join('public', decodeURIComponent(path)), 'utf8'));
    });
    vi.stubGlobal('fetch', fetch);
    try {
        await expect(loadRoomDay(date)).rejects.toThrow('503');
        expect(await loadRoomDay(date)).toEqual(actual);
        expect(await loadRoomDay(date)).toEqual(actual);
        expect(attempts).toBe(2);
    } finally { vi.unstubAllGlobals(); }
});

it('keeps caller cancellation when a bounded fact request is in flight', async () => {
    vi.stubGlobal('fetch', (_: string, options: RequestInit) => new Promise((_, reject) => {
        const signal = options.signal!;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const caller = new AbortController(), reason = new DOMException('Reader left this page', 'AbortError');
    try {
        const loading = fetchJson('https://data.example/facts.json', { signal: caller.signal });
        caller.abort(reason);
        await expect(loading).rejects.toBe(reason);
    } finally { vi.unstubAllGlobals(); }
});
