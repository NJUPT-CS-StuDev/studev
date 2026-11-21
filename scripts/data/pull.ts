// An application build consumes the current public snapshot. It never chooses
// upstream versions, compiles facts or advances the data site's current pointer.
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { SEARCH_BUNDLE_FORMAT } from 'wasm-search';
import product from '../../product.json' with { type: 'json' };
import { resourceAt, validRelease, type CampusRelease } from '../../src/campus/world/release.ts';

class MissingPublishedResource extends Error {}
class TemporaryPublishedResource extends Error {}

async function currentSnapshot(entry: string, publicRoot: string): Promise<CampusRelease> {
    const response = await fetch(entry, { cache: 'no-cache', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`published campus snapshot is unavailable (${response.status})`);
    const snapshot: unknown = await response.json();
    if (!validRelease(snapshot) || !Array.isArray(snapshot.all) || !snapshot.all.length) throw new Error('published campus snapshot has no complete resource list');
    const bases = [snapshot.base, snapshot.map_base, snapshot.knowledge_base, snapshot.search_base, snapshot.texts_base, snapshot.search_stable_base].filter((base): base is string => Boolean(base));
    for (const path of snapshot.all) {
        if (typeof path !== 'string' || !bases.some(base => path.startsWith(base + '/')) || path.includes('\\')
            || path.split('/').some(part => part === '..' || part === '.')
            || !resolve(publicRoot, '.' + path).startsWith(publicRoot + sep)) throw new Error(`invalid published resource path: ${path}`);
    }
    return snapshot;
}

/** The snapshot a build can ship: one in the search format its engine reads. A build for a new engine that starts
 * while the data site is still being republished for it waits for that publication instead of shipping data its
 * engine cannot read (as a deployment once did). */
async function readableSnapshot(entry: string, publicRoot: string, wait = 20 * 60_000): Promise<CampusRelease> {
    const deadline = Date.now() + wait;
    for (;;) {
        const snapshot = await currentSnapshot(entry, publicRoot);
        if (snapshot.search_format === SEARCH_BUNDLE_FORMAT) return snapshot;
        if (Date.now() >= deadline) throw new Error(`the data site serves search format ${snapshot.search_format}; this build's engine reads ${SEARCH_BUNDLE_FORMAT}`);
        console.log(`waiting for the data site to publish ${SEARCH_BUNDLE_FORMAT} (it serves ${snapshot.search_format})`);
        await delay(30_000);
    }
}

const components = (snapshot: CampusRelease) => JSON.stringify([snapshot.version, snapshot.base, snapshot.map_version, snapshot.data_version,
    snapshot.knowledge_version, snapshot.map_base, snapshot.knowledge_base, snapshot.search_base, snapshot.texts_base, snapshot.search_stable_base]);

async function resourceBytes(path: string, entry: string, signal: AbortSignal): Promise<Buffer> {
    let firstFailure: unknown;
    for (let attempt = 0; ; attempt++) {
        try {
            signal.throwIfAborted();
            const resource = await fetch(resourceAt(path, entry), { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
            if (!resource.ok) {
                const message = `published resource is unavailable (${resource.status}): ${path}`;
                const failure = resource.status === 404 ? new MissingPublishedResource(message)
                    : [502, 503, 504].includes(resource.status) ? new TemporaryPublishedResource(message) : new Error(message);
                // Release an error response's connection before another request.
                try { await resource.body?.cancel(); } catch { /* Keep the original HTTP failure. */ }
                throw failure;
            }
            const content = Buffer.from(await resource.arrayBuffer());
            signal.throwIfAborted();
            return content;
        } catch (error) {
            if (signal.aborted) throw firstFailure ?? error;
            if (!(error instanceof TemporaryPublishedResource || error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError'))) throw error;
            firstFailure ??= error;
            if (attempt === 2) throw firstFailure;
            try { await delay(500 * 2 ** attempt, undefined, { signal }); }
            catch { throw firstFailure; }
        }
    }
}

async function downloadSnapshot(snapshot: CampusRelease, entry: string, publicRoot: string): Promise<number> {
    let cursor = 0, fetched = 0;
    const controller = new AbortController();
    const settled = await Promise.allSettled(Array.from({ length: 8 }, async () => {
        try {
            while (!controller.signal.aborted && cursor < snapshot.all!.length) {
                const path = snapshot.all![cursor++]!, file = join(publicRoot, path);
                if (existsSync(file)) continue; // Versioned paths are immutable.
                const content = await resourceBytes(path, entry, controller.signal);
                controller.signal.throwIfAborted();
                if (path.endsWith('.json')) JSON.parse(content.toString());
                await mkdir(dirname(file), { recursive: true });
                const pending = file + `.pending-${process.pid}`;
                try { await writeFile(pending, content); await rename(pending, file); fetched++; }
                finally { await rm(pending, { force: true }); }
            }
        } catch (error) { controller.abort(); throw error; }
    }));
    // Aborted requests and filesystem writes must settle before another snapshot
    // can reuse the immutable cache or the same pending-file names.
    const failures = settled.filter(result => result.status === 'rejected').map(result => result.reason).filter(error => error !== controller.signal.reason);
    const failure = failures.find(error => !(error instanceof MissingPublishedResource)) ?? failures[0];
    if (failures.length) throw failure;
    return fetched;
}

export async function pullSnapshot(entry = `${product.campusOrigin}/campus-release.json`, root = process.cwd(), settle = 30_000): Promise<CampusRelease> {
    const publicRoot = resolve(root, 'public');
    let snapshot = await readableSnapshot(entry, publicRoot), fetched = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
        try { fetched = await downloadSnapshot(snapshot, entry, publicRoot); break; }
        catch (error) {
            if (!(error instanceof MissingPublishedResource) || attempt === 2) throw error;
            const current = await readableSnapshot(entry, publicRoot);
            // The same snapshot: for a minute or two after a deployment some of its files still answer 404 on the
            // edge, then appear. A newer snapshot replaced the one being read: read that instead.
            if (components(current) === components(snapshot)) await delay(settle);
            snapshot = current;
        }
    }
    // Native packaging reads the same snapshot through its bundled directory.
    // These copies are local build inputs; public publication omits duplicates.
    for (const [name, base] of [['space', snapshot.map_base], ['knowledge', snapshot.knowledge_base], ['search', snapshot.search_base], ['texts', snapshot.texts_base]])
        await cp(join(publicRoot, base!), join(publicRoot, snapshot.base, name!), { recursive: true });
    if (snapshot.search_stable_base) await cp(join(publicRoot, snapshot.search_stable_base), join(publicRoot, snapshot.base, 'search-base'), { recursive: true });
    await cp(join(publicRoot, snapshot.map_base, 'assets'), join(publicRoot, 'map'), { recursive: true });
    await cp(join(publicRoot, snapshot.map_base, 'assets'), join(root, 'android/app/src/main/assets/map'), { recursive: true });
    const manifest = join(root, 'src/data/campus-release.json');
    await mkdir(dirname(manifest), { recursive: true });
    const pending = manifest + `.pending-${process.pid}`;
    try { await writeFile(pending, JSON.stringify(snapshot)); await rename(pending, manifest); }
    finally { await rm(pending, { force: true }); }
    console.log(`read published snapshot ${snapshot.version}; ${fetched} downloaded, ${snapshot.all!.length - fetched} already local`);
    return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await pullSnapshot();
