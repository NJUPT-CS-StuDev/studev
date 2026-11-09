import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import release from '../data/campus-release.json';
import product from '../../product.json';

interface PackagedFile { path: string; bytes: number }

async function files(directory: string, prefix: string): Promise<PackagedFile[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(async entry => entry.isDirectory()
        ? files(join(directory, entry.name), `${prefix}/${entry.name}`)
        : [{ path: `${prefix}/${entry.name}`, bytes: (await stat(join(directory, entry.name))).size }]))).flat();
}

/** Lists existing packaged files and names the current app; no data facts are computed here. */
export async function offlineRelease() {
    const data = await files(join(process.cwd(), 'public', release.base), release.base);
    const map = await files(join(process.cwd(), 'public/map'), '/map');
    const core = data.filter(file => file.path.startsWith(`${release.base}/space/`));
    return {
        ...release,
        core: [...core, ...map].map(file => file.path), all: data.map(file => file.path),
        bytes: [...data, ...map].reduce((sum, file) => sum + file.bytes, 0),
        // The Android app compares itself with this and offers /download/ when it is behind.
        android: { versionName: product.android.versionName, versionCode: product.android.versionCode },
    };
}
