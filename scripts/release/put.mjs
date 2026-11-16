// Puts a release file (the Android APK, the Windows portable zip, its update packages and feed) on object storage under its name.
import { readFile } from 'node:fs/promises';
import { downloadStore, signedFetch } from '../../src/download/object-store.mjs';

const [, , file, name] = process.argv;
const store = downloadStore();
if (!store) throw new Error('object storage is not configured');
const type = name.endsWith('.apk') ? 'application/vnd.android.package-archive' : name.endsWith('.zip') ? 'application/zip' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
// A feed changes with each release and is read fresh; a package never changes once out.
const cache = name.endsWith('.json') ? 'no-cache' : 'public, max-age=31536000, immutable';
const answer = await signedFetch(store, 'PUT', name, { body: await readFile(file), headers: { 'content-type': type, 'cache-control': cache } });
if (!answer.ok) throw new Error(`upload failed (${answer.status})`);
console.log(`stored ${name}`);
