import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { downloadApk, readApkManifest } from './apk-download';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function server(parts: Uint8Array[]) {
    const manifest = { format: 1, versionName: '1.0.1', versionCode: 2, minSdk: 26, size: parts.reduce((n, p) => n + p.length, 0), sha256: hash(Buffer.concat(parts.map(p => Buffer.from(p)))), releaseNotes: '', parts: parts.map((bytes, i) => ({ name: `part-${String(i).padStart(3, '0')}`, size: bytes.length, sha256: hash(bytes), url: `/download/2/part-${String(i).padStart(3, '0')}` })) };
    const fetcher = async (input: RequestInfo | URL) => {
        const path = new URL(String(input), 'http://localhost').pathname;
        if (path === '/download/latest.json') return new Response(JSON.stringify({ format: 1, versionCode: 2, manifestUrl: '/download/2/manifest.json' }));
        if (path === '/download/2/manifest.json') return new Response(JSON.stringify(manifest));
        const index = Number(path.match(/part-(\d+)/)?.[1]);
        return new Response(parts[index] as unknown as BodyInit);
    };
    return { manifest, fetcher };
}

async function localServer(parts: Uint8Array[], run: (base: string, manifest: ReturnType<typeof server>['manifest']) => Promise<void>) {
    const { manifest } = server(parts);
    const http = createServer((request, response) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (path === '/download/latest.json') return response.end(JSON.stringify({ format: 1, versionCode: 2, manifestUrl: '/download/2/manifest.json' }));
        if (path === '/download/2/manifest.json') return response.end(JSON.stringify(manifest));
        const index = Number(path.match(/part-(\d+)/)?.[1]);
        const bytes = parts[index];
        if (!bytes) { response.statusCode = 404; return response.end(); }
        response.setHeader('Content-Length', bytes.length); response.end(Buffer.from(bytes));
    });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    try { await run(base, manifest); } finally { await new Promise<void>(resolve => http.close(() => resolve())); }
}

describe('APK downloader', () => {
    it('follows latest → manifest and downloads one part', async () => {
        await localServer([Uint8Array.from([1, 2, 3])], async (base, manifest) => {
            const read = await readApkManifest(`${base}/download/latest.json`);
            const blob = await downloadApk(read, base);
            expect(read.versionCode).toBe(manifest.versionCode); expect(read.parts[0]!.url).toBe(`${base}/download/2/part-000`); expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
        });
    });
    it('downloads and verifies three parts', async () => {
        await localServer([Uint8Array.from([1, 2]), Uint8Array.from([3, 4]), Uint8Array.from([5, 6])], async (base, manifest) => {
            const progress: number[] = []; const blob = await downloadApk({ ...manifest, parts: manifest.parts.map(part => ({ ...part, url: `${base}${part.url}` })) }, base, (done, total) => progress.push(done / total));
            expect(progress).toEqual([2 / 6, 4 / 6, 1]); expect(blob.size).toBe(6);
        });
    });
    it('rejects a corrupted part', async () => {
        const { manifest } = server([Uint8Array.from([1, 2]), Uint8Array.from([3, 4]), Uint8Array.from([5, 6])]);
        const fetcher = async (input: RequestInfo | URL) => {
            const path = new URL(String(input), 'http://localhost').pathname;
            if (path.includes('part-001')) return new Response(Uint8Array.from([9, 9]) as unknown as BodyInit);
            return new Response(Uint8Array.from([1, 2]) as unknown as BodyInit);
        };
        await expect(downloadApk(manifest, 'http://localhost', undefined, fetcher as typeof fetch)).rejects.toThrow('校验失败');
    });
});
