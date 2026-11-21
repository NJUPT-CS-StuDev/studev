import assert from 'node:assert/strict';
import test from 'node:test';
import { publicRelease, verifyArchive } from '../../../scripts/release/check-public.mjs';

const product = { repository: 'example/studev', downloadOrigin: 'https://downloads.test', android: { versionName: '1.2.3' } };
const apk = { name: 'studev-1.2.3.apk', state: 'uploaded', size: 100 };
const windows = { name: 'studev-1.2.3-windows.zip', state: 'uploaded', size: 200 };

test('a pushed version with no public release leaves the website on the current release', async () => {
    const unexpected = () => assert.fail('unpublished releases must not probe downloads');
    assert.equal(await publicRelease(product, async () => new Response(null, { status: 404 }), unexpected), false);
    assert.equal(await publicRelease(product, async () => Response.json({ draft: true }), unexpected), false);
});

test('publishing requires both uploaded assets and both reachable public objects', async () => {
    const found = async (assets) => Response.json({ assets });
    const checked = [];
    const verify = async (url, size) => { checked.push([url, size]); };
    await assert.rejects(publicRelease(product, () => found([apk]), verify), /missing studev-1.2.3-windows.zip/);
    await assert.rejects(publicRelease(product, () => found([apk, windows]), async (url) => {
        if (url.endsWith('windows.zip')) throw new Error('HTTP 404');
    }), /404/);
    checked.length = 0;
    assert.equal(await publicRelease(product, () => found([apk, windows]), verify), true);
    assert.deepEqual(checked, [
        ['https://downloads.test/studev-1.2.3.apk', 100],
        ['https://downloads.test/windows/studev-1.2.3-windows.zip', 200],
    ]);
});

test('the distribution probe checks the byte count and archive signature', async () => {
    const url = 'https://downloads.test/app.apk';
    const prefix = new Uint8Array([0x50, 0x4b, 3, 4]);
    const partial = (body, size) => new Response(body, { status: 206, headers: { 'Content-Range': `bytes 0-3/${size}` } });
    await verifyArchive(url, 100, async (_, request) => {
        assert.equal(request.headers.Range, 'bytes=0-3');
        return partial(prefix, 100);
    });
    await verifyArchive(url, 4, async () => new Response(prefix, { headers: { 'Content-Length': '4' } }));
    await assert.rejects(verifyArchive(url, 100, async () => partial(prefix, 99)), /expected 100 public bytes/);
    await assert.rejects(verifyArchive(url, 100, async () => partial('html', 100)), /not an archive/);
});
