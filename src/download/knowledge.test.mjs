import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from './knowledge.mjs';

const env = {
    OSCA_DOWNLOAD_ENDPOINT: 'https://storage.example.test',
    OSCA_DOWNLOAD_BUCKET: 'studev-download',
    OSCA_DOWNLOAD_ACCESS_KEY: 'test-access',
    OSCA_DOWNLOAD_SECRET_KEY: 'test-secret',
};

const req = (path) => new Request(`https://studev.hicancan.top${path}`);

test('redirects knowledge media requests to presigned object-storage URL', async () => {
    const res = await onRequest({
        request: req('/data/map-v0.9.1__20261115-1916__k20261115-2307__p10/knowledge/materials/%E5%A4%A7%E5%AD%A6%E7%89%A9%E7%90%86/%E8%AF%BE%E4%BB%B6.assets/%E7%AC%AC10%E9%A1%B5.webp'),
        env,
    });
    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.ok(location?.startsWith('https://storage.example.test/studev-download/knowledge/20261115-2307/materials/%E5%A4%A7%E5%AD%A6%E7%89%A9%E7%90%86/%E8%AF%BE%E4%BB%B6.assets/%E7%AC%AC10%E9%A1%B5.webp?'));
    assert.match(location, /X-Amz-Signature=/);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
});

test('rejects non-media files, traversal and invalid paths with 404', async () => {
    for (const bad of [
        '/data/map-v0.9.1__20261115-1916__k20261115-2307__p10/knowledge/topics/foo.md',
        '/data/map-v0.9.1__20261115-1916__k20261115-2307__p10/knowledge/materials/%2e%2e/secret.webp',
        '/data/map-v0.9.1__20261115-1916__k20261115-2307__p10/knowledge/materials/..%2fsecret.webp',
        '/data/no-knowledge-tag/knowledge/materials/a.webp',
        '/other/path/a.webp',
    ]) {
        const res = await onRequest({ request: req(bad), env });
        assert.equal(res.status, 404, bad);
    }
});

test('returns 503 when object storage is unconfigured', async () => {
    const res = await onRequest({
        request: req('/data/map-v0.9.1__20261115-1916__k20261115-2307__p10/knowledge/materials/a.webp'),
        env: {},
    });
    assert.equal(res.status, 503);
});
