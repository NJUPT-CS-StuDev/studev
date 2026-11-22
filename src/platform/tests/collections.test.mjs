import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionsService } from '../server/collections.mjs';
import { createIdentity } from '../server/identity.mjs';
import { createRepository } from '../server/store.mjs';
import { hashPassword } from '../server/crypto.mjs';
import { AppError, fail } from '../server/common.mjs';
import { loadOrganizations, saveOrganization } from '../server/organizations.mjs';

const ORIGIN = 'https://studev.test';

function memoryStore() {
  const data = new Map();
  return {
    data,
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async setJSON(key, value) { data.set(key, structuredClone(value)); },
    async list({ prefix }) { return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
    async delete(key) { data.delete(key); },
  };
}

function collectionsFixture() {
  let clock = Date.UTC(2026, 10, 22, 12);
  const store = memoryStore();
  const objects = new Map();
  const users = {
    owner: {
      id: 'owner-1', role: 'owner', status: 'active', studentId: 'B24040201', realName: '班长甲', nickname: '班长甲',
      memberships: [
        { organizationId: 'student-development', title: '执行主席', overseesOrganizationId: 'student-development/operations', order: 1 },
        { organizationId: 'class:B240402', title: '班长', overseesOrganizationId: '', order: 999 },
      ],
    },
    admin: {
      id: 'admin-1', role: 'admin', status: 'active', studentId: 'B24040101', realName: '一班学委', nickname: '一班学委',
      memberships: [{ organizationId: 'class:B240401', title: '学习委员', overseesOrganizationId: '', order: 999 }],
    },
    student: {
      id: 'stu-2', role: 'user', status: 'active', studentId: 'B24040202', realName: '同学乙', nickname: '同学乙',
      memberships: [{ organizationId: 'class:B240402', title: '', overseesOrganizationId: '', order: 999 }],
    },
    pending: {
      id: 'stu-3', role: 'user', status: 'pending', studentId: 'B24040203', realName: '待注册丙', nickname: '',
      memberships: [{ organizationId: 'class:B240402', title: '', overseesOrganizationId: '', order: 999 }],
    },
  };
  const repo = createRepository(store, { secret: 'synthetic-tests-only-secret-'.repeat(3), now: () => clock });
  const identity = {
    async authenticate(request, { required = false, staff = false, owner = false, csrf = false } = {}) {
      const u = users[request.headers.get('x-user') || ''];
      if (!u && (required || staff || owner || csrf)) fail(401, 'AUTH_REQUIRED', '登录');
      if (!u) return null;
      if (owner && u.role !== 'owner') fail(403, 'OWNER_REQUIRED', '无权');
      if (staff && !['owner', 'admin'].includes(u.role)) fail(403, 'STAFF_REQUIRED', '无权');
      if (csrf && request.headers.get('x-csrf-token') !== 'csrf-ok') fail(403, 'CSRF_REJECTED', 'CSRF');
      return { user: u };
    },
    async loadAllUsers() { return Object.values(users); },
    async loadOrganizations() { return loadOrganizations(repo); },
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
  return { call, repo, objects, advance: (ms) => { clock += ms; } };
}

test('unified org-tree × collection model: issuer identity, people recipients, tree filtering, uploads, owner recording, and exports', async () => {
  const f = collectionsFixture();

  // Build 3-level academic tree: 计算机学院 › 计算机科学与技术 › B240401 / B240402
  await saveOrganization(f.repo, { id: 'college:cs', name: '计算机学院', parentId: null, kind: 'academic', publicRoster: false });
  await saveOrganization(f.repo, { id: 'major:cs-cst', name: '计算机科学与技术', parentId: 'college:cs', kind: 'academic', publicRoster: false });
  await saveOrganization(f.repo, { id: 'class:B240401', name: 'B240401 班', parentId: 'major:cs-cst', kind: 'academic', publicRoster: false, titles: ['班长', '学习委员'] });
  await saveOrganization(f.repo, { id: 'class:B240402', name: 'B240402 班', parentId: 'major:cs-cst', kind: 'academic', publicRoster: false, titles: ['班长', '学习委员'] });

  // 1. Staff fetches people directory for the org-tree picker
  const dirRes = await f.call('/api/platform/collections/people', { user: 'owner' });
  assert.equal(dirRes.status, 200);
  assert.equal(dirRes.data.people.length, 4);
  assert.ok(dirRes.data.organizations.some((o) => o.id === 'class:B240402' && o.depth === 2));

  // 2. Non-owner admin cannot publish under an unrelated org (student-development), CAN publish under own org or ancestor
  const forbidden = await f.call('/api/platform/collections/items', {
    method: 'POST', user: 'admin', csrf: true,
    body: {
      issuerOrganizationId: 'student-development', issuerTitle: '主席',
      term: '2026-2027-1', termLabel: '2026–2027 学年第一学期',
      name: '越权测试', category: '材料',
      targetMode: 'open', roundLabel: '第1次', files: [{ name: '文件', extensions: ['pdf'] }],
    },
  });
  assert.equal(forbidden.status, 403);

  // 3. Class monitor publishes under B240402 · 班长 with explicit people recipients (decoupled from org/title)
  const itemRes = await f.call('/api/platform/collections/items', {
    method: 'POST', user: 'owner', csrf: true,
    body: {
      issuerOrganizationId: 'class:B240402', issuerTitle: '班长',
      term: '2026-2027-1', termLabel: '2026–2027 学年第一学期',
      code: 'JS160201S', name: '计算机通信与网络', category: '课程实验',
      targetMode: 'selected',
      recipients: [
        { studentId: 'B24040201', name: '班长甲' },
        { studentId: 'B24040202', name: '同学乙' },
        { studentId: 'B24040203', name: '待注册丙' },
      ],
      roundLabel: '实验2',
      deadline: '2026-11-25T15:59:00.000Z', policy: 'strict',
      files: [{ name: '实验报告', extensions: ['doc', 'docx', 'pdf'] }],
    },
  });
  assert.equal(itemRes.status, 201);
  assert.equal(itemRes.data.item.issuer.organizationName, '计算机学院 › 计算机科学与技术 › B240402 班');
  assert.equal(itemRes.data.item.issuer.title, '班长');
  const itemId = itemRes.data.item.id;
  const roundId = itemRes.data.item.rounds[0].id;
  const fileId = itemRes.data.item.rounds[0].files[0].id;

  // 4. Owner also publishes a club collection under student-development/operations
  const clubRes = await f.call('/api/platform/collections/items', {
    method: 'POST', user: 'owner', csrf: true,
    body: {
      issuerOrganizationId: 'student-development/operations', issuerTitle: '分管主席',
      term: '2026-2027-1', termLabel: '2026–2027 学年第一学期',
      name: '换届总结材料', category: '活动材料',
      targetMode: 'open', roundLabel: '第1次', files: [{ name: '总结', extensions: ['pdf', 'docx'] }],
    },
  });
  assert.equal(clubRes.status, 201);

  // 5. Tree-inherited filtering on public GET /collections
  const allList = await f.call('/api/platform/collections');
  assert.equal(allList.data.items.length, 2);
  const collegeList = await f.call('/api/platform/collections?orgId=college:cs');
  assert.equal(collegeList.data.items.length, 1);
  assert.equal(collegeList.data.items[0].id, itemId);
  const majorList = await f.call('/api/platform/collections?orgId=major:cs-cst');
  assert.equal(majorList.data.items.length, 1);
  assert.equal(majorList.data.items[0].id, itemId);
  const clubParentList = await f.call('/api/platform/collections?orgId=student-development');
  assert.equal(clubParentList.data.items.length, 1);
  assert.equal(clubParentList.data.items[0].id, clubRes.data.item.id);
  const otherClassList = await f.call('/api/platform/collections?orgId=class:B240401');
  assert.equal(otherClassList.data.items.length, 0);

  // 6. Public detail exposes zero PII
  const pubDetail = await f.call(`/api/platform/collections/items/${itemId}`);
  assert.equal(pubDetail.status, 200);
  assert.equal(pubDetail.data.board, null);
  assert.equal(pubDetail.data.roundStats[0].total, 3);

  // 7. Student sees their own assignment, rejects bad extension, uploads & replaces
  const stuList = await f.call('/api/platform/collections', { user: 'student' });
  const stuCourse = stuList.data.items.find((i) => i.id === itemId);
  assert.equal(stuCourse.inMine, true);
  assert.equal(stuCourse.rounds[0].myStatus, 'missing');

  const badExt = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/presign`, {
    method: 'POST', user: 'student', csrf: true,
    body: { fileId, fileName: 'screenshot.png', sizeBytes: 1024 },
  });
  assert.equal(badExt.status, 400);
  assert.equal(badExt.data.error.code, 'INVALID_EXTENSION');

  const pre1 = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/presign`, {
    method: 'POST', user: 'student', csrf: true,
    body: { fileId, fileName: 'lab2.docx', sizeBytes: 4096 },
  });
  assert.equal(pre1.status, 200);
  assert.equal(pre1.data.storedName, 'B24040202_同学乙_实验2_实验报告.docx');
  f.objects.set(pre1.data.objectKey, { etag: '"e1"', size: 4096 });
  const conf1 = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/confirm`, {
    method: 'POST', user: 'student', csrf: true,
    body: { fileId, objectKey: pre1.data.objectKey, originalName: 'lab2.docx', storedName: pre1.data.storedName, sizeBytes: 4096 },
  });
  assert.equal(conf1.status, 200);
  assert.equal(conf1.data.submission.revisions, 1);
  assert.equal(conf1.data.submission.sizeBytes, 4096);

  // 8. Owner records an authentic historical submission for pending student with exact timestamp
  const preHist = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/presign`, {
    method: 'POST', user: 'owner', csrf: true,
    body: { fileId, fileName: 'old.pdf', sizeBytes: 2048, studentId: 'B24040203', studentName: '待注册丙' },
  });
  assert.equal(preHist.status, 200);
  f.objects.set(preHist.data.objectKey, { etag: '"e3"', size: 2048 });
  const confHist = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/confirm`, {
    method: 'POST', user: 'owner', csrf: true,
    body: {
      fileId, objectKey: preHist.data.objectKey, originalName: 'old.pdf', storedName: preHist.data.storedName,
      sizeBytes: 2048, studentId: 'B24040203', studentName: '待注册丙', submittedAt: '2026-04-10T08:00:00.000Z', revisions: 2,
    },
  });
  assert.equal(confHist.status, 200);
  assert.equal(confHist.data.submission.submittedAt, '2026-04-10T08:00:00.000Z');
  assert.equal(confHist.data.submission.revisions, 2);

  // 9. Staff exports CSV & ZIP file list
  const csvRes = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/csv`, { user: 'owner' });
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.data, /B24040202_同学乙_实验2_实验报告\.docx/);
  assert.match(csvRes.data, /B24040203_待注册丙_实验2_实验报告\.pdf/);
  const filesRes = await f.call(`/api/platform/collections/items/${itemId}/rounds/${roundId}/files`, { user: 'owner' });
  assert.equal(filesRes.status, 200);
  assert.equal(filesRes.data.files.length, 2);
});

test('dynamic org tree, batch pre-import without QQ, and seamless pending student self-activation', async () => {
  const store = memoryStore();
  const clock = Date.UTC(2026, 10, 22, 12);
  const ownerPasswordHash = await hashPassword('OwnerSecretPass123!');
  const env = {
    PLATFORM_ORIGIN: ORIGIN,
    PLATFORM_SESSION_SECRET: 's'.repeat(48),
    PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    PLATFORM_OWNER_QQ: '10000001',
    PLATFORM_OWNER_PASSWORD_HASH: ownerPasswordHash,
    PLATFORM_OWNER_STUDENT_ID: 'B24040201',
    PLATFORM_OWNER_REAL_NAME: '所有者',
    PLATFORM_OWNER_NICKNAME: '所有者',
  };
  const repo = createRepository(store, { secret: env.PLATFORM_SESSION_SECRET, now: () => clock });
  const identity = createIdentity({ repo, env, now: () => clock });

  // Helper to call identity with synthetic bearer/cookie or direct bootstrap
  async function rawCall(path, { method = 'GET', body, cookie, csrf } = {}) {
    const headers = new Headers({ origin: ORIGIN });
    if (cookie) headers.set('cookie', cookie);
    if (csrf) headers.set('x-csrf-token', csrf);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const request = new Request(`${ORIGIN}/api/platform${path}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    try {
      const res = await identity.handle({ request, env, clientIp: '127.0.0.1' }, `/api/platform${path}`);
      return { status: res.status, body: await res.json(), setCookie: res.headers.get('set-cookie') };
    } catch (e) {
      if (e instanceof AppError) return { status: e.status, body: { error: { code: e.code, message: e.message } } };
      throw e;
    }
  }

  // Bootstrap & prepare active owner (clear mustChangePassword + enable verified session via direct repo prep)
  const device = { deviceId: 'test-device-12345678', deviceName: 'Test Browser' };
  const loginRes = await rawCall('/auth/login', { method: 'POST', body: { studentId: 'B24040201', password: 'OwnerSecretPass123!', ...device } });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.setCookie.split(';')[0];
  const csrf = loginRes.body.csrfToken;
  const ownerRec = await repo.latest(`identity/users/${loginRes.body.user.id}`);
  await repo.append(`identity/users/${ownerRec.id}`, { ...ownerRec, mustChangePassword: false, totp: { encrypted: 'x', epoch: 'e', recoveryHashes: [] } }, ownerRec.revision);
  const sessOrig = await repo.get(`identity/devices/sessions/${loginRes.body.deviceSessionId}.json`);
  const sessRec = await repo.latest(`identity/devices/state/${loginRes.body.deviceSessionId}`);
  await repo.append(`identity/devices/state/${loginRes.body.deviceSessionId}`, { ...sessOrig, ...sessRec, mfaVerified: true }, sessRec?.revision || 0);

  // 1. Owner builds 3-level tree via official API
  const c1 = await rawCall('/admin/organizations', { method: 'POST', cookie, csrf, body: { id: 'college:cs', name: '计算机学院', parentId: null, kind: 'academic', publicRoster: false } });
  assert.equal(c1.status, 201);
  const c2 = await rawCall('/admin/organizations', { method: 'POST', cookie, csrf, body: { id: 'major:cs-cst', name: '计算机科学与技术', parentId: 'college:cs', kind: 'academic', publicRoster: false } });
  assert.equal(c2.status, 201);
  const c3 = await rawCall('/admin/organizations', { method: 'POST', cookie, csrf, body: { id: 'class:B240402', name: 'B240402 班', parentId: 'major:cs-cst', kind: 'academic', publicRoster: false, titles: ['班长', '学习委员'] } });
  assert.equal(c3.status, 201);
  assert.equal(c3.body.organization.fullName, '计算机学院 › 计算机科学与技术 › B240402 班');

  // 2. Owner batch-imports B240402 students (including owner itself -> appends membership, plus new pending student without QQ)
  const batch = await rawCall('/admin/users/batch', {
    method: 'POST', cookie, csrf,
    body: { organizationId: 'class:B240402', lines: 'B24040201 所有者\nB24040209 新同学' },
  });
  assert.equal(batch.status, 201);
  assert.equal(batch.body.created, 1);
  assert.equal(batch.body.updated, 1);

  // 3. Pending student appears in /admin/users even without QQ
  const usersRes = await rawCall('/admin/users', { cookie });
  assert.equal(usersRes.status, 200);
  const pendingStu = usersRes.body.items.find((u) => u.studentId === 'B24040209');
  assert.ok(pendingStu);
  assert.equal(pendingStu.status, 'pending');
  assert.equal(pendingStu.memberships[0].organizationName, '计算机学院 › 计算机科学与技术 › B240402 班');

  // 4. Wrong realName cannot claim pending student
  const wrongClaim = await rawCall('/auth/register', {
    method: 'POST',
    body: { studentId: 'B24040209', realName: '冒充者', qq: '20000009', nickname: '冒充', password: 'StudentPass1234!' },
  });
  assert.equal(wrongClaim.status, 409);

  // 5. Exact studentId + realName seamlessly claims & activates pending student while preserving class membership!
  const claimed = await rawCall('/auth/register', {
    method: 'POST',
    body: { studentId: 'B24040209', realName: '新同学', qq: '20000009', nickname: '小新', password: 'StudentPass1234!' },
  });
  assert.equal(claimed.status, 201);
  assert.equal(claimed.body.user.status, 'active');
  assert.equal(claimed.body.user.memberships.length, 1);
  assert.equal(claimed.body.user.memberships[0].organizationId, 'class:B240402');

  // 6. Activated student can log in immediately
  const stuLogin = await rawCall('/auth/login', { method: 'POST', body: { studentId: 'B24040209', password: 'StudentPass1234!', ...device } });
  assert.equal(stuLogin.status, 200);
  assert.equal(stuLogin.body.user.memberships[0].organizationName, '计算机学院 › 计算机科学与技术 › B240402 班');
});
