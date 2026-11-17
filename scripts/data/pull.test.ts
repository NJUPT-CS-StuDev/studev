import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { pullSnapshot } from './pull';

const tempBase = process.platform === 'win32' ? 'D:/Temp/codex' : '/tmp/codex';
let work: string;
afterAll(async () => { vi.unstubAllGlobals(); if (work && resolve(work).startsWith(resolve(tempBase) + sep)) await rm(work, { recursive: true, force: true }); });

it('does not activate an incomplete published snapshot or choose a different upstream release', async () => {
    const snapshot = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
    await mkdir(tempBase, { recursive: true }); work = await mkdtemp(join(tempBase, 'studev-pull-'));
    await mkdir(join(work, 'src/data'), { recursive: true });
    await writeFile(join(work, 'src/data/campus-release.json'), 'previous complete snapshot');
    const pointer = { ...snapshot, all: [`${snapshot.base}/rooms/index.json`] };
    const fetch = vi.fn(async (input: string | URL) => new URL(input).pathname === '/campus-release.json' ? new Response(JSON.stringify(pointer)) : new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(pullSnapshot('https://moved-data.example/campus-release.json', work)).rejects.toThrow('503');
    expect(await readFile(join(work, 'src/data/campus-release.json'), 'utf8')).toBe('previous complete snapshot');
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(['https://moved-data.example/campus-release.json', `https://moved-data.example${snapshot.base}/rooms/index.json`]);
    vi.unstubAllGlobals();
});
