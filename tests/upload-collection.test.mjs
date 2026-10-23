import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionHandler, collectionConfig } from '../src/server/collection-app.mjs';
import { hashPassword, verifyPassword } from '../src/server/collection-auth.mjs';
import { oscaGateway } from '../src/server/collection-adapters.mjs';

const ORIGIN = 'https://studev.example.test';
const PASSWORD = 'test-admin-password-12345';
const INVITE = 'test-invite-code-12345';
const adminHash = await hashPassword(PASSWORD, 'a'.repeat(32));
const inviteHash = await hashPassword(INVITE, 'b'.repeat(32));

function memoryStore() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.has(key) ? structuredClone(values.get(key)) : null; },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && values.has(key)) throw Object.assign(new Error('already exists'), { status: 409 });
      values.set(key, structuredClone(value));
    },
    async list({ prefix = '' } = {}) { return { blobs: [...values.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })) }; },
    async delete(key) { values.delete(key); },
  };
}

function fixture(overrides = {}) {
  let clock = Date.UTC(2026, 9, 21, 15);
  const store = memoryStore();
  const records = new Map();
  const objects = new Map();
  const copies = [];
  const deleted = [];
  const downloads = [];
  const env = {
    COLLECTION_ENABLED: 'true', COLLECTION_ORIGIN: ORIGIN,
    COLLECTION_SESSION_SECRET: 'synthetic-test-secret-'.repeat(3),
    COLLECTION_ADMIN_HASH: adminHash, COLLECTION_INVITE_HASH: inviteHash,
    COLLECTION_MAX_SUBMISSIONS: '5', OSCA_ENDPOINT: 'https://s3.example.test',
    OSCA_BUCKET: 'test-bucket', OSCA_ACCESS_KEY_ID: 'synthetic-access-key',
    OSCA_SECRET_ACCESS_KEY: 'synthetic-secret-key', OSCA_PREFIX: 'studev-submissions/',
    ...overrides,
  };
  const gateway = {
      async presignUpload(record, ttl) {
        records.set(record.id, structuredClone(record));
        return { url: `https://s3.example.test/put/${record.id}`, method: 'PUT', headers: { 'Content-Type': record.contentType }, expiresAt: clock + ttl * 1000 };
      },
      async head(key) { return objects.get(key) || null; },
      async copy(sourceKey, finalKey, etag) {
        copies.push({ sourceKey, finalKey, etag });
        // Real OSCA ignores CopySourceIfMatch; final HEAD validation must detect changed copies.
        const source = objects.get(sourceKey);
        if (!source) throw new Error('No source object');
        objects.set(finalKey, structuredClone(source));
      },
      async delete(key) { deleted.push(key); objects.delete(key); },
      async presignDownload(record, etag, ttl) {
        downloads.push(structuredClone(record));
        return { url: `https://s3.example.test/get/${record.finalObjectKey}`, method: 'GET', headers: { 'If-Match': etag }, fileName: record.fileName, expiresAt: clock + ttl * 1000 };
      },
    };
  const handler = createCollectionHandler({
    getStore: () => store,
    getGateway: () => gateway,
    now: () => clock,
  });
  return {
    store, records, objects, env, gateway, copies, deleted, downloads,
    advance(ms) { clock += ms; },
    async request(path, { method = 'GET', body, cookie, csrf, origin = ORIGIN, clientIp = '192.0.2.1', headers = {}, adaptRequest } = {}) {
      const inputHeaders = { ...headers };
      if (method !== 'GET') inputHeaders.origin = origin;
      if (body !== undefined) inputHeaders['content-type'] = 'application/json';
      if (cookie) inputHeaders.cookie = cookie;
      if (csrf) inputHeaders['x-csrf-token'] = csrf;
      const request = new Request(`${ORIGIN}/api/collection${path}`, { method, headers: inputHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (adaptRequest) adaptRequest(request);
      return handler({ env, clientIp, request });
    },
  };
}

function submissionBody(extra = {}) {
  return { inviteCode: INVITE, name: '测试社团', contact: '社团测试联络方式', description: '仅供自动化测试', file: { name: '策划书.txt', size: 1024, type: 'text/plain' }, ...extra };
}

async function createSubmission(f, body = submissionBody()) {
  const res = await f.request('/submissions', { method: 'POST', body });
  assert.equal(res.status, 201);
  return res.json();
}

async function completeSubmission(f, created) {
  const record = f.records.get(created.item.id);
  f.objects.set(record.objectKey, { size: record.fileSize, contentType: record.contentType, etag: '"test-etag"' });
  const res = await f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: created.receiptToken } });
  assert.equal(res.status, 200);
  return res.json();
}

async function login(f) {
  const res = await f.request('/admin/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(res.headers.get('set-cookie'), /; Secure$/);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await res.json();
  return { cookie, csrf: csrfToken };
}

test('passwords are verified against salted scrypt hashes, not plaintext configuration', async () => {
  assert.equal(await verifyPassword(PASSWORD, adminHash), true);
  assert.equal(await verifyPassword('incorrect', adminHash), false);
  assert.equal(await verifyPassword(PASSWORD, PASSWORD), false);
});

test('closed/missing configuration fails before opening any store or gateway', async () => {
  const handler = createCollectionHandler({ getStore() { assert.fail('store must not open'); }, getGateway() { assert.fail('gateway must not open'); } });
  const res = await handler({ request: new Request(`${ORIGIN}/api/collection/config`), env: {} });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'NOT_OPEN');
  const f = fixture({ OSCA_SECRET_ACCESS_KEY: '' });
  assert.equal((await f.request('/config')).status, 503);
});

test('public configuration exposes limits but never storage or authentication secrets', async () => {
  const f = fixture();
  const res = await f.request('/config');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /maxFileBytes/);
  for (const secret of [PASSWORD, INVITE, adminHash, f.env.OSCA_SECRET_ACCESS_KEY, f.env.COLLECTION_SESSION_SECRET]) assert.ok(!body.includes(secret));
  assert.equal(res.headers.get('cache-control'), 'no-store, private');
});

test('cross-site mutation, bad invitation, unsupported extension and false file sizes are rejected', async () => {
  const f = fixture();
  assert.equal((await f.request('/submissions', { method: 'POST', body: submissionBody(), origin: 'https://attacker.example' })).status, 403);
  assert.equal((await f.request('/submissions', { method: 'POST', body: submissionBody({ inviteCode: 'incorrect' }) })).status, 403);
  assert.equal((await f.request('/submissions', { method: 'POST', body: submissionBody({ file: { name: 'page.html', size: 1, type: 'text/html' } }) })).status, 400);
  assert.equal((await f.request('/submissions', { method: 'POST', body: submissionBody({ file: { name: '../a.txt', size: 1, type: 'text/plain' } }) })).status, 400);
  assert.equal((await f.request('/submissions', { method: 'POST', body: submissionBody({ file: { name: 'a.txt', size: -1, type: 'text/plain' } }) })).status, 400);
  assert.equal(f.records.size, 0);
});

test('visitor cannot enumerate submissions; complete requires private receipt and matching real object', async () => {
  const f = fixture();
  const created = await createSubmission(f);
  const record = f.records.get(created.item.id);
  assert.ok(record.objectKey.startsWith('studev-submissions/club-2026/'));
  assert.ok(!JSON.stringify(created).includes(record.receiptHash));
  assert.ok(!JSON.stringify(created.item).includes('objectKey'));
  assert.equal((await f.request('/admin/submissions')).status, 401);
  assert.equal((await f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: 'wrong' } })).status, 403);
  assert.equal((await f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: created.receiptToken } })).status, 409);
  f.objects.set(record.objectKey, { size: record.fileSize + 1, contentType: record.contentType, etag: '"etag"' });
  assert.equal((await f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: created.receiptToken } })).status, 409);
  f.objects.set(record.objectKey, { size: record.fileSize, contentType: record.contentType, etag: 'W/"weak-etag"' });
  assert.equal((await f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: created.receiptToken } })).status, 409);
  const result = await completeSubmission(f, created);
  assert.equal(result.item.status, 'pending_review');
  const repeated = await f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: created.receiptToken } });
  assert.equal(repeated.status, 200);
  assert.equal([...f.store.values.keys()].filter((key) => key.includes('/completed/')).length, 1);
  assert.equal(f.copies.length, 1);
  const completion = [...f.store.values].find(([key]) => key.includes('/completed/'))[1];
  assert.notEqual(completion.finalObjectKey, record.objectKey);
  assert.ok(completion.finalObjectKey.startsWith(`studev-submissions/club-2026/final/${record.id}/`));
});

test('concurrent submissions cannot exceed an atomic one-slot collection reservation', async () => {
  const f = fixture({ COLLECTION_MAX_SUBMISSIONS: '1' });
  const res = await Promise.all([f.request('/submissions', { method: 'POST', body: submissionBody() }), f.request('/submissions', { method: 'POST', body: submissionBody() })]);
  assert.deepEqual(res.map((r) => r.status).sort(), [201, 409]);
  assert.equal(f.records.size, 1);
});

test('abandoned upload authorizations count against the lifetime collection cap', async () => {
  const f = fixture({ COLLECTION_MAX_SUBMISSIONS: '1' });
  await createSubmission(f);
  f.advance(24 * 3600_000);
  const response = await f.request('/submissions', { method: 'POST', body: submissionBody() });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'COLLECTION_FULL');
});

test('admin login is rate limited across handler instances using shared store tickets', async () => {
  const f = fixture();
  for (let index = 0; index < 5; index++) assert.equal((await f.request('/admin/login', { method: 'POST', body: { password: 'bad' } })).status, 401);
  const blocked = await f.request('/admin/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(blocked.status, 429);
  f.advance(61_000);
  assert.equal((await f.request('/admin/login', { method: 'POST', body: { password: PASSWORD } })).status, 200);
});

test('admin review requires session and CSRF; immutable revisions reject concurrent stale edits', async () => {
  const f = fixture();
  const created = await createSubmission(f);
  await completeSubmission(f, created);
  const auth = await login(f);
  const path = `/admin/submissions/${created.item.id}/review`;
  assert.equal((await f.request(path, { method: 'POST', body: { status: 'accepted', revision: 0 }, cookie: auth.cookie })).status, 403);
  const mutations = await Promise.all([
    f.request(path, { method: 'POST', body: { status: 'accepted', revision: 0 }, ...auth }),
    f.request(path, { method: 'POST', body: { status: 'rejected', revision: 0 }, ...auth }),
  ]);
  assert.deepEqual(mutations.map((r) => r.status).sort(), [200, 409]);
  const list = await (await f.request('/admin/submissions', auth)).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].revision, 1);
  assert.ok(['accepted', 'rejected'].includes(list.items[0].status));
  assert.ok(!JSON.stringify(list).includes('receiptHash'));
});

test('replaying staging upload cannot alter the final download; final mutations fail closed', async () => {
  const f = fixture();
  const created = await createSubmission(f);
  const auth = await login(f);
  const path = `/admin/submissions/${created.item.id}/download`;
  assert.equal((await f.request(path, { method: 'POST', body: {}, ...auth })).status, 409);
  await completeSubmission(f, created);
  const download = await (await f.request(path, { method: 'POST', body: {}, ...auth })).json();
  assert.equal(download.download.headers['If-Match'], '"test-etag"');
  const record = f.records.get(created.item.id);
  const finalKey = f.downloads[0].finalObjectKey;
  assert.notEqual(finalKey, record.objectKey);
  assert.ok(download.download.url.endsWith(finalKey));
  f.objects.set(record.objectKey, { size: record.fileSize, contentType: record.contentType, etag: '"modified"' });
  assert.equal((await f.request(path, { method: 'POST', body: {}, ...auth })).status, 200);
  f.objects.set(finalKey, { size: record.fileSize, contentType: record.contentType, etag: '"modified"' });
  const changed = await f.request(path, { method: 'POST', body: {}, ...auth });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, 'OBJECT_CHANGED');
});

test('concurrent completion retains only the winner and deletes its own losing copy', async () => {
  const f = fixture();
  const created = await createSubmission(f);
  const record = f.records.get(created.item.id);
  f.objects.set(record.objectKey, { size: record.fileSize, contentType: record.contentType, etag: '"original"' });
  const attempts = await Promise.all([0, 1].map(() => f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: created.receiptToken } })));
  assert.deepEqual(attempts.map((result) => result.status), [200, 200]);
  assert.equal(f.copies.length, 2);
  assert.notEqual(f.copies[0].finalKey, f.copies[1].finalKey);
  const completion = [...f.store.values].find(([key]) => key.includes('/completed/'))[1];
  assert.equal(f.deleted.length, 1);
  assert.notEqual(f.deleted[0], completion.finalObjectKey);
  assert.ok(f.objects.has(completion.finalObjectKey));
  const auth = await login(f);
  assert.equal((await f.request(`/admin/submissions/${record.id}/download`, { method: 'POST', body: {}, ...auth })).status, 200);
  assert.equal(f.downloads[0].finalObjectKey, completion.finalObjectKey);
});

test('OSCA ignoring a source precondition cannot publish a changed final copy', async () => {
  for (const change of [{ etag: '"changed"' }, { size: 999 }, { contentType: 'application/octet-stream' }]) {
    const f = fixture();
    const created = await createSubmission(f);
    const record = f.records.get(created.item.id);
    f.objects.set(record.objectKey, { size: record.fileSize, contentType: record.contentType, etag: '"original"' });
    const copy = f.gateway.copy;
    f.gateway.copy = async (...args) => {
      f.objects.set(record.objectKey, { ...f.objects.get(record.objectKey), ...change });
      await copy(...args);
    };
    const result = await f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: created.receiptToken } });
    assert.equal(result.status, 409);
    assert.equal((await result.json()).error.code, 'UPLOAD_CHANGED');
    assert.equal([...f.store.values.keys()].filter((key) => key.includes('/completed/')).length, 0);
    assert.equal(f.deleted.length, 1);
    assert.equal(f.objects.has(f.copies[0].finalKey), false);
    assert.equal(f.objects.has(record.objectKey), true);
  }
});

test('ambiguous metadata write responses preserve the accepted final object for safe retry', async () => {
  const f = fixture();
  const created = await createSubmission(f);
  const record = f.records.get(created.item.id);
  f.objects.set(record.objectKey, { size: record.fileSize, contentType: record.contentType, etag: '"original"' });
  const setJSON = f.store.setJSON;
  f.store.setJSON = async (...args) => {
    await setJSON(...args);
    if (args[0].includes('/completed/')) throw new Error('synthetic response loss after successful write');
  };
  const path = `/submissions/${record.id}/complete`;
  assert.equal((await f.request(path, { method: 'POST', body: { receiptToken: created.receiptToken } })).status, 503);
  const completion = [...f.store.values].find(([key]) => key.includes('/completed/'))[1];
  assert.ok(f.objects.has(completion.finalObjectKey));
  assert.equal(f.deleted.length, 0);
  assert.equal((await f.request(path, { method: 'POST', body: { receiptToken: created.receiptToken } })).status, 200);
  assert.equal(f.copies.length, 1);
  const auth = await login(f);
  assert.equal((await f.request(`/admin/submissions/${record.id}/download`, { method: 'POST', body: {}, ...auth })).status, 200);
});

test('a retried conditional metadata write does not delete its own already-published copy', async () => {
  const f = fixture();
  const created = await createSubmission(f);
  const record = f.records.get(created.item.id);
  f.objects.set(record.objectKey, { size: record.fileSize, contentType: record.contentType, etag: '"original"' });
  const setJSON = f.store.setJSON;
  f.store.setJSON = async (...args) => {
    await setJSON(...args);
    // A transport retry can receive 412 after the same candidate's first write actually succeeded.
    if (args[0].includes('/completed/')) throw Object.assign(new Error('conditional write failed (key already exists)'), { code: 'PRECONDITION_FAILED' });
  };
  const result = await f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: created.receiptToken } });
  assert.equal(result.status, 200);
  const completion = [...f.store.values].find(([key]) => key.includes('/completed/'))[1];
  assert.ok(f.objects.has(completion.finalObjectKey));
  assert.equal(f.deleted.length, 0);
});

test('legacy completion rows never expose mutable staging objects', async () => {
  const f = fixture();
  const created = await createSubmission(f);
  const record = f.records.get(created.item.id);
  f.objects.set(record.objectKey, { size: record.fileSize, contentType: record.contentType, etag: '"original"' });
  await f.store.setJSON(`collections/club-2026/completed/${record.id}.json`, { etag: '"original"', size: record.fileSize });
  const auth = await login(f);
  const result = await f.request(`/admin/submissions/${record.id}/download`, { method: 'POST', body: {}, ...auth });
  assert.equal(result.status, 409);
  assert.equal(f.downloads.length, 0);
});

test('unexpected storage failures log only bounded name, code and status without secrets', async () => {
  const f = fixture();
  const created = await createSubmission(f);
  const record = f.records.get(created.item.id);
  const captured = [];
  const originalError = console.error;
  try {
    console.error = (...args) => captured.push(args);
    for (const code of ['CREDENTIAL_ERROR', 'invalid/code?secret']) {
      f.gateway.head = async () => { throw Object.assign(new Error('synthetic-secret-signed-url'), { code, statusCode: 503 }); };
      const result = await f.request(`/submissions/${record.id}/complete`, { method: 'POST', body: { receiptToken: created.receiptToken } });
      assert.equal(result.status, 503);
      assert.ok(!(await result.text()).includes('synthetic-secret'));
    }
  } finally { console.error = originalError; }
  assert.deepEqual(captured, [
    ['collection-service-error', { name: 'Error', code: 'CREDENTIAL_ERROR', status: 503 }],
    ['collection-service-error', { name: 'Error', code: 'UNKNOWN', status: 503 }],
  ]);
  assert.ok(!JSON.stringify(captured).includes('synthetic-secret'));
});

test('logout revokes server-side session and signed cookie expires', async () => {
  const f = fixture();
  const auth = await login(f);
  assert.equal((await f.request('/admin/session', auth)).status, 200);
  assert.equal((await f.request('/admin/logout', { method: 'POST', body: {}, ...auth })).status, 200);
  assert.equal((await f.request('/admin/session', auth)).status, 401);
  const second = await login(f);
  f.advance(7200_001);
  assert.equal((await f.request('/admin/session', second)).status, 401);
});

test('bounded bodies and malformed cursors are rejected safely', async () => {
  const f = fixture();
  const tooBig = await f.request('/submissions', { method: 'POST', body: { padding: 'a'.repeat(17_000) } });
  assert.equal(tooBig.status, 413);
  const auth = await login(f);
  assert.equal((await f.request('/admin/submissions?cursor=../secret', auth)).status, 400);
});

test('official platform parsed Request.body is bypassed in favor of bounded original bytes', async () => {
  for (const preloadMode of ['buffer', 'uint8array', 'none', 'untrusted-object']) {
    const f = fixture();
    const result = await f.request('/admin/login', {
      method: 'POST', body: { password: 'wrong-password' },
      adaptRequest(request) {
        if (preloadMode === 'buffer') request._rawBodyBuffer = Buffer.from(JSON.stringify({ password: 'wrong-password' }));
        if (preloadMode === 'uint8array') request._rawBodyBuffer = new Uint8Array(Buffer.from(JSON.stringify({ password: 'wrong-password' })));
        if (preloadMode === 'untrusted-object') request._rawBodyBuffer = { password: PASSWORD };
        Object.defineProperty(request, 'body', { get: () => ({ password: PASSWORD }), configurable: true });
      },
    });
    // A forged/pre-parsed password must never replace the actual raw JSON password.
    assert.equal(result.status, 401, preloadMode);
    assert.equal((await result.json()).error.code, 'LOGIN_FAILED');
  }
});

test('platform preloaded bytes still enforce the JSON byte limit and parse validity', async () => {
  for (const preloaded of [Buffer.alloc(16 * 1024 + 1, 32), new Uint8Array(16 * 1024 + 1)]) {
    const f = fixture();
    const result = await f.request('/admin/login', { method: 'POST', body: { password: PASSWORD }, adaptRequest(request) {
      request._rawBodyBuffer = preloaded;
      Object.defineProperty(request, 'body', { get: () => ({ password: PASSWORD }), configurable: true });
    } });
    assert.equal(result.status, 413);
    assert.equal((await result.json()).error.code, 'BODY_TOO_LARGE');
  }
  const f = fixture();
  const invalid = await f.request('/admin/login', { method: 'POST', body: { password: PASSWORD }, adaptRequest(request) {
    request._rawBodyBuffer = Buffer.from('{invalid-json');
    Object.defineProperty(request, 'body', { get: () => ({ password: PASSWORD }), configurable: true });
  } });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
});

test('S3 presign binds content length/type and safe attachment GET conditions', async () => {
  const config = collectionConfig(fixture().env);
  const gateway = oscaGateway(config);
  const record = { objectKey: 'studev-submissions/club-2026/staging/random.txt', finalObjectKey: 'studev-submissions/club-2026/final/random/unique', fileName: '社团资料.txt', contentType: 'text/plain', fileSize: 1024 };
  const upload = await gateway.presignUpload(record, 60);
  const putUrl = new URL(upload.url);
  assert.equal(putUrl.pathname, '/test-bucket/studev-submissions/club-2026/staging/random.txt');
  assert.equal(putUrl.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
  assert.ok(!upload.url.includes(config.secretAccessKey));
  const download = await gateway.presignDownload(record, '"etag"', 60);
  const getUrl = new URL(download.url);
  assert.equal(getUrl.pathname, `/test-bucket/${record.finalObjectKey}`);
  assert.equal(getUrl.searchParams.get('X-Amz-SignedHeaders'), 'host;if-match');
  assert.match(getUrl.searchParams.get('response-content-disposition'), /^attachment;/);
  assert.equal(getUrl.searchParams.get('response-content-type'), 'application/octet-stream');
  assert.equal(download.headers['If-Match'], '"etag"');
});
