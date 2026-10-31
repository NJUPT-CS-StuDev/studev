/** The one published APK contract, shared by the page and service worker. */
export async function readManifest(url, fetcher = fetch) {
    const origin = new URL(url).origin;
    const response = await fetcher(url, { cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error(`版本信息读取失败：${response.status}`);
    const manifest = await response.json();
    const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const size = value => Number.isSafeInteger(value) && value > 0;
    if (manifest.format !== 1 || !Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1 ||
        typeof manifest.versionName !== 'string' || !/^[A-Za-z0-9._-]+$/.test(manifest.versionName) ||
        !size(manifest.size) || !hash(manifest.sha256) || !Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('版本信息无效');
    const names = new Set();
    const parts = manifest.parts.map(part => {
        const partUrl = new URL(part.url, url);
        if (!/^part-[0-9]{3,}$/.test(part.name) || names.has(part.name) || !size(part.size) ||
            part.size > 24 * 1024 * 1024 || !hash(part.sha256) || partUrl.origin !== origin ||
            partUrl.pathname !== `/download/${manifest.versionCode}/${part.name}` || partUrl.search || partUrl.hash || partUrl.username || partUrl.password) throw new Error('下载分片信息无效');
        names.add(part.name);
        return { ...part, url: partUrl.href };
    });
    if (parts.reduce((total, part) => total + part.size, 0) !== manifest.size) throw new Error('下载大小不一致');
    return { ...manifest, parts };
}

export async function readLatest(origin, fetcher = fetch) {
    const response = await fetcher(new URL('/download/latest.json', origin), { cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('暂时无法读取最新版本，请稍后重试。');
    const pointer = await response.json();
    if (pointer.format !== 1 || !Number.isSafeInteger(pointer.versionCode) || pointer.versionCode < 1 ||
        pointer.manifestUrl !== `/download/${pointer.versionCode}/manifest.json`) throw new Error('版本信息无效');
    const manifest = await readManifest(new URL(pointer.manifestUrl, origin).href, fetcher);
    if (manifest.versionCode !== pointer.versionCode) throw new Error('版本信息不一致');
    return manifest;
}

export const apkPath = manifest => `/download/${manifest.versionCode}/studev-${manifest.versionName}.apk`;
