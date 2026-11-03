import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { apkPath, readManifest } from './manifest.js';
import { CONCURRENCY } from './contract.js';

/** Stream every manifest part as one attachment response.
 *
 * The head part streams straight through and its last chunk is withheld until
 * its hash verifies, so even a final-byte mismatch cannot look like a completed
 * Content-Length. Parts behind the head are drained into memory concurrently --
 * that concurrency is the whole point -- and are emitted in order once they
 * reach the head. Peak memory is bounded by the prefetch window, not by APK
 * size, so a much larger APK only grows the part count. */
export async function apkResponse(request, progress = () => {}, fetcher = fetch) {
    const url = new URL(request.url);
    const match = /^\/download\/([1-9][0-9]*)\/studev-[A-Za-z0-9._-]+\.apk$/.exec(url.pathname);
    if (!match) return new Response(null, { status: 404 });
    const manifest = await readManifest(new URL(`/download/${match[1]}/manifest.json`, url).href, fetcher);
    if (apkPath(manifest) !== url.pathname) return new Response(null, { status: 404 });

    const abort = new AbortController();
    const wholeHash = sha256.create();
    const slots = [];
    let nextIndex = 0;
    let sent = 0;
    let lastNotice = 0;

    const notify = state => {
        if (state === 'downloading' && Date.now() - lastNotice < 150) return;
        lastNotice = Date.now();
        progress({ type: 'APK_DOWNLOAD', path: url.pathname, state, done: sent, total: manifest.size });
    };

    function start() {
        if (nextIndex >= manifest.parts.length) return;
        const part = manifest.parts[nextIndex++];
        const slot = { part, hash: sha256.create(), offset: 0, reader: null, chunks: [], tail: undefined, buffered: false, failure: null, drain: null };
        slot.ready = fetcher(part.url, { cache: 'no-store', redirect: 'error', signal: abort.signal })
            .then(response => {
                if (!response.ok || !response.body) throw new Error(`分片读取失败：${part.name}`);
                slot.reader = response.body.getReader();
            });
        slots.push(slot);
    }

    /** Drain a slot that sits behind the head. Running these concurrently is what
     * turns four throttled connections into one fast download. */
    async function drain(slot) {
        await slot.ready;
        const reader = slot.reader;
        try {
            for (;;) {
                const result = await reader.read();
                if (result.done) break;
                slot.offset += result.value.length;
                if (slot.offset > slot.part.size) throw new Error('分片大小不符');
                slot.hash.update(result.value);
                slot.chunks.push(result.value);
            }
        } finally {
            reader.releaseLock();
            slot.reader = null;
        }
        if (slot.offset !== slot.part.size || bytesToHex(slot.hash.digest()) !== slot.part.sha256) {
            throw new Error(`分片校验失败：${slot.part.name}`);
        }
        slot.buffered = true;
    }

    function fillWindow() {
        while (slots.length < CONCURRENCY && nextIndex < manifest.parts.length) start();
        for (let index = 1; index < slots.length; index += 1) {
            const slot = slots[index];
            if (!slot.drain) slot.drain = drain(slot).catch(error => { slot.failure = error; });
        }
    }

    function cleanup() {
        abort.abort();
        for (const slot of slots) {
            try { slot.hash.destroy(); } catch { /* already digested */ }
            void slot.reader?.cancel().catch(() => {});
        }
        try { wholeHash.destroy(); } catch { /* already digested */ }
    }

    const body = new ReadableStream({
        async pull(controller) {
            const emit = chunk => {
                wholeHash.update(chunk);
                sent += chunk.length;
                controller.enqueue(chunk);
                notify('downloading');
            };
            try {
                for (;;) {
                    if (abort.signal.aborted) return;
                    fillWindow();
                    const head = slots[0];
                    if (!head) {
                        if (bytesToHex(wholeHash.digest()) !== manifest.sha256) throw new Error('APK 校验失败');
                        controller.close();
                        notify('complete');
                        return;
                    }
                    // A part drained in the background must finish before it can be
                    // read here, otherwise two readers would race on one stream.
                    if (head.drain) await head.drain;
                    if (head.failure) throw head.failure;
                    await head.ready;

                    if (head.buffered) {
                        const chunk = head.chunks.shift();
                        if (chunk) { emit(chunk); return; }
                        slots.shift();
                        continue;
                    }

                    const result = await head.reader.read();
                    if (!result.done) {
                        head.offset += result.value.length;
                        if (head.offset > head.part.size) throw new Error('分片大小不符');
                        head.hash.update(result.value);
                        const previous = head.tail;
                        head.tail = result.value;
                        if (previous) { emit(previous); return; }
                        continue;
                    }

                    head.reader.releaseLock();
                    head.reader = null;
                    if (head.offset !== head.part.size || bytesToHex(head.hash.digest()) !== head.part.sha256) {
                        throw new Error(`分片校验失败：${head.part.name}`);
                    }
                    const tail = head.tail;
                    head.tail = undefined;
                    slots.shift();
                    if (tail) { emit(tail); return; }
                }
            } catch (error) {
                cleanup();
                controller.error(error);
                notify('error');
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
