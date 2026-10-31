#!/usr/bin/env node
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyArtifact } from './package-apk.mjs';

const DEFAULT_RELEASES_URL = 'https://api.github.com/repos/NJUPT-CS-StuDev/studev/releases?per_page=30';

function headers() {
  const result = { accept: 'application/vnd.github+json', 'user-agent': 'studev-apk-distribution' };
  if (process.env.GITHUB_TOKEN) result.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return result;
}

async function responseBytes(response, label) {
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function responseJson(response, label) {
  return JSON.parse(new TextDecoder().decode(await responseBytes(response, label)));
}

function assetMap(release) {
  return new Map((release.assets ?? []).map(asset => [asset.name, asset.browser_download_url ?? asset.url]));
}

function releaseTime(release) {
  return Date.parse(release.published_at ?? release.created_at ?? '') || 0;
}

/**
 * Fetch the latest two published releases that contain a complete manifest
 * contract, materializing the same public/download layout used by the site.
 * `fetcher` is injectable so the build check can run against a local fixture.
 */
export async function fetchApkReleases({
  releasesUrl = DEFAULT_RELEASES_URL,
  outputRoot,
  fetcher = fetch,
} = {}) {
  if (!outputRoot) throw new Error('outputRoot is required');
  const releaseResponse = await fetcher(releasesUrl, { headers: headers() });
  const releases = await responseJson(releaseResponse, 'GitHub releases');
  if (!Array.isArray(releases)) throw new Error('GitHub releases response is not an array');

  const candidates = releases
    .filter(release => !release.draft && !release.prerelease)
    .map(release => ({ release, assets: assetMap(release) }))
    .filter(({ assets }) => assets.has('latest.json') && assets.has('manifest.json'))
    .sort((a, b) => releaseTime(b.release) - releaseTime(a.release));
  if (candidates.length === 0) throw new Error('no published release carries latest.json and manifest.json');

  const root = resolve(outputRoot);
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d+$/.test(entry.name)) await rm(join(root, entry.name), { recursive: true, force: true });
  }

  const materialized = [];
  for (const candidate of candidates.slice(0, 2)) {
    const latest = await responseJson(await fetcher(candidate.assets.get('latest.json'), { headers: headers() }), `${candidate.release.tag_name} latest.json`);
    const manifest = await responseJson(await fetcher(candidate.assets.get('manifest.json'), { headers: headers() }), `${candidate.release.tag_name} manifest.json`);
    if (!Number.isSafeInteger(manifest.versionCode) || latest.versionCode !== manifest.versionCode) {
      throw new Error(`${candidate.release.tag_name} latest pointer does not match manifest`);
    }
    if (!Array.isArray(manifest.parts) || manifest.parts.length < 1) throw new Error(`${candidate.release.tag_name} manifest has no parts`);

    const versionRoot = join(root, String(manifest.versionCode));
    await mkdir(versionRoot, { recursive: true });
    await writeFile(join(versionRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const part of manifest.parts) {
      const assetUrl = candidate.assets.get(part.name);
      if (!assetUrl) throw new Error(`${candidate.release.tag_name} is missing ${part.name}`);
      await writeFile(join(versionRoot, part.name), await responseBytes(await fetcher(assetUrl, { headers: headers() }), `${candidate.release.tag_name} ${part.name}`));
    }
    await verifyArtifact(join(versionRoot, 'manifest.json'));
    materialized.push(manifest);
  }

  materialized.sort((a, b) => b.versionCode - a.versionCode);
  const newest = materialized[0];
  await writeFile(join(root, 'latest.json'), `${JSON.stringify({ format: 1, versionCode: newest.versionCode, manifestUrl: `/download/${newest.versionCode}/manifest.json` }, null, 2)}\n`);
  return materialized;
}

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: 'string', default: 'public/download' },
    'releases-url': { type: 'string', default: process.env.STUDEV_RELEASES_URL ?? DEFAULT_RELEASES_URL },
  } });
  const manifests = await fetchApkReleases({ outputRoot: values.output, releasesUrl: values['releases-url'] });
  console.log(JSON.stringify({ output: resolve(values.output), versions: manifests.map(manifest => manifest.versionCode) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
