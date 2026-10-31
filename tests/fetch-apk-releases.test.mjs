import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchApkReleases } from '../scripts/apk/fetch-releases.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function fixtureRelease(tagName, versionCode, chunks, publishedAt) {
  const bytes = Buffer.concat(chunks);
  const manifest = {
    format: 1,
    versionName: `1.0.${versionCode}`,
    versionCode,
    minSdk: 26,
    size: bytes.length,
    sha256: hash(bytes),
    releaseNotes: tagName,
    parts: chunks.map((part, index) => ({ name: `part-${String(index).padStart(3, '0')}`, size: part.length, sha256: hash(part), url: `part-${String(index).padStart(3, '0')}` })),
  };
  const assets = [
    ['latest.json', JSON.stringify({ format: 1, versionCode, manifestUrl: 'manifest.json' })],
    ['manifest.json', JSON.stringify(manifest)],
    ...chunks.map((part, index) => [`part-${String(index).padStart(3, '0')}`, part]),
  ];
  return { tag_name: tagName, draft: false, prerelease: false, published_at: publishedAt, assets: assets.map(([name, body]) => ({ name, browser_download_url: `http://fixture/${tagName}/${name}`, body })) };
}

test('fetches one-part and three-part releases and bounds site output to two versions', async t => {
  const releases = [
    fixtureRelease('v1.0.2', 3, [Buffer.from('one')], '2026-10-30T00:00:00Z'),
    fixtureRelease('v1.0.1', 2, [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')], '2026-10-29T00:00:00Z'),
    fixtureRelease('v1.0.0', 1, [Buffer.from('old')], '2026-10-28T00:00:00Z'),
  ];
  const fixture = new Map();
  for (const release of releases) for (const asset of release.assets) fixture.set(asset.browser_download_url, asset.body);
  const fetcher = async url => {
    if (url === 'http://fixture/releases') return new Response(JSON.stringify(releases));
    const body = fixture.get(String(url));
    if (body === undefined) return new Response('', { status: 404 });
    return new Response(body);
  };
  const root = await mkdtemp(join(tmpdir(), 'studev-fetch-')); t.after(() => rm(root, { recursive: true, force: true }));
  const manifests = await fetchApkReleases({ releasesUrl: 'http://fixture/releases', outputRoot: root, fetcher });
  assert.deepEqual(manifests.map(manifest => manifest.versionCode), [3, 2]);
  assert.deepEqual(JSON.parse(await readFile(join(root, 'latest.json'), 'utf8')), { format: 1, versionCode: 3, manifestUrl: '/download/3/manifest.json' });
  assert.equal((await readFile(join(root, '3/part-000'))).toString(), 'one');
  assert.deepEqual((await readFile(join(root, '2/part-000'))).toString(), 'a');
  assert.deepEqual((await readFile(join(root, '2/part-001'))).toString(), 'b');
  assert.deepEqual((await readFile(join(root, '2/part-002'))).toString(), 'c');
  await assert.rejects(() => readFile(join(root, '1/manifest.json')), /ENOENT/);
});

