import assert from 'node:assert/strict';
import test from 'node:test';
import { publicRelease, verifyArchive } from '../../../scripts/release/check-public.mjs';
import { listDownloadObjects } from '../../../scripts/release/objects.mjs';
import { archivedAssets, feedObjects, planRetention } from '../../../scripts/release/prune.mjs';

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

test('object inventory follows pagination and decodes object names', async () => {
    const heard = [];
    const objects = await listDownloadObjects({}, async (_store, method, key, { query }) => {
        assert.equal(method, 'GET');
        assert.equal(key, '');
        const cursor = query.get('continuation-token');
        heard.push(cursor);
        return new Response(cursor
            ? '<ListBucketResult><Contents><Key>windows%2Ff%20b.zip</Key><Size>192</Size><ETag>&quot;xyz&quot;</ETag></Contents></ListBucketResult>'
            : '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>a&amp;b</NextContinuationToken></ListBucketResult>');
    });
    assert.deepEqual(heard, [null, 'a&b']);
    assert.deepEqual(objects, [{ key: 'windows/f b.zip', size: 192, etag: '"xyz"' }]);
});

const object = (key, size = 20, etag = '"00000000000000000000000000000000"') => ({ key, size, etag });
const packageId = 'top.hicancan.studev';
const update = (Version, Type = 'Full') => ({ PackageId: packageId, Version, Type, FileName: packageId + '-' + Version + '-' + Type.toLowerCase() + '.nupkg', Size: 20 });
const asset = (version, name, size = 20) => ({
    name, state: 'uploaded', size,
    browser_download_url: 'https://github.com/' + product.repository + '/releases/download/v' + version + '/' + name,
});

test('cleanup waits for the full-only live feed and rejects invalid feed keys', () => {
    const current = update('4.1.1');
    assert.deepEqual(feedObjects({ Assets: [current] }, '4.1.1', true), [{ key: 'windows/' + current.FileName, size: 20 }]);
    assert.throws(() => feedObjects({ Assets: [current, update('4.1.0')] }, '4.1.1', true), /latest-only/);
    assert.throws(() => feedObjects({ Assets: [update('4.1.0')] }, '4.1.1', true), /live version/);
    assert.throws(() => feedObjects({ Assets: [{ ...current, FileName: '../4.1.1.nupkg' }] }, '4.1.1', true), /Unexpected/);
});

test('cleanup selects only verified archives and preserves newer, unknown and missing copies', async () => {
    const old = '3.9.0', current = '3.10.0';
    const apkOld = object('studev-3.9.0.apk'), zipOld = object('windows/studev-3.9.0-windows.zip');
    const generated = object('windows/' + update(old).FileName);
    const legacy = object('windows/' + packageId + '-win-Portable.zip');
    const currentFull = object('windows/' + update(current).FileName);
    const currentDelta = object('windows/' + update(current, 'Delta').FileName);
    const future = object('studev-3.11.0.apk');
    const unknown = object('private-other');
    const changed = object('studev-3.8.0.apk', 30);
    const unavailable = object('studev-3.7.0.apk');
    const falseArchive = object('studev-3.6.0.apk');
    const objects = [apkOld, zipOld, generated, legacy, currentFull, currentDelta, future, unknown, changed, unavailable, falseArchive];
    const archive = (version, files, draft = false) => ({ tag_name: 'v' + version, assets: files, draft });
    const archives = archivedAssets([
        archive('3.9.0', [asset(old, 'studev-3.9.0.apk'), asset(old, 'studev-3.9.0-windows.zip')]),
        archive(current, [asset(current, 'studev-3.10.0-windows.zip')]),
        archive('3.8.0', [asset('3.8.0', 'studev-3.8.0.apk')]),
        archive('3.7.0', [asset('3.7.0', 'studev-3.7.0.apk')]),
        archive('3.6.0', [asset('3.6.0', 'studev-3.6.0.apk')], true),
        archive('3.11.0', [asset('3.11.0', 'studev-3.11.0.apk')]),
    ], product.repository);
    const verified = [];
    const plan = await planRetention(objects, current, [currentFull], archives, async (url, size) => {
        verified.push(url);
        assert.equal(size, 20);
        if (url.endsWith('/studev-3.7.0.apk')) throw new Error('404');
    });
    assert.deepEqual(plan.removing, [apkOld, zipOld, generated, legacy, currentDelta]);
    assert.deepEqual(plan.retained, [future, unknown, changed, falseArchive, unavailable]);
    assert.equal(verified.filter(url => url.endsWith('studev-3.9.0-windows.zip')).length, 1);
    await verifyArchive('https://downloads.test/app.exe', 4, () => new Response(new Uint8Array([0x4d, 0x5a, 0, 0]), { headers: { 'Content-Length': '4' } }));
});
