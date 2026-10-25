// Checks local private values without printing any value or matching text.
import { readFile, readdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { privateFile } from './private-file.mjs';
const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const privateValues = new Set();
let ownerProfile;
try { ownerProfile = JSON.parse(await readFile(privateFile('.env.platform-owner-profile.local.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let unchangedPublicNameFiles = 0;
function hasPrivateValue(contents, path) {
  const key = relative(rootPath, path).replaceAll('\\', '/');
  return [...privateValues].some(value => {
    if (!contents.includes(value)) return false;
    if (value === ownerProfile?.realName && ownerProfile.publishedNameFiles?.[key] === createHash('sha256').update(contents).digest('hex')) { unchangedPublicNameFiles++; return false; }
    return true;
  });
}
for (const file of ['.env', '.env.collection.local', '.env.platform.local']) {
  try {
    for (const [key, value] of Object.entries(parseEnv(await readFile(file === '.env' ? new URL(file, root) : privateFile(file), 'utf8')))) {
      if (/SECRET|KEY|PASSWORD|SESSION|REGISTRATION_HASH|OWNER_QQ/.test(key) && value.length >= 5) privateValues.add(value);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const file of ['.env.platform-access.local.json', '.env.platform-owner-recovery.local.json', '.env.platform-owner-profile.local.json', '.env.collection-access.local.json']) {
  try {
    const values = JSON.parse(await readFile(privateFile(file), 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (/password|code|secret|ownerqq|owneremail|otpauth|studentid|realname/i.test(key)) {
        for (const candidate of Array.isArray(value) ? value : [value]) if (typeof candidate === 'string' && candidate.length >= (/realname/i.test(key) ? 1 : 5)) privateValues.add(candidate);
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
let files = 0; const violations = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:html|js|mjs|ts|astro|css|json|md|map|txt|csv)$/.test(entry.name)) {
      files++;
      const contents = await readFile(path, 'utf8');
      if (hasPrivateValue(contents, path)) violations.push(relative(rootPath, path));
    }
  }
}
for (const directory of ['dist', 'src', 'scripts', 'docs', 'cloud-functions', 'tests']) await scan(join(rootPath, directory));
for (const path of process.argv.slice(2)) {
  files++;
  const contents = await readFile(path, 'utf8');
  if (hasPrivateValue(contents, path)) violations.push(path);
}
console.log(JSON.stringify({ privateValuesChecked: privateValues.size, filesChecked: files, leakedFileCount: violations.length, unchangedPublicNameFiles, files: violations }));
if (violations.length) process.exitCode = 1;
