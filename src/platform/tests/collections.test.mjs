import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionsService } from '../server/collections.mjs';
import { createRepository } from '../server/store.mjs';
import { AppError, fail, response } from '../server/common.mjs';

const ORIGIN = 'https://studev.test';

function fixture() {
  let clock = Date.UTC(2026, 10, 22, 12);
  const data = new Map();
  const objects = new Map();
  const users = {
    owner: { id: 'owner-1', role: 'owner', studentId: 'B24040201', realName: '班长甲', nickname: '班长甲' },
    student: { id: 'stu-2', role: 'user', studentId: 'B24040202', realName: '同学乙', nickname: '同学乙' },
  };
  const store = {
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async setJSON(key, value) { data.set(key, structuredClone(value)); },
    async list({ prefix }) { return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
    async delete(key) { data.delete(key); },
  };
  const repo = createRepository(store, { secret: 'synthetic-tests-only-secret-'.repeat(3), now: () => clock });
  const identity = {
    async authenticate(request, { required = false, staff = false, csrf = false } = {}) {
      const u = users[request.headers.get('x-user') || ''];
      if (!u && (required || staff || csrf)) fail(401, 'AUTH_REQUIRED', '登录');
      if (!u) return null;
      if (staff && !['owner', 'admin'].includes(u.role)) fail(403, 'STAFF_REQUIRED', '无权');
      if (csrf && request.headers.get('x-csrf-token') !== 'csrf-ok') fail(403, 'CSRF_REJECTED', 'CSRF');
      return { user: u };
    },
  };
  const getGateway = () => ({
    async presignUpload({ objectKey, fileName }) {
      return { url: `https://osca.test/put/${encodeURIComponent(objectKey)}`, headers: { 'x-name': fileName } };
    },
    async head(objectKey) { return objects.get(objectKey) || null; },
    async presignDownload({ finalObjectKey }) {
      return { url: `https://osca.test/get/${encodeURIComponent(finalObjectKey)}` };
    },
  });
  const env = { OSCA_ENDPOINT: 'https://osca.test/', OSCA_BUCKET: 'studev-test', OSCA_ACCESS_KEY_ID: 'k', OSCA_SECRET_ACCESS_KEY: 's' };
  const svc = createCollectionsService({ repo, identity, env, now: () => clock, getGateway });

  async function call(path, { method = 'GET', user = '', body, csrf = false } = {}) {
    const headers = new Headers({ origin: ORIGIN });
    if (user) headers.set('x-user', user);
    if (csrf) headers.set('x-csrf-token', 'csrf-ok');
    if (body !== undefined) headers.set('content-type', 'application/json');
    const request = new Request(`${ORIGIN}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    try {
      const res = await svc.handle({ request, env }, new URL(request.url).pathname);
      const ct = res.headers.get('content-type') || '';
      return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
    } catch (e) {
      if (e instanceof AppError) return { status: e.status, data: { error: { code: e.code, message: e.message } } };
      throw e;
    }
  }
  return { call, objects, advance: (ms) => { clock += ms; } };
}

test('collections end-to-end: pre-imported roster, public browse without PII, replace upload, late policy, and exports', async () => {
  const f = fixture();

  // 1. Class monitor pre-imports B240402 roster (including student B24040202 and an unregistered B24040203)
  const gRes = await f.call('/api/platform/collections/groups', {
    method: 'POST', user: 'owner', csrf: true,
    body: { name: 'B240402', lines: 'B24040201 班长甲\nB24040202 同学乙\nB24040203 待注册丙' },
  });
  assert.equal(gRes.status, 201);
  assert.equal(gRes.data.group.members.length, 3);
  const groupId = gRes.data.group.id;

  // 2. Class monitor publishes JS160201S 计算机通信与网络 · 实验2
  const itemRes = await f.call('/api/platform/collections/items', {
    method: 'POST', user: 'owner', csrf: true,
    body: {
      kind: 'course', term: '2026-2027-1', termLabel: '2026–2027 学年第一学期',
      code: 'JS160201S', name: '计算机通信与网络', category: '课程实验',
      groupIds: [groupId], roundLabel: '实验2',
      deadline: '2026-11-25T15:59:00.000Z', policy: 'strict',
      files: [{ name: '实验报告', extensions: ['doc', 'docx', 'pdf'] }],
    },
  });
  assert.equal(itemRes.status, 201);
  const itemId = itemRes.data.item.id;
  const roundId = itemRes.data.item.rounds[0].id;
  const fileId = itemRes.data.item.rounds[0].files[0].id;

  // 3. Public visitor sees the collection summary, zero PII
  const pubList = await f.call('/api/platform/collections');
  assert.equal(pubList.status, 200);
  assert.equal(pubList.data.viewer, null);
  assert.equal(pubList.data.items.length, 1);
  assert.equal(pubList.data.items[0].rosterCount, 3);
  const pubDetail = await f.call(`/api/platform/collections/items/${itemId}`);
  assert.equal(pubDetail.status, 200);
  assert.equal(pubDetail.data.board, null);

  // 4. Student logs in and automatically matches the pre-imported roster
  const stuList = await f.call('/api/platform/collections', { user: 'student' });
  assert.equal(stuList.data.items[0].inMine, true);
  assert.equal(stuList.data.items[0].rounds[0].myStatus, 'missing');

  // 5. Invalid extension is rejected before upload
  const badExt = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/presign`, {
    method: 'POST', user: 'student', csrf: true,
    body: { fileId, fileName: 'screenshot.png', sizeBytes: 1024 },
  });
  assert.equal(badExt.status, 400);
  assert.equal(badExt.data.error.code, 'INVALID_EXTENSION');

  // 6. Valid upload + confirm -> stored with normalized filename
  const pre1 = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/presign`, {
    method: 'POST', user: 'student', csrf: true,
    body: { fileId, fileName: 'lab2.docx', sizeBytes: 4096 },
  });
  assert.equal(pre1.status, 200);
  assert.equal(pre1.data.storedName, 'B24040202_同学乙_实验2_实验报告.docx');
  f.objects.set(pre1.data.objectKey, { etag: '"e1"', contentLength: 4096 });
  const conf1 = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/confirm`, {
    method: 'POST', user: 'student', csrf: true,
    body: { fileId, objectKey: pre1.data.objectKey, originalName: 'lab2.docx', storedName: pre1.data.storedName, sizeBytes: 4096 },
  });
  assert.equal(conf1.status, 200);
  assert.equal(conf1.data.submission.revisions, 1);

  // 7. Replace submission before deadline -> revisions=2, history kept
  const pre2 = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/presign`, {
    method: 'POST', user: 'student', csrf: true,
    body: { fileId, fileName: 'lab2_final.docx', sizeBytes: 8192 },
  });
  f.objects.set(pre2.data.objectKey, { etag: '"e2"', contentLength: 8192 });
  const conf2 = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/confirm`, {
    method: 'POST', user: 'student', csrf: true,
    body: { fileId, objectKey: pre2.data.objectKey, originalName: 'lab2_final.docx', storedName: pre2.data.storedName, sizeBytes: 8192 },
  });
  assert.equal(conf2.status, 200);
  assert.equal(conf2.data.submission.revisions, 2);
  assert.equal(conf2.data.submission.history.length, 1);

  // 8. Staff exports CSV & batch ZIP file list
  const csvRes = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/csv`, { user: 'owner' });
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.data, /B24040202_同学乙_实验2_实验报告\.docx/);
  const filesRes = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/files`, { user: 'owner' });
  assert.equal(filesRes.status, 200);
  assert.equal(filesRes.data.files.length, 1);
  assert.equal(filesRes.data.files[0].path, 'B240402/实验报告/B24040202_同学乙_实验2_实验报告.docx');
});
