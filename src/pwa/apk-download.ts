export interface ApkPart { name: string; size: number; sha256: string; url: string }
export interface ApkManifest { format: number; versionName: string; versionCode: number; minSdk: number; size: number; sha256: string; releaseNotes: string; parts: ApkPart[] }
interface LatestPointer { format: number; versionCode: number; manifestUrl: string }

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
async function sha256(bytes: ArrayBuffer) { return hex(await crypto.subtle.digest('SHA-256', bytes)); }

export async function readApkManifest(latestUrl = '/download/latest.json', fetcher: typeof fetch = fetch): Promise<ApkManifest> {
    const latestResponse = await fetcher(latestUrl, { cache: 'no-store' });
    if (!latestResponse.ok) throw new Error(`latest.json HTTP ${latestResponse.status}`);
    const latest = await latestResponse.json() as LatestPointer;
    if (!latest.manifestUrl || !Number.isInteger(latest.versionCode)) throw new Error('invalid APK latest pointer');
    const manifestUrl = new URL(latest.manifestUrl, new URL(latestUrl, globalThis.location?.href ?? 'http://localhost/'));
    const manifestResponse = await fetcher(manifestUrl, { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json() as ApkManifest;
    if (manifest.versionCode !== latest.versionCode || !Array.isArray(manifest.parts) || manifest.parts.length < 1) throw new Error('invalid APK manifest');
    return { ...manifest, parts: manifest.parts.map(part => ({ ...part, url: new URL(part.url, manifestUrl).toString() })) };
}

export async function downloadApk(manifest: ApkManifest, baseUrl: string, onProgress?: (done: number, total: number) => void, fetcher: typeof fetch = fetch): Promise<Blob> {
    const chunks: ArrayBuffer[] = [];
    let done = 0;
    for (const part of manifest.parts) {
        const response = await fetcher(new URL(part.url, baseUrl), { cache: 'no-store' });
        if (!response.ok) throw new Error(`part ${part.name} HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== part.size || await sha256(bytes) !== part.sha256) throw new Error(`part ${part.name} 校验失败`);
        chunks.push(bytes); done += bytes.byteLength; onProgress?.(done, manifest.size);
    }
    const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
    if (blob.size !== manifest.size || await sha256(await blob.arrayBuffer()) !== manifest.sha256) throw new Error('APK 校验失败');
    return blob;
}

export function saveApkBlob(blob: Blob, versionName: string, documentRef: Document = document): boolean {
    if (typeof URL?.createObjectURL !== 'function') return false;
    const anchor = documentRef.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    try {
        if (!('download' in anchor)) return false;
        anchor.href = objectUrl; anchor.download = `studev-${versionName}.apk`; anchor.rel = 'noopener';
        anchor.click(); return true;
    } catch { return false; } finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000); }
}
