import { appendFile, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const archiveSignature = [0x50, 0x4b, 3, 4];

/** Check the actual public object, with an ordinary URL and a small byte range. */
export async function verifyArchive(url, size, fetchArchive = fetch) {
    const signature = new URL(url).pathname.endsWith('.exe') ? [0x4d, 0x5a] : archiveSignature;
    const response = await fetchArchive(url, { headers: { Range: 'bytes=0-3' }, signal: AbortSignal.timeout(15_000) });
    const reader = response.body?.getReader();
    try {
        const length = response.status === 206
            ? response.headers.get('content-range')?.match(/^bytes 0-3\/(\d+)$/)?.[1]
            : response.status === 200 ? response.headers.get('content-length') : undefined;
        if (Number(length) !== size || !reader) throw new Error(`${url}: expected ${size} public bytes, got HTTP ${response.status}`);
        const prefix = [];
        while (prefix.length < signature.length) {
            const { value, done } = await reader.read();
            if (done) break;
            prefix.push(...value.subarray(0, signature.length - prefix.length));
        }
        if (!signature.every((byte, index) => byte === prefix[index])) {
            throw new Error(`${url}: the download is not an archive`);
        }
    } finally { await reader?.cancel().catch(() => {}); }
}

export async function waitForArchive(url, size) {
    for (let attempt = 0; ; attempt++) {
        try { await verifyArchive(url, size); return; }
        catch (error) {
            if (attempt === 4) throw error;
            await delay(1_000 * 2 ** attempt);
        }
    }
}

export async function publicRelease(product, request = fetch, verify = waitForArchive) {
    const { versionName } = product.android;
    const token = process.env.GH_TOKEN;
    const response = await request(`https://api.github.com/repos/${product.repository}/releases/tags/v${versionName}`, {
        headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`GitHub release v${versionName}: HTTP ${response.status}`);
    const release = await response.json();
    if (release.draft || release.prerelease) return false;
    const apk = `studev-${versionName}.apk`;
    const windows = `studev-${versionName}-windows.zip`;
    await Promise.all([[apk, apk], [windows, `windows/${windows}`]].map(async ([name, path]) => {
        const asset = release.assets.find(file => file.name === name && file.state === 'uploaded' && file.size >= 4);
        if (!asset) throw new Error(`GitHub release v${versionName} is missing ${name}`);
        await verify(new URL(path, product.downloadOrigin + '/').href, asset.size);
    }));
    return true;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const product = JSON.parse(await readFile(new URL('../../product.json', import.meta.url), 'utf8'));
    const ready = await publicRelease(product);
    console.log(ready ? `Android and Windows downloads for v${product.android.versionName} are public`
        : `Waiting for the public v${product.android.versionName} release. The website stays on the current version.`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
}
