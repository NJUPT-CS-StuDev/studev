import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { downloadStore, signedFetch } from '../../src/download/object-store.mjs';
import { waitForArchive } from './check-public.mjs';
import { listDownloadObjects } from './objects.mjs';

const versionPattern = /^\d+\.\d+\.\d+$/;
const directPatterns = [/^(studev-(\d+\.\d+\.\d+)(?:\.apk|-windows\.exe))$/, /^windows\/(studev-(\d+\.\d+\.\d+)-windows\.zip)$/];
const directArchive = key => directPatterns.map(pattern => pattern.exec(key)).find(Boolean) || [];
const packagePattern = /^windows\/top\.hicancan\.studev-(\d+\.\d+\.\d+)-(full|delta)\.nupkg$/;
const feedKey = 'windows/releases.win.json';
const oldPortable = 'windows/top.hicancan.studev-win-Portable.zip';
const packageId = 'top.hicancan.studev';
const call = promisify(execFile);
const isOlder = (candidate, current) => {
    const target = current.split('.').map(part => BigInt(part));
    for (const [index, segment] of candidate.split('.').entries()) {
        const part = BigInt(segment);
        if (part !== target[index]) return part < target[index];
    }
    return false;
};
const windowsArchive = version => 'studev-' + version + '-windows.zip';

export function archivedAssets(releases, repository) {
    const versions = new Map();
    for (const release of releases) {
        const version = release.tag_name?.slice(1);
        if (release.draft || release.prerelease || !release.tag_name?.startsWith('v') || !versionPattern.test(version)) continue;
        const assets = new Map();
        for (const asset of release.assets ?? []) {
            const url = 'https://github.com/' + repository + '/releases/download/v' + version + '/' + asset.name;
            if (asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size >= 4 && asset.browser_download_url === url) {
                assets.set(asset.name, { url, size: asset.size });
            }
        }
        versions.set(version, assets);
    }
    return versions;
}

export function feedObjects(feed, version, latestOnly) {
    const assets = feed?.Assets;
    if (!Array.isArray(assets) || !assets.some(asset => asset.Type === 'Full' && asset.Version === version)) {
        throw new Error('Windows feed does not have the live version.');
    }
    if (latestOnly && assets.length !== 1) throw new Error('Publish the latest-only Windows feed before pruning.');
    return assets.map(asset => {
        if (!versionPattern.test(asset.Version) || !['Full', 'Delta'].includes(asset.Type) ||
            asset.PackageId !== packageId || asset.FileName !== packageId + '-' + asset.Version + '-' + asset.Type.toLowerCase() + '.nupkg'
            || !Number.isSafeInteger(asset.Size) || asset.Size < 4) throw new Error('Unexpected Windows update asset.');
        return { key: 'windows/' + asset.FileName, size: asset.Size };
    });
}

export async function planRetention(inventory, current, referenced, archives, verify = waitForArchive) {
    const keep = new Set([feedKey, 'studev-' + current + '.apk', 'windows/' + windowsArchive(current), ...referenced.map(asset => asset.key)]);
    const candidate = [];
    const retained = [];
    for (const object of inventory) {
        if (keep.has(object.key)) continue;
        const [, archiveName, archiveVersion] = directArchive(object.key);
        const [, packageVersion, kind] = packagePattern.exec(object.key) ?? [];
        let asset;
        if (archiveVersion && isOlder(archiveVersion, current)) {
            asset = archives.get(archiveVersion)?.get(archiveName);
            if (asset?.size !== object.size) asset = undefined;
        } else if (packageVersion && (isOlder(packageVersion, current) || (packageVersion === current && kind === 'delta'))) {
            asset = archives.get(packageVersion)?.get(windowsArchive(packageVersion));
        } else if (object.key === oldPortable && /^"[a-f\d]{32}"$/i.test(object.etag)) {
            const duplicate = inventory.find(row => row.key.startsWith('windows/') && row.key !== object.key &&
                directArchive(row.key).length && row.key.endsWith('.zip') && row.size === object.size && row.etag === object.etag);
            if (duplicate) {
                const [, name, version] = directArchive(duplicate.key);
                asset = archives.get(version)?.get(name);
                if (asset?.size !== object.size) asset = undefined;
            }
        }
        if (asset) candidate.push({ object, asset });
        else retained.push(object);
    }

    // Probe each GitHub asset once even when it archives the matching ZIP, full and delta.
    const files = [...new Map(candidate.map(({ asset }) => [asset.url, asset])).values()];
    const unavailable = new Set();
    for (let offset = 0; offset < files.length; offset += 8) {
        await Promise.all(files.slice(offset, offset + 8).map(async asset => {
            try { await verify(asset.url, asset.size); }
            catch { unavailable.add(asset.url); }
        }));
    }
    const removing = [];
    for (const { object, asset } of candidate) {
        if (unavailable.has(asset.url)) retained.push(object);
        else removing.push(object);
    }
    return { removing, retained };
}

async function liveRelease(product) {
    const current = await fetch(new URL('/app-release.json', product.origin), {
        headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000),
    });
    if (!current.ok) throw new Error('The deployed release cannot be read.');
    const { android } = await current.json();
    if (!versionPattern.test(android?.versionName) || !Number.isSafeInteger(android.versionCode)) throw new Error('Unexpected live release version.');
    return android;
}

async function liveUpdates(product, version, inventory, apply, archives) {
    const feed = await fetch(new URL(feedKey, product.downloadOrigin + '/'), {
        headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000),
    });
    if (!feed.ok) throw new Error('The public Windows feed cannot be read.');
    const objects = feedObjects(await feed.json(), version, apply);
    const currentKeys = ['studev-' + version + '.apk', 'windows/' + windowsArchive(version)];
    for (const key of currentKeys) {
        const asset = archives.get(version)?.get(key.split('/').at(-1));
        if (!asset || !inventory.some(object => object.key === key && object.size === asset.size)) {
            throw new Error('The current download copies disagree for ' + key);
        }
        objects.push({ key, size: asset.size });
    }
    if (objects.some(asset => !inventory.some(object => object.key === asset.key && object.size === asset.size))) {
        throw new Error('A live update asset is missing from R2.');
    }
    return objects;
}

async function main() {
    const apply = process.argv.includes('--apply');
    if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Use prune.mjs [--apply].');
    const store = downloadStore();
    if (!store) throw new Error('Object storage is not configured.');
    const product = JSON.parse(await readFile(new URL('../../product.json', import.meta.url), 'utf8'));
    const [live, inventory, { stdout }] = await Promise.all([
        liveRelease(product),
        listDownloadObjects(store),
        call('gh', ['api', 'repos/' + product.repository + '/releases?per_page=100', '--paginate', '--slurp'], { maxBuffer: 32 * 1024 * 1024, windowsHide: true }),
    ]);
    const version = live.versionName;
    if (apply && (version !== product.android.versionName || live.versionCode !== product.android.versionCode)) {
        throw new Error('Wait until the site and both native downloads serve the release being published.');
    }
    const archives = archivedAssets(JSON.parse(stdout).flat(), product.repository);
    const referenced = await liveUpdates(product, version, inventory, apply, archives);
    const currentDownloads = referenced.filter(object => !packagePattern.test(object.key));
    await Promise.all([
        ...referenced.map(object => waitForArchive(new URL(object.key, product.downloadOrigin + '/').href, object.size)),
        ...currentDownloads.map(object => {
            const asset = archives.get(version).get(object.key.split('/').at(-1));
            return waitForArchive(asset.url, asset.size);
        }),
    ]);
    const { removing, retained } = await planRetention(inventory, version, referenced, archives);
    const bytes = rows => rows.reduce((sum, object) => sum + object.size, 0);
    console.log('Download storage: ' + inventory.length + ' objects, ' + bytes(inventory) + ' bytes.');
    console.log('Verified old objects: ' + removing.length + ', ' + bytes(removing) + ' bytes.');
    if (retained.length) console.log('Preserved outside current distribution: ' + retained.map(object => object.key).join(', '));
    if (!apply || !removing.length) return;
    // Repeat live read after archive probes, since a different release could have started in the meantime.
    const [current, latest] = await Promise.all([liveRelease(product), liveUpdates(product, version, inventory, true, archives)]);
    if (current.versionName !== version || current.versionCode !== live.versionCode || JSON.stringify(latest) !== JSON.stringify(referenced)) {
        throw new Error('The live release changed while checking history.');
    }
    for (let offset = 0; offset < removing.length; offset += 8) {
        await Promise.all(removing.slice(offset, offset + 8).map(async object => {
            const response = await signedFetch(store, 'DELETE', object.key, { signal: AbortSignal.timeout(20_000) });
            if (!response.ok) throw new Error('Could not remove archived ' + object.key + ' (' + response.status + ')');
        }));
    }
    const after = await listDownloadObjects(store);
    const remaining = new Set(after.map(object => object.key));
    if (removing.some(object => remaining.has(object.key)) || !remaining.has(feedKey) || referenced.some(object => !remaining.has(object.key))) {
        throw new Error('The R2 inventory changed unexpectedly; check the live distribution before retrying.');
    }
    console.log('Download storage after cleanup: ' + after.length + ' objects, ' + bytes(after) + ' bytes.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    try { await main(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
