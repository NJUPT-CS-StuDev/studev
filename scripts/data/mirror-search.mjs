// Puts a compiled search bundle's packs on object storage and names them in its manifest.
// Without a configured store the bundle simply serves from the site.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadStore, presignGet, WEEK, signedFetch } from '../../src/download/object-store.mjs';

const KEEP = 3;

/** Removes the search bundles of all but the newest few versions. */
async function prune(store, current) {
    const answer = await signedFetch(store, 'GET', '', { query: 'list-type=2&prefix=search%2F' });
    if (!answer.ok) return;
    const objects = [...(await answer.text()).matchAll(/<Key>(search\/[^<]+)<\/Key>.*?<LastModified>([^<]+)</gs)].map(([, key, modified]) => ({ key, modified, version: key.split('/')[1] }));
    const newest = new Map();
    for (const { version, modified } of objects) if (modified > (newest.get(version) ?? '')) newest.set(version, modified);
    const keep = new Set([current, ...[...newest].sort((left, right) => right[1].localeCompare(left[1])).slice(0, KEEP).map(([version]) => version)]);
    await Promise.all(objects.filter(({ version }) => !keep.has(version)).map(({ key }) => signedFetch(store, 'DELETE', key)));
}

export async function mirrorSearch(directory, version, env = process.env) {
    const store = downloadStore(env);
    if (!store) return false;
    const path = join(directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    const keys = manifest.packs.map(pack => `search/${version}/${pack}`);
    for (const [index, key] of keys.entries()) {
        const body = await readFile(join(directory, manifest.packs[index]));
        const head = await signedFetch(store, 'HEAD', key);
        if (head.ok && Number(head.headers.get('content-length')) === body.length) continue;
        const put = await signedFetch(store, 'PUT', key, { body, headers: { 'content-type': 'application/octet-stream' } });
        if (!put.ok) throw new Error(`search mirror upload failed (${put.status}): ${key}`);
    }
    manifest.mirrors = keys.map(key => presignGet(store, key, WEEK));
    await writeFile(path, JSON.stringify(manifest, null, 2));
    await prune(store, version);
    return true;
}
