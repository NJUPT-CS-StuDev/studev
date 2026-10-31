import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { apkPath, readManifest } from './manifest.js';

/** Incremental hashing and backpressure keep memory bounded to network chunks,
 * including N=1. Withhold each part's last chunk until its hash is verified so
 * even a final-byte mismatch cannot look like a completed Content-Length. */
export async function apkResponse(request, progress = () => {}, fetcher = fetch) {
    const url = new URL(request.url);
    const match = /^\/download\/([1-9][0-9]*)\/studev-[A-Za-z0-9._-]+\.apk$/.exec(url.pathname);
    if (!match) return new Response(null, { status: 404 });
    const manifest = await readManifest(new URL(`/download/${match[1]}/manifest.json`, url).href, fetcher);
    if (apkPath(manifest) !== url.pathname) return new Response(null, { status: 404 });
    const abort = new AbortController();
    const wholeHash = sha256.create();
    let index = 0;
    let done = 0;
    let offset = 0;
    let reader;
    let partHash;
    let pending;
    let lastNotice = 0;
    const notify = state => {
        if (state === 'downloading' && Date.now() - lastNotice < 150) return;
        lastNotice = Date.now();
        progress({ type: 'APK_DOWNLOAD', path: url.pathname, state, done, total: manifest.size });
    };
    const cleanup = () => { abort.abort(); void reader?.cancel().catch(() => {}); partHash?.destroy(); wholeHash.destroy(); };
    const body = new ReadableStream({
        async pull(controller) {
            try {
                const part = manifest.parts[index];
                if (!reader) {
                    const response = await fetcher(part.url, { cache: 'no-store', redirect: 'error', signal: abort.signal });
                    if (!response.ok || !response.body) throw new Error(`分片读取失败：${part.name}`);
                    reader = response.body.getReader();
                    partHash = sha256.create(); offset = 0;
                }
                while (!abort.signal.aborted) {
                    const result = await reader.read();
                    if (!result.done) {
                        offset += result.value.length;
                        if (offset > part.size) throw new Error('分片大小不符');
                        partHash.update(result.value); wholeHash.update(result.value);
                        const previous = pending;
                        pending = result.value;
                        if (previous) {
                            controller.enqueue(previous); done += previous.length; notify('downloading');
                            return;
                        }
                        continue;
                    }
                    if (offset !== part.size || bytesToHex(partHash.digest()) !== part.sha256) throw new Error(`分片校验失败：${part.name}`);
                    const last = index + 1 === manifest.parts.length;
                    if (last && bytesToHex(wholeHash.digest()) !== manifest.sha256) throw new Error('APK 校验失败');
                    reader.releaseLock(); reader = undefined;
                    const verified = pending; pending = undefined;
                    controller.enqueue(verified); done += verified.length;
                    index++;
                    if (last) { controller.close(); notify('complete'); }
                    else notify('downloading');
                    return;
                }
            } catch (error) {
                cleanup(); controller.error(error); notify('error');
            }
        },
        cancel() { cleanup(); notify('cancelled'); },
    }, { highWaterMark: 0 });
    return new Response(body, { headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': String(manifest.size),
        'Content-Disposition': `attachment; filename="studev-${manifest.versionName}.apk"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    } });
}
