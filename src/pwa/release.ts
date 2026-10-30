import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import release from '../data/campus-release.json';

async function files(directory: string, prefix: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory()
        ? files(join(directory, entry.name), `${prefix}/${entry.name}`)
        : [`${prefix}/${entry.name}`]))).flat();
}

/** Lists existing packaged files; no data facts are computed here. */
export async function offlineRelease() {
    const data = await files(join(process.cwd(), 'public', release.base), release.base);
    const map = await files(join(process.cwd(), 'public/map'), '/map');
    const core = data.filter(path => path.startsWith(`${release.base}/space/`));
    return { version: release.version, base: release.base, core: [...core, ...map], all: data };
}
