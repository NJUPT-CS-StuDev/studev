// One public data site. Stable component directories preserve compiled inputs
// and client caches; EdgeOne still uploads a complete deployment archive.
import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { offlineRelease } from '../../src/pwa/release.ts';
import type { CampusRelease } from '../../src/campus/world/release.ts';
import product from '../../product.json' with { type: 'json' };

export const componentPath = (base: string) => new URL(base, product.campusOrigin).pathname;
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value)); };
const embedded = ['space', 'knowledge', 'search', 'texts'];
const config = { headers: [
    { source: '/*', headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'GET, HEAD, OPTIONS' },
        { key: 'Access-Control-Allow-Headers', value: 'Range' },
        { key: 'Access-Control-Expose-Headers', value: 'Accept-Ranges, Content-Length, Content-Range' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ] },
    { source: '/campus-release.json', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
] };

/** The current pointer and its resources become public in one atomic deployment.
 * Historical observations live upstream; this is not a public file archive. */
export async function prepareSite(destination: string, release?: CampusRelease, root = process.cwd()) {
    const snapshot = release ?? await offlineRelease();
    const publicRoot = join(root, 'public'), out = resolve(destination);
    await mkdir(out, { recursive: true });
    const copy = async (base: string, facts = false) => {
        const path = componentPath(base), input = join(publicRoot, path);
        await cp(input, join(out, path), { recursive: true,
            filter: source => !facts || !embedded.includes(relative(input, source).split(/[\\/]/)[0]!) });
    };
    await copy(snapshot.base, true);
    for (const base of [snapshot.map_base, snapshot.knowledge_base, snapshot.search_base, snapshot.texts_base]) await copy(base);
    await write(join(out, 'campus-release.json'), snapshot);
    await write(join(out, 'edgeone.json'), config);
    await writeFile(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>StuDev data</title>');
    await write(join(out, '.edgeone/project.json'), { Name: product.dataProject.name, ProjectId: product.dataProject.id });
    return snapshot;
}

export async function directoryBytes(folder: string): Promise<number> {
    let bytes = 0;
    for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.name === '.edgeone') continue;
        const path = join(folder, entry.name);
        bytes += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
    }
    return bytes;
}
