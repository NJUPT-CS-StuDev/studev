import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { apkResponse } from '../src/download/stream.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(count, corrupt = -1) {
    const parts = Array.from({ length: count }, (_, i) => Buffer.from([i + 1, i + 2, i + 3]));
    const bytes = Buffer.concat(parts);
    const manifest = { format: 1, versionName: '9.0.0', versionCode: 99, minSdk: 26, size: bytes.length, sha256: hash(bytes), parts: parts.map((part, i) => ({ name: `part-${String(i).padStart(3, '0')}`, size: part.length, sha256: hash(part), url: `part-${String(i).padStart(3, '0')}` })) };
    const fetched = [];
    const fetcher = async (url, options) => {
        const path = new URL(url).pathname;
        fetched.push(path);
        if (path.endsWith('/manifest.json')) return Response.json(manifest);
        const i = Number(path.match(/part-(\d+)/)[1]);
        assert.equal(options.redirect, 'error');
        return new Response(i === corrupt ? Buffer.from([9, 9, 9]) : parts[i]);
    };
    return { bytes, manifest, fetched, fetcher };
}

for (const count of [1, 3]) test(`streams ${count} verified parts as one attachment`, async () => {
    const f = fixture(count);
    const progress = [];
    const response = await apkResponse(new Request('https://example.org/download/99/studev-9.0.0.apk'), p => progress.push(p), f.fetcher);
    assert.equal(response.headers.get('Content-Length'), String(f.bytes.length));
    assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="studev-9.0.0.apk"');
    assert.equal(f.fetched.length, 1, 'parts are fetched only when consumed');
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), f.manifest.sha256);
    assert.equal(f.fetched.length, count + 1);
    assert.equal(progress.at(-1).state, 'complete');
});
test('a corrupted middle part aborts before emitting it or fetching the next part', async () => {
    const f = fixture(3, 1);
    const progress = [];
    const response = await apkResponse(new Request('https://example.org/download/99/studev-9.0.0.apk'), p => progress.push(p), f.fetcher);
    const reader = response.body.getReader();
    assert.deepEqual(Buffer.from((await reader.read()).value), Buffer.from([1, 2, 3]));
    await assert.rejects(reader.read(), /校验失败/);
    assert.equal(f.fetched.length, 3);
    assert.equal(progress.at(-1).state, 'error');
});
test('canceling a download stops fetching subsequent parts', async () => {
    const f = fixture(3);
    const response = await apkResponse(new Request('https://example.org/download/99/studev-9.0.0.apk'), () => {}, f.fetcher);
    const reader = response.body.getReader();
    await reader.read(); await reader.cancel();
    assert.equal(f.fetched.length, 2);
});
test('malformed totals and off-origin parts fail before an attachment is created', async () => {
    for (const change of [f => f.manifest.size++, f => f.manifest.parts[0].url = 'https://other.org/part-000']) {
        const f = fixture(1); change(f);
        await assert.rejects(apkResponse(new Request('https://example.org/download/99/studev-9.0.0.apk'), () => {}, f.fetcher));
        assert.equal(f.fetched.length, 1);
    }
});
