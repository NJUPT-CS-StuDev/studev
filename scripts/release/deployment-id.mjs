// The identity of what a site deployment uploads: a SHA-256 over the path and bytes of every file in it. A build whose
// identity matches the live site's /deployment.txt changes nothing there, so it is not deployed again; EdgeOne counts
// every deployment against the monthly build minutes.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const roots = ['dist', 'edge-functions', 'cloud-functions', '.server-build/edge.mjs', '.server-build/scrypt.mjs', 'edgeone.json'];
const files = [];
async function walk(path) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOTDIR') { files.push(path); return; } throw error; }
    for (const entry of entries) await walk(join(path, entry.name));
}
for (const root of roots) await walk(root);
const hash = createHash('sha256');
for (const file of files.map(file => relative('.', file).replaceAll('\\', '/')).filter(file => file !== 'dist/deployment.txt').sort()) {
    hash.update(file + '\0').update(await readFile(file)).update('\0');
}
const id = hash.digest('hex');
if (process.argv.includes('--write')) await writeFile('dist/deployment.txt', id + '\n');
console.log(id);
