import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { pullSnapshot } from './pull';

const writes = vi.hoisted(() => ({ after: undefined as undefined | ((file: string) => Promise<void>) }));
const backoff = vi.hoisted(() => ({ entered: undefined as undefined | (() => void), active: 0, aborted: 0 }));
vi.mock('node:fs/promises', async importOriginal => {
    const original = await importOriginal<typeof import('node:fs/promises')>();
    return { ...original, writeFile: async (...args: Parameters<typeof original.writeFile>) => {
        await original.writeFile(...args);
        await writes.after?.(String(args[0]));
    } };
});
vi.mock('node:timers/promises', async importOriginal => {
    const original = await importOriginal<typeof import('node:timers/promises')>();
    return { ...original, setTimeout: async (...args: Parameters<typeof original.setTimeout>) => {
        backoff.active++; backoff.entered?.();
        try { return await original.setTimeout(...args); }
        catch (error) { if (args[2]?.signal?.aborted) backoff.aborted++; throw error; }
        finally { backoff.active--; }
    } };
});

const tempBase = process.platform === 'win32' ? 'D:/Temp/codex' : '/tmp/codex';
const workspaces: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); writes.after = undefined; backoff.entered = undefined; backoff.active = 0; backoff.aborted = 0; });
afterAll(async () => { for (const work of workspaces) if (resolve(work).startsWith(resolve(tempBase) + sep)) await rm(work, { recursive: true, force: true }); });

async function workspace() {
    await mkdir(tempBase, { recursive: true });
    const work = await mkdtemp(join(tempBase, 'studev-pull-')); workspaces.push(work);
    await mkdir(join(work, 'src/data'), { recursive: true });
    await writeFile(join(work, 'src/data/campus-release.json'), 'previous complete snapshot');
    return work;
}

async function pointer(version: string) {
    const snapshot = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
    const base = `/data/${version}`;
    return { ...snapshot, version, base, all: [`${snapshot.knowledge_base}/index.json`, `${base}/rooms/index.json`, `${snapshot.map_base}/assets/campus.bin`,
        `${snapshot.search_base}/index.json`, `${snapshot.texts_base}/00.json`] };
}

const entry = 'https://moved-data.example/campus-release.json';
const resource = (path: string) => new Response(path.endsWith('.json') ? '{}' : 'map bytes');

it('bounds a persistent resource 503 to three requests without activating an incomplete snapshot', async () => {
    const snapshot = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
    const work = await workspace();
    const pointer = { ...snapshot, all: [`${snapshot.base}/rooms/index.json`] };
    const fetch = vi.fn(async (input: string | URL) => new URL(input).pathname === '/campus-release.json' ? new Response(JSON.stringify(pointer)) : new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(pullSnapshot('https://moved-data.example/campus-release.json', work)).rejects.toThrow('503');
    expect(await readFile(join(work, 'src/data/campus-release.json'), 'utf8')).toBe('previous complete snapshot');
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(['https://moved-data.example/campus-release.json', ...Array(3).fill(`https://moved-data.example${snapshot.base}/rooms/index.json`)]);
});

it('drains cancelled requests and pending writes before adopting a newer complete publication', async () => {
    const work = await workspace(), old = await pointer('old'), current = await pointer('current');
    const shared = old.all[0], missing = `${old.base}/rooms/retired.json`, blocked = `${old.base}/rooms/blocked.json`;
    old.all = [shared, missing, blocked, ...old.all.slice(2)];
    let opened!: () => void, release!: () => void, missingReturned!: () => void;
    const writing = new Promise<void>(resolve => { opened = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const retired = new Promise<void>(resolve => { missingReturned = resolve; });
    let pending = 0, reads = 0, aborted = 0;
    writes.after = async file => {
        if (file === join(work, 'public', shared) + `.pending-${process.pid}`) {
            pending++; opened(); await hold; pending--;
        }
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
        const path = new URL(input).pathname; calls.push(path);
        if (path === '/campus-release.json') {
            reads++;
            if (reads > 1) {
                expect(pending).toBe(0);
                expect(aborted).toBe(1);
                expect((await readdir(join(work, 'public'), { recursive: true })).some(path => path.includes('.pending-'))).toBe(false);
            }
            return Response.json(reads === 1 ? old : current);
        }
        if (path === missing) { await writing; missingReturned(); return new Response(null, { status: 404 }); }
        if (path === blocked) return await new Promise<Response>((_, reject) => {
            init!.signal!.addEventListener('abort', () => { aborted++; reject(init!.signal!.reason); }, { once: true });
        });
        return resource(path);
    }));
    const pull = pullSnapshot(entry, work);
    try {
        await retired;
        await new Promise(resolve => setImmediate(resolve));
        expect(reads).toBe(1);
        expect(pending).toBe(1);
        expect(await readFile(join(work, 'src/data/campus-release.json'), 'utf8')).toBe('previous complete snapshot');
    } finally { release(); }
    await expect(pull).resolves.toMatchObject({ version: current.version });
    expect(JSON.parse(await readFile(join(work, 'src/data/campus-release.json'), 'utf8'))).toEqual(current);
    for (const path of current.all) expect(await readFile(join(work, 'public', path), 'utf8')).toBe(path.endsWith('.json') ? '{}' : 'map bytes');
    expect(calls.filter(path => path === shared)).toHaveLength(1); // Complete immutable work survives the retired attempt.
    const nextRead = calls.indexOf('/campus-release.json', 1);
    expect(calls.slice(nextRead + 1).some(path => path.startsWith(old.base + '/'))).toBe(false);
});

it('reads a publication again while its files appear on the edge, and fails a resource still missing', async () => {
    const work = await workspace(), snapshot = await pointer('unchanged');
    let reads = 0;
    const fetch = vi.fn(async (input: string | URL) => {
        if (new URL(input).pathname === '/campus-release.json') { reads++; return Response.json({ ...snapshot, built_at: String(reads) }); }
        return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(pullSnapshot(entry, work, 0)).rejects.toThrow('404');
    expect(reads).toBe(3);
    for (const path of snapshot.all) expect(fetch.mock.calls.filter(([input]) => new URL(input).pathname === path)).toHaveLength(3);
    expect(await readFile(join(work, 'src/data/campus-release.json'), 'utf8')).toBe('previous complete snapshot');
});

it.each([502, 503, 504])('retries a temporary resource %s at the same URL without re-discovering the snapshot', async status => {
    const work = await workspace(), snapshot = await pointer(`temporary-${status}`);
    const target = `${snapshot.base}/rooms/index.json`;
    let reads = 0, requests = 0, cancelled = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        const path = new URL(input).pathname;
        if (path === '/campus-release.json') { reads++; return Response.json(snapshot); }
        if (path === target && ++requests === 1) return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status });
        return resource(path);
    }));
    await expect(pullSnapshot(entry, work)).resolves.toMatchObject({ version: snapshot.version });
    expect({ reads, requests, cancelled }).toEqual({ reads: 1, requests: 2, cancelled: 1 });
    expect(JSON.parse(await readFile(join(work, 'src/data/campus-release.json'), 'utf8'))).toEqual(snapshot);
});

it('cancels a resource backoff immediately when another worker stops the snapshot', async () => {
    const work = await workspace(), snapshot = await pointer('cancel-backoff');
    const target = snapshot.all[0], missing = `${snapshot.base}/rooms/index.json`;
    let entered!: () => void;
    const sleeping = new Promise<void>(resolve => { entered = resolve; });
    backoff.entered = entered;
    let reads = 0, requests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        const path = new URL(input).pathname;
        if (path === '/campus-release.json') { reads++; return Response.json(snapshot); }
        if (path === target) { requests++; return new Response(null, { status: 502 }); }
        if (path === missing) { await sleeping; return new Response(null, { status: 404 }); }
        return resource(path);
    }));
    await expect(pullSnapshot(entry, work)).rejects.toThrow('502');
    expect({ reads, requests, sleeping: backoff.active, aborted: backoff.aborted }).toEqual({ reads: 1, requests: 1, sleeping: 0, aborted: 1 });
    expect(await readFile(join(work, 'src/data/campus-release.json'), 'utf8')).toBe('previous complete snapshot');
});

it('does not treat an HTTP429 as a transient CDN error', async () => {
    const work = await workspace(), snapshot = await pointer('limited');
    snapshot.all = [snapshot.all[0]];
    let reads = 0, requests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        if (new URL(input).pathname === '/campus-release.json') { reads++; return Response.json(snapshot); }
        requests++; return new Response(null, { status: 429 });
    }));
    await expect(pullSnapshot(entry, work)).rejects.toThrow('429');
    expect({ reads, requests }).toEqual({ reads: 1, requests: 1 });
});

it.each(['fetch', 'body', 'timeout'] as const)('retries a temporary network failure during %s only for that resource', async kind => {
    const work = await workspace(), snapshot = await pointer(`network-${kind}`);
    const target = `${snapshot.base}/rooms/index.json`;
    let reads = 0, requests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        const path = new URL(input).pathname;
        if (path === '/campus-release.json') { reads++; return Response.json(snapshot); }
        if (path === target && ++requests === 1) {
            if (kind === 'fetch') throw new TypeError('connection interrupted');
            if (kind === 'timeout') throw new DOMException('request timed out', 'TimeoutError');
            const response = resource(path);
            vi.spyOn(response, 'arrayBuffer').mockRejectedValueOnce(new TypeError('response stream interrupted'));
            return response;
        }
        return resource(path);
    }));
    await expect(pullSnapshot(entry, work)).resolves.toMatchObject({ version: snapshot.version });
    expect({ reads, requests }).toEqual({ reads: 1, requests: 2 });
});

it.each(['JSON', 'filesystem'] as const)('does not retry an invalid %s result as a network failure', async kind => {
    const work = await workspace(), snapshot = await pointer(`invalid-${kind}`);
    const target = `${snapshot.base}/rooms/index.json`;
    let reads = 0, requests = 0;
    writes.after = async file => {
        if (kind === 'filesystem' && file === join(work, 'public', target) + `.pending-${process.pid}`) throw new TypeError('disk write failed');
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        const path = new URL(input).pathname;
        if (path === '/campus-release.json') { reads++; return Response.json(snapshot); }
        if (path === target) { requests++; return new Response(kind === 'JSON' ? 'invalid JSON' : '{}'); }
        return resource(path);
    }));
    await expect(pullSnapshot(entry, work)).rejects.toThrow(kind === 'JSON' ? 'JSON' : 'disk write failed');
    expect({ reads, requests }).toEqual({ reads: 1, requests: 1 });
    expect(await readFile(join(work, 'src/data/campus-release.json'), 'utf8')).toBe('previous complete snapshot');
});

it('preserves the original network failure after its bounded resource retries', async () => {
    const work = await workspace(), snapshot = await pointer('network-down');
    snapshot.all = [snapshot.all[0]];
    const failure = new TypeError('connection interrupted');
    let reads = 0, requests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        if (new URL(input).pathname === '/campus-release.json') { reads++; return Response.json(snapshot); }
        requests++; throw failure;
    }));
    await expect(pullSnapshot(entry, work)).rejects.toBe(failure);
    expect({ reads, requests }).toEqual({ reads: 1, requests: 3 });
    expect(await readFile(join(work, 'src/data/campus-release.json'), 'utf8')).toBe('previous complete snapshot');
});

it('can re-discover a changed component set without relying only on the facts version', async () => {
    const work = await workspace(), old = await pointer('facts');
    const map = '/space/replacement';
    const current = { ...old, map_base: map, all: old.all.map((path: string) => path.replace(old.map_base, map)) };
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        const path = new URL(input).pathname;
        if (path === '/campus-release.json') { reads++; return Response.json(reads === 1 ? old : current); }
        return path.startsWith(old.map_base + '/') ? new Response(null, { status: 404 }) : resource(path);
    }));
    await expect(pullSnapshot(entry, work)).resolves.toMatchObject({ version: old.version, map_base: map });
    expect(reads).toBe(2);
    expect(JSON.parse(await readFile(join(work, 'src/data/campus-release.json'), 'utf8'))).toEqual(current);
});

it('does not retry another HTTP failure just because a concurrent resource returned 404', async () => {
    const work = await workspace(), snapshot = await pointer('failed');
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        const path = new URL(input).pathname;
        if (path === '/campus-release.json') { reads++; return Response.json(snapshot); }
        return new Response(null, { status: path.startsWith(snapshot.base + '/') ? 503 : 404 });
    }));
    await expect(pullSnapshot(entry, work)).rejects.toThrow('503');
    expect(reads).toBe(1);
    expect(await readFile(join(work, 'src/data/campus-release.json'), 'utf8')).toBe('previous complete snapshot');
});

it('bounds a publication race to three fixed snapshot attempts', async () => {
    const work = await workspace(), snapshots = await Promise.all(['first', 'second', 'third'].map(pointer));
    const requests: string[] = [];
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
        const path = new URL(input).pathname;
        if (path === '/campus-release.json') return Response.json(snapshots[reads++]);
        requests.push(path);
        return new Response(null, { status: 404 });
    }));
    await expect(pullSnapshot(entry, work)).rejects.toThrow('404');
    expect(reads).toBe(3);
    expect(snapshots.every(snapshot => requests.includes(`${snapshot.base}/rooms/index.json`))).toBe(true);
    expect(await readFile(join(work, 'src/data/campus-release.json'), 'utf8')).toBe('previous complete snapshot');
});
