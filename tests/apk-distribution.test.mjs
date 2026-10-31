import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageApk, verifyArtifact } from '../scripts/apk/package.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'studev-apk-'));
  const apk = join(root, 'studev.apk');
  const bytes = Buffer.from(Array.from({ length: 73 }, (_, i) => i * 17 % 251));
  await writeFile(apk, bytes);
  return { root, apk, bytes };
}

test('distribution keeps one part for an APK below the limit', async t => {
  const { root, apk, bytes } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await packageApk({ apkPath: apk, outputRoot: join(root, 'download'), versionName: '1.0.0', versionCode: 1 });
  assert.equal(manifest.parts.length, 1); assert.equal(manifest.size, bytes.length);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'download/latest.json'), 'utf8')), { format: 1, versionCode: 1, manifestUrl: '/download/1/manifest.json' });
  await verifyArtifact(join(root, 'download/1/manifest.json'));
});

test('forced small parts produce N=3+ and old versions are bounded', async t => {
  const { root, apk } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'download');
  const first = await packageApk({ apkPath: apk, outputRoot: output, versionName: '1.0.0', versionCode: 1, partBytes: 20 });
  const second = await packageApk({ apkPath: apk, outputRoot: output, versionName: '1.0.1', versionCode: 2, partBytes: 20 });
  const third = await packageApk({ apkPath: apk, outputRoot: output, versionName: '1.0.2', versionCode: 3, partBytes: 20 });
  assert.equal(first.parts.length, 4); assert.equal(second.parts.length, 4); assert.equal(third.parts.length, 4);
  await assert.rejects(() => verifyArtifact(join(output, '1/manifest.json')), /ENOENT/);
  await verifyArtifact(join(output, '2/manifest.json')); await verifyArtifact(join(output, '3/manifest.json'));
});

test('corrupted parts fail the same build check', async t => {
  const { root, apk } = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'download');
  const manifest = await packageApk({ apkPath: apk, outputRoot: output, versionName: '1.0.0', versionCode: 1, partBytes: 20 });
  await writeFile(join(output, '1', manifest.parts[1].name), Buffer.from('corrupt'));
  await assert.rejects(() => verifyArtifact(join(output, '1/manifest.json')), /part hash mismatch/);
});
