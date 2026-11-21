import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SEARCH_BUNDLE_FORMAT, type Profile, type SearchDocument } from 'wasm-search';
import { compileBundle } from 'wasm-search/compile';

interface PackRef { pack: number; offset: number; bytes: number; decoded_bytes: number }
interface Segment { format: string; index: PackRef; packs: string[]; profile: Profile }

async function segment(cache: string, version: string, docs: SearchDocument[], profile: Profile) {
    const input = JSON.stringify({ format: SEARCH_BUNDLE_FORMAT, profile, docs });
    const directory = join(cache, 'bundle');
    const inputsFile = join(cache, 'inputs.json');
    const manifestFile = join(directory, 'manifest.json');
    const versionFile = join(cache, 'version.txt');
    const existing = await readFile(inputsFile, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
    });
    if (existing === input) {
        version = (await readFile(versionFile, 'utf8')).trim();
        console.log('campus: reusing search segment ' + version);
    } else {
        console.log('campus: compiling ' + docs.length + ' search documents for ' + version);
        const pending = cache + '-' + process.pid + '.pending';
        try {
            await compileBundle(docs, profile, join(pending, 'bundle'));
            await writeFile(join(pending, 'version.txt'), version);
            await writeFile(join(pending, 'inputs.json'), input);
            await rm(cache, { recursive: true, force: true });
            await rename(pending, cache);
        } finally {
            await rm(pending, { recursive: true, force: true });
        }
    }
    const manifest: Segment = JSON.parse(await readFile(manifestFile, 'utf8'));
    return { version, directory, manifest };
}

/** The current month's changed articles and current exams form the increment. Older
 * articles and long-lived entities stay in the base until their inputs change. */
export async function packageSearch(root: string, out: string, version: string, observed: string, docs: SearchDocument[], profile: Profile) {
    const cutoff = observed.slice(0, 7) + '-01';
    const stable: SearchDocument[] = [];
    const recent: SearchDocument[] = [];
    for (const document of docs) {
        const date = document.updated || document.published;
        (document.source === 'exams' || (date && date >= cutoff) ? recent : stable).push(document);
    }
    const cache = join(root, '.data', 'search');
    const head = join(out, 'search');
    for (const name of ['search', 'search-base']) await rm(join(out, name), { recursive: true, force: true });
    if (!stable.length || !recent.length) {
        const only = await segment(join(cache, 'base'), version, docs, profile);
        await cp(only.directory, head, { recursive: true });
        return { version: only.version, format: only.manifest.format, base: null };
    }
    const base = await segment(join(cache, 'base'), version, stable, profile);
    const delta = await segment(join(cache, 'recent'), version, recent, profile);
    await mkdir(head, { recursive: true });
    await cp(base.directory, join(out, 'search-base'), { recursive: true });
    for (const pack of delta.manifest.packs) await cp(join(delta.directory, pack), join(head, pack));
    const baseName = base.version + '-base';
    const packs = [...base.manifest.packs.map(pack => '../' + baseName + '/' + pack), ...delta.manifest.packs];
    const segments = [{ ...delta.manifest.index, pack: base.manifest.packs.length }];
    const manifest = { ...base.manifest, packs, segments };
    await writeFile(join(head, 'manifest.json'), JSON.stringify(manifest));
    return { version: base.version + '__' + delta.version, format: manifest.format, base: '/search/' + baseName };
}
