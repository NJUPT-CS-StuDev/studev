// Puts a release file (the Android APK, the Windows portable zip, its update packages and feed) on object storage under its name.
import { readFile, stat } from 'node:fs/promises';
import { downloadStore, signedFetch } from '../../src/download/object-store.mjs';
import { waitForArchive } from './check-public.mjs';
import { listDownloadObjects } from './objects.mjs';

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

// Leave headroom below the account-wide 10 GB-month free Standard allowance.
// The incoming and installed releases coexist until the new updater feed is live.
const limit = 8_000_000_000;
const inventory = await listDownloadObjects(store);
const projected = [...files.values()].reduce((sum, file) => sum + file.bytes, 0)
    + inventory.filter(({ key }) => !files.has(key)).reduce((sum, { size }) => sum + size, 0);
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
