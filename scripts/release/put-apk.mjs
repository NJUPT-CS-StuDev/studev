// Puts a signed APK on object storage under its versioned name.
import { readFile } from 'node:fs/promises';
import { downloadStore, signedFetch } from '../../src/server/object-store.mjs';

const [, , file, name] = process.argv;
const store = downloadStore();
if (!store) throw new Error('object storage is not configured');
const answer = await signedFetch(store, 'PUT', name, { body: await readFile(file), headers: { 'content-type': 'application/vnd.android.package-archive' } });
if (!answer.ok) throw new Error(`upload failed (${answer.status})`);
console.log(`stored ${name}`);
