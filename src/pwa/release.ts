import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import release from '../data/campus-release.json' with { type: 'json' };
import type { CampusRelease } from '../campus/world/release';

interface PackagedFile { path: string; bytes: number }

async function files(directory: string, prefix: string): Promise<PackagedFile[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(async entry => entry.isDirectory()
        ? files(join(directory, entry.name), `${prefix}/${entry.name}`)
        : [{ path: `${prefix}/${entry.name}`, bytes: (await stat(join(directory, entry.name))).size }]))).flat();
}

/** Measures the independently versioned public components. Application metadata
 * belongs to app-release.json on the application host. */
export async function offlineRelease() {
    const snapshot = release as unknown as CampusRelease;
    const publicRoot = join(process.cwd(), 'public');
    const data = (await files(join(publicRoot, snapshot.base), snapshot.base)).filter(file =>
        !['space', 'knowledge', 'search', 'texts'].some(name => file.path.startsWith(`${snapshot.base}/${name}/`)));
    const local = (base: string) => new URL(base, 'https://campus.invalid').pathname;
    const map = await files(join(publicRoot, local(snapshot.map_base)), snapshot.map_base);
    const knowledge = await files(join(publicRoot, local(snapshot.knowledge_base)), snapshot.knowledge_base);
    const search = await files(join(publicRoot, local(snapshot.search_base)), snapshot.search_base);
    const texts = await files(join(publicRoot, local(snapshot.texts_base)), snapshot.texts_base);
    const all = [...data, ...map, ...knowledge, ...search, ...texts];
    return {
        ...snapshot, core: map.map(file => file.path), all: all.map(file => file.path),
        bytes: all.reduce((sum, file) => sum + file.bytes, 0),
    };
}
