// Puts a release file (the Android APK, the Windows portable zip, its update packages and feed) on object storage under its name.
import { readFile } from 'node:fs/promises';
import { downloadStore, signedFetch } from '../../src/download/object-store.mjs';

const [, , file, name] = process.argv;
const store = downloadStore();
if (!store) throw new Error('object storage is not configured');
const answer = await signedFetch(store, 'PUT', name, { body: await readFile(file), headers: { 'content-type': name.endsWith('.apk') ? 'application/vnd.android.package-archive' : name.endsWith('.zip') ? 'application/zip' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
if (!answer.ok) throw new Error(`upload failed (${answer.status})`);
console.log(`stored ${name}`);
