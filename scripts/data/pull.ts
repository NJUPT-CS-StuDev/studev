// An application build consumes the current public snapshot. It never chooses
// upstream versions, compiles facts or advances the data site's current pointer.
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import product from '../../product.json' with { type: 'json' };
import { resourceAt, validRelease, type CampusRelease } from '../../src/campus/world/release.ts';

export async function pullSnapshot(entry = `${product.campusOrigin}/campus-release.json`, root = process.cwd()): Promise<CampusRelease> {
    const response = await fetch(entry, { cache: 'no-cache', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`published campus snapshot is unavailable (${response.status})`);
    const snapshot: unknown = await response.json();
    if (!validRelease(snapshot) || !Array.isArray(snapshot.all) || !snapshot.all.length) throw new Error('published campus snapshot has no complete resource list');
    const bases = [snapshot.base, snapshot.map_base, snapshot.knowledge_base, snapshot.search_base, snapshot.texts_base];
    const publicRoot = resolve(root, 'public');
    for (const path of snapshot.all) {
        if (typeof path !== 'string' || !bases.some(base => path.startsWith(base + '/')) || path.includes('\\')
            || path.split('/').some(part => part === '..' || part === '.')
            || !resolve(publicRoot, '.' + path).startsWith(publicRoot + sep)) throw new Error(`invalid published resource path: ${path}`);
    }
    let cursor = 0, fetched = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
        while (cursor < snapshot.all!.length) {
            const path = snapshot.all![cursor++]!, file = join(publicRoot, path);
            if (existsSync(file)) continue; // Versioned paths are immutable.
            const resource = await fetch(resourceAt(path, entry), { signal: AbortSignal.timeout(60_000) });
            if (!resource.ok) throw new Error(`published resource is unavailable (${resource.status}): ${path}`);
            const content = Buffer.from(await resource.arrayBuffer());
            if (path.endsWith('.json')) JSON.parse(content.toString());
            await mkdir(dirname(file), { recursive: true });
            const pending = file + `.pending-${process.pid}`;
            try { await writeFile(pending, content); await rename(pending, file); fetched++; }
            finally { await rm(pending, { force: true }); }
        }
    }));
    // Native packaging reads the same snapshot through its bundled directory.
    // These copies are local build inputs; public publication omits duplicates.
    for (const [name, base] of [['space', snapshot.map_base], ['knowledge', snapshot.knowledge_base], ['search', snapshot.search_base], ['texts', snapshot.texts_base]])
        await cp(join(publicRoot, base!), join(publicRoot, snapshot.base, name!), { recursive: true });
    await cp(join(publicRoot, snapshot.map_base, 'assets'), join(publicRoot, 'map'), { recursive: true });
    await cp(join(publicRoot, snapshot.map_base, 'assets'), join(root, 'android/app/src/main/assets/map'), { recursive: true });
    const manifest = join(root, 'src/data/campus-release.json');
    await mkdir(dirname(manifest), { recursive: true });
    const pending = manifest + `.pending-${process.pid}`;
    try { await writeFile(pending, JSON.stringify(snapshot)); await rename(pending, manifest); }
    finally { await rm(pending, { force: true }); }
    console.log(`read published snapshot ${snapshot.version}; ${fetched} downloaded, ${snapshot.all.length - fetched} already local`);
    return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await pullSnapshot();
