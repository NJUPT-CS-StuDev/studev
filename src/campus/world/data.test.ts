import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadClassExams, loadExamRecord, loadRoomDay } from './data';
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

it('shares each class exam file between the calendar and change log, retrying a failed read', async () => {
    const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
    const root = `${release.base}/exams/${release.exams}`;
    const index = JSON.parse(await readFile(join('public', root, 'index.json'), 'utf8'));
    const [id, other] = index.classes;
    const path = (value: string) => `${root}/classes/${encodeURIComponent(value)}.json`;
    const attempts = new Map<string, number>();
    vi.stubGlobal('fetch', async (input: string) => {
        const pathname = new URL(input, 'https://data.example').pathname;
        const count = (attempts.get(pathname) ?? 0) + 1;
        attempts.set(pathname, count);
        if (pathname === path(id) && count === 1) return new Response(null, { status: 503 });
        return new Response(await readFile(join('public', decodeURIComponent(pathname)), 'utf8'));
    });
    try {
        expect((await Promise.allSettled([loadClassExams(id), loadExamRecord(id)])).map(value => value.status))
            .toEqual(['rejected', 'rejected']);
        expect(attempts.get(path(id))).toBe(1);
        const [exams, record, next] = await Promise.all([loadClassExams(id), loadExamRecord(id), loadClassExams(other)]);
        const actual = JSON.parse(await readFile(join('public', path(id)), 'utf8'));
        expect(exams).toEqual(actual.exams);
        expect(record.changes).toEqual(actual.changes);
        expect(next).toEqual(JSON.parse(await readFile(join('public', path(other)), 'utf8')).exams);
        expect(await loadClassExams('UNLISTED-CLASS')).toEqual([]);
        expect((await loadExamRecord('UNLISTED-CLASS')).changes).toEqual([]);
        expect(attempts.get(path(id))).toBe(2);
        expect(attempts.get(path(other))).toBe(1);
        expect(attempts.get(path('UNLISTED-CLASS'))).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
});
