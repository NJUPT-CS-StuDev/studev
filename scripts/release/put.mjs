// Puts a release file (the Android APK, the Windows portable zip, its update packages and feed) on object storage under its name.
import { readFile, stat } from 'node:fs/promises';
import { downloadStore, signedFetch } from '../../src/download/object-store.mjs';
import { waitForArchive } from './check-public.mjs';

const args = process.argv.slice(2);
if (!args.length || args.length % 2 !== 0) throw new Error('Provide file and object name pairs.');
const store = downloadStore();
if (!store) throw new Error('object storage is not configured');
const files = new Map();
for (let i = 0; i < args.length; i += 2) {
    const [file, name] = args.slice(i, i + 2);
    if (files.has(name)) throw new Error(`duplicate object ${name}`);
    files.set(name, { file, bytes: (await stat(file)).size });
}

// Leave headroom under the account-wide 10 GB-month free Standard allowance.
// Versioned downloads stay available, so reaching this limit stops publication.
const limit = 8_000_000_000;
let projected = [...files.values()].reduce((sum, file) => sum + file.bytes, 0);
let cursor;
do {
    const query = new URLSearchParams({ 'list-type': '2', 'encoding-type': 'url' });
    if (cursor) query.set('continuation-token', cursor);
    const answer = await signedFetch(store, 'GET', '', { query, signal: AbortSignal.timeout(20_000) });
    if (!answer.ok) throw new Error(`could not check download storage budget (${answer.status})`);
    const xml = await answer.text();
    if (!xml.includes('ListBucketResult')) throw new Error('unexpected download storage inventory');
    for (const [object] of xml.matchAll(/<Contents>[\s\S]*?<\/Contents>/g)) {
        const key = object.match(/<Key>([^<]+)<\/Key>/)?.[1];
        const size = object.match(/<Size>(\d+)<\/Size>/)?.[1];
        if (!key || size === undefined) throw new Error('incomplete download storage inventory');
        if (!files.has(decodeURIComponent(key))) projected += Number(size);
    }
    cursor = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]?.replace(/&amp;/g, '&');
    if (xml.includes('<IsTruncated>true</IsTruncated>') && !cursor) throw new Error('download storage inventory has no continuation token');
} while (cursor);
if (projected > limit) throw new Error(`download storage would reach ${projected} bytes (release budget ${limit})`);
console.log(`download storage after upload: ${projected} bytes / ${limit}`);

const { downloadOrigin } = JSON.parse(await readFile(new URL('../../product.json', import.meta.url), 'utf8'));
async function publish([name, { file }]) {
    const type = name.endsWith('.apk') ? 'application/vnd.android.package-archive' : name.endsWith('.zip') ? 'application/zip' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    const cache = name.endsWith('.json') ? 'no-cache' : 'public, max-age=31536000, immutable';
    const body = await readFile(file);
    const answer = await signedFetch(store, 'PUT', name, { body, headers: { 'content-type': type, 'cache-control': cache }, signal: AbortSignal.timeout(180_000) });
    if (!answer.ok) throw new Error(`upload failed for ${name} (${answer.status})`);
    console.log(`stored ${name}`);
    if (/\.(apk|zip|nupkg)$/.test(name)) {
        await waitForArchive(new URL(name, downloadOrigin + '/').href, body.length);
        console.log(`verified public download ${name}`);
    }
}

const batch = [...files];
for (let start = 0; start < batch.length; start += 4) {
    const results = await Promise.allSettled(batch.slice(start, start + 4).map(publish));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
}
