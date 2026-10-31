#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const MAX_PART_BYTES = 24 * 1024 * 1024;

async function digestBytes(bytes) {
  return { size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function splitApk(apkPath, outputDir, partBytes = MAX_PART_BYTES) {
  if (!Number.isSafeInteger(partBytes) || partBytes < 1 || partBytes > MAX_PART_BYTES) throw new Error(`part size must be between 1 and ${MAX_PART_BYTES}`);
  const apk = await readFile(apkPath);
  const whole = await digestBytes(apk);
  const parts = [];
  for (let offset = 0, index = 0; offset < apk.length; offset += partBytes, index += 1) {
    const name = `part-${String(index).padStart(3, '0')}`;
    const bytes = apk.subarray(offset, Math.min(offset + partBytes, apk.length));
    await writeFile(join(outputDir, name), bytes);
    parts.push({ name, size: bytes.length, sha256: (await digestBytes(bytes)).sha256, offset });
  }
  return { whole, parts };
}

export async function verifyArtifact(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const root = resolve(manifestPath, '..');
  if (!Array.isArray(manifest.parts) || manifest.parts.length < 1) throw new Error('manifest must contain at least one part');
  if (manifest.size < 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('invalid whole APK metadata');
  let total = 0;
  const wholeHash = createHash('sha256');
  for (const part of manifest.parts) {
    if (!part.name || part.name.includes('/') || part.name.includes('\\') || part.size < 1 || part.size > MAX_PART_BYTES) throw new Error(`invalid part metadata: ${part.name}`);
    const path = join(root, part.name);
    const bytes = await readFile(path);
    const actual = await digestBytes(bytes);
    if (actual.size !== part.size || actual.sha256 !== part.sha256) throw new Error(`part hash mismatch: ${part.name}`);
    total += bytes.length; wholeHash.update(bytes);
  }
  if (total !== manifest.size || wholeHash.digest('hex') !== manifest.sha256) throw new Error('whole APK hash mismatch');
  return manifest;
}

export async function packageApk({ apkPath, outputRoot, versionName, versionCode, minSdk = 26, releaseNotes = '', partBytes = MAX_PART_BYTES }) {
  if (!versionName || !Number.isSafeInteger(Number(versionCode))) throw new Error('versionName and versionCode are required');
  const versionDir = join(outputRoot, String(versionCode));
  await mkdir(versionDir, { recursive: true });
  for (const entry of await readdir(versionDir)) await rm(join(versionDir, entry), { recursive: true, force: true });
  const { whole, parts } = await splitApk(apkPath, versionDir, partBytes);
  const manifest = {
    format: 1,
    versionName,
    versionCode: Number(versionCode),
    minSdk: Number(minSdk),
    size: whole.size,
    sha256: whole.sha256,
    releaseNotes,
    parts: parts.map(({ name, size, sha256 }) => ({ name, size, sha256, url: name })),
  };
  const manifestPath = join(versionDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await verifyArtifact(manifestPath);
  const versions = (await readdir(outputRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map(entry => Number(entry.name)).sort((a, b) => b - a);
  for (const old of versions.slice(2)) await rm(join(outputRoot, String(old)), { recursive: true, force: true });
  await writeFile(join(outputRoot, 'latest.json'), `${JSON.stringify({ format: 1, versionCode: Number(versionCode), manifestUrl: `/download/${versionCode}/manifest.json` }, null, 2)}\n`);
  return manifest;
}

async function main() {
  const { values } = parseArgs({ options: {
    apk: { type: 'string' }, output: { type: 'string', default: 'public/download' }, 'version-name': { type: 'string' }, 'version-code': { type: 'string' }, 'min-sdk': { type: 'string', default: '26' }, notes: { type: 'string', default: '' }, 'part-size': { type: 'string' }, check: { type: 'string' },
  } });
  if (values.check) { await verifyArtifact(resolve(values.check)); console.log(`verified ${values.check}`); return; }
  if (!values.apk || !values['version-name'] || !values['version-code']) throw new Error('--apk, --version-name and --version-code are required');
  const apkPath = resolve(values.apk); const output = resolve(values.output);
  await mkdir(output, { recursive: true });
  const manifest = await packageApk({ apkPath, outputRoot: output, versionName: values['version-name'], versionCode: Number(values['version-code']), minSdk: Number(values['min-sdk']), releaseNotes: values.notes, partBytes: values['part-size'] ? Number(values['part-size']) : MAX_PART_BYTES });
  console.log(JSON.stringify({ versionCode: manifest.versionCode, size: manifest.size, parts: manifest.parts.length, output }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
