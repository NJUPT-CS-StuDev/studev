import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormsService } from '../src/server/platform-forms.mjs';
import { createRepository } from '../src/server/platform-store.mjs';
import { AppError, fail, response } from '../src/server/platform-common.mjs';

const ORIGIN = 'https://studev.test';
const member = { id: 'member-one', role: 'user', nickname: '测试成员', qq: '12345678', studentId: '202600000001', realName: '测试成员甲', identityVerified: false, profileComplete: true };
const secondMember = { id: 'member-two', role: 'user', nickname: '另一成员', qq: '12345679', studentId: '202600000002', realName: '测试成员乙', identityVerified: false, profileComplete: true };
const owner = { id: 'owner-one', role: 'owner', nickname: '测试所有者', qq: '12345680', studentId: '202600000000', realName: '测试维护者', identityVerified: false, profileComplete: true };
function fixture() {
  let clock = Date.UTC(2026, 9, 21, 15);
  const data = new Map(); const objects = new Map(); const signed = []; const deleted = []; const downloads = [];
  const users = structuredClone({ member, secondMember, owner });
  const store = {
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async setJSON(key, value, { onlyIfNew } = {}) {
      if (onlyIfNew && data.has(key)) throw Object.assign(new Error('conflict'), { status: 409 });
      data.set(key, structuredClone(value));
    },
    async list({ prefix }) { return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
    async delete(key) { data.delete(key); },
  };
  const repo = createRepository(store, { secret: 'synthetic-tests-only-secret-'.repeat(3), now: () => clock });
  const identity = {
    publicUser(user) { return { id: user.id, qq: user.qq, email: user.email, emailVerified: user.emailVerified === true, nickname: user.nickname, studentId: user.studentId, realName: user.realName, identityVerified: user.identityVerified === true }; },
    async authenticate(request, { required = false, staff = false, owner: ownerOnly = false, csrf = false } = {}) {
      const key = request.headers.get('x-user');
      const user = users[key];
      if (!user && (required || staff || ownerOnly || csrf)) fail(401, 'AUTH_REQUIRED', '登录');
      if (!user) return null;
      if (staff && !['owner', 'admin'].includes(user.role)) fail(403, 'STAFF_REQUIRED', '无权');
      if ((staff || ownerOnly) && request.headers.get('x-mfa') !== 'yes') fail(403, 'MFA_REQUIRED', 'TOTP');
      if (ownerOnly && user.role !== 'owner') fail(403, 'OWNER_REQUIRED', '无权');
      if (csrf && request.headers.get('x-csrf-token') !== 'synthetic-csrf') fail(403, 'CSRF_REJECTED', 'CSRF');
      return { user, csrfToken: 'synthetic-csrf', mfaVerified: request.headers.get('x-mfa') === 'yes' };
    },
  };
  const gateway = {
    async presignUpload(record, ttl) { signed.push(structuredClone(record)); return { url: `https://s3.test/${record.objectKey}`, headers: { 'Content-Type': record.contentType }, method: 'PUT', expiresAt: clock + ttl * 1000 }; },
    async head(key) { return objects.has(key) ? structuredClone(objects.get(key)) : null; },
    async copy(source, target) { objects.set(target, structuredClone(objects.get(source))); },
    async delete(key) { deleted.push(key); objects.delete(key); },
    async presignDownload(record, etag, ttl) { downloads.push(record); return { url: 'https://s3.test/signed-download', fileName: record.fileName, headers: { 'If-Match': etag }, expiresAt: clock + ttl * 1000 }; },
  };
  const env = { PLATFORM_ORIGIN: ORIGIN, OSCA_ENDPOINT: 'https://s3.test', OSCA_BUCKET: 'synthetic-bucket', OSCA_ACCESS_KEY_ID: 'synthetic-key', OSCA_SECRET_ACCESS_KEY: 'synthetic-secret', OSCA_PREFIX: 'studev-submissions/' };
  const service = createFormsService({ repo, identity, env, now: () => clock, getGateway: () => gateway });
  const fixture = {
    repo, store, data, gateway, objects, signed, downloads, deleted, env, users,
    advance(ms) { clock += ms; },
    async request(path, { method = 'GET', body, user, mfa = true, csrf = true, origin = ORIGIN, receipt, clientIp = '192.0.2.1' } = {}) {
      const headers = {};
      if (user) headers['x-user'] = user;
      if (mfa) headers['x-mfa'] = 'yes';
      if (csrf) headers['x-csrf-token'] = 'synthetic-csrf';
      if (receipt) headers['x-receipt-token'] = receipt;
      if (method !== 'GET') headers.origin = origin;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const request = new Request(`${ORIGIN}/api/platform${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      try { return await service.handle({ request, env, clientIp }, `/api/platform${path}`); }
      catch (error) { if (error instanceof AppError) return response({ error: { code: error.code } }, error.status); throw error; }
    },
  };
  return fixture;
}
const textField = { id: 'name', type: 'text', label: '名称', required: true };
const fileField = { id: 'attachments', type: 'file', label: '附件', required: true, maxFiles: 3, maxFileBytes: 1024, extensions: ['txt'] };
function formBody(extra = {}) { return { title: '测试收集表', description: '无真实个人信息', status: 'published', access: 'members', requireReview: true, allowEdit: true, maxPerUser: 3, maxSubmissions: 20, fields: [textField], ...extra }; }
async function createForm(f, extra = {}) {
  const res = await f.request('/admin/forms', { method: 'POST', user: 'owner', body: formBody(extra) });
  assert.equal(res.status, 201); return (await res.json()).form;
}
async function authorize(f, form, extra = {}, options = {}) {
  const res = await f.request(`/forms/${form.id}/submissions`, { method: 'POST', user: 'member', body: { answers: { name: '测试材料' }, files: [], ...extra }, ...options });
  assert.equal(res.status, 201); return res.json();
}
async function complete(f, submission) {
  for (const upload of submission.uploads) {
    const file = f.signed.find((s) => s.id === upload.fileId);
    f.objects.set(file.objectKey, { size: file.fileSize, contentType: file.contentType, etag: `"etag-${file.id}"` });
  }
  return f.request(`/submissions/${submission.submission.id}/complete`, { method: 'POST', body: { receiptToken: submission.receiptToken } });
}

test('form lists require the current snapshot contract and never load an old snapshotless index', async () => {
  const f = fixture(), form = await createForm(f);
  f.data.set(`platform-v1/form-index/${form.id}.json`, { id: form.id });
  const result = await f.request('/admin/forms', { user: 'owner' });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, 'FORM_INDEX_INVALID');
});

test('staff operations require staff role, completed MFA, CSRF and same origin', async () => {
  const f = fixture();
  for (const [options, expected] of [[{}, 401], [{ user: 'member' }, 403], [{ user: 'owner', mfa: false }, 403], [{ user: 'owner', csrf: false }, 403], [{ user: 'owner', origin: 'https://attacker.test' }, 403]]) {
    const res = await f.request('/admin/forms', { method: 'POST', body: formBody(), ...options }); assert.equal(res.status, expected);
  }
  const form = await createForm(f);
  assert.equal((await f.request(`/forms/${form.id}`)).status, 401);
  const draft = await createForm(f, { status: 'draft', access: 'public' });
  assert.equal((await f.request(`/forms/${draft.id}`, { user: 'member' })).status, 403);
  assert.equal((await f.request(`/forms/${draft.id}`, { user: 'owner', mfa: false })).status, 403);
});

test('schema validation rejects duplicate ids, unsafe ranges and oversized files', async () => {
  const f = fixture();
  for (const schema of [[textField, textField], [{ ...textField, id: '__proto__' }], [{ id: 'age', label: '数字', type: 'number', min: 3, max: 2 }], [{ id: 'age', label: '数字', type: 'number', min: '3' }], [{ ...fileField, maxFileBytes: 20971521 }], [{ id: 'option', label: '选项', type: 'select', options: ['重复', '重复'] }]]) {
    const res = await f.request('/admin/forms', { method: 'POST', user: 'owner', body: formBody({ fields: schema }) }); assert.equal(res.status, 400);
  }
});

test('pure information submissions confirm idempotently and preserve schema snapshots', async () => {
  const f = fixture(); const form = await createForm(f);
  const created = await authorize(f, form); assert.deepEqual(created.uploads, []); assert.equal(created.submission.status, 'uploading');
  assert.equal((await complete(f, created)).status, 200);
  const again = await complete(f, created); assert.equal(again.status, 200); assert.equal((await again.json()).submission.revision, 0);
  const editedForm = await f.request(`/admin/forms/${form.id}`, { method: 'POST', user: 'owner', body: { revision: form.revision, fields: [{ id: 'new_field', label: '新字段', type: 'text' }] } }); assert.equal(editedForm.status, 200);
  const details = await f.request(`/submissions/${created.submission.id}`, { user: 'member' }); const payload = await details.json(); assert.equal(payload.form.fields[0].id, 'name');
  assert.equal((await f.request(`/submissions/${created.submission.id}/edit`, { method: 'POST', user: 'member', body: { revision: 0, answers: { name: '修改后' } } })).status, 200);
  assert.equal((await f.request(`/submissions/${created.submission.id}/edit`, { method: 'POST', user: 'member', body: { revision: 0, answers: { name: '过期版本' } } })).status, 409);
  const review = await f.request(`/submissions/${created.submission.id}/review`, { method: 'POST', user: 'owner', body: { revision: 1, status: 'accepted', comment: '完成' } }); assert.equal(review.status, 200);
  assert.equal((await review.json()).submission.status, 'accepted');
  const changed = await f.request(`/submissions/${created.submission.id}/edit`, { method: 'POST', user: 'member', body: { revision: 2, answers: { name: '再次修改' } } });
  const changedRow = (await changed.json()).submission; assert.equal(changedRow.status, 'pending_review'); assert.equal(changedRow.review, undefined);
});

test('members are isolated; guests require an unguessable receipt and safe projections', async () => {
  const f = fixture(); const form = await createForm(f); const created = await authorize(f, form); await complete(f, created);
  const id = created.submission.id;
  assert.equal((await f.request(`/submissions/${id}`, { user: 'secondMember' })).status, 404);
  assert.equal((await f.request(`/submissions/${id}`, { receipt: created.receiptToken })).status, 404);
  const own = (await (await f.request('/me/submissions', { user: 'member' })).json()).items; assert.equal(own.length, 1);
  assert.equal((await (await f.request('/me/submissions', { user: 'secondMember' })).json()).items.length, 0);
  const publicForm = await createForm(f, { access: 'public' });
  const guest = await authorize(f, publicForm, { submitterName: '测试访客' }, { user: undefined }); await complete(f, guest);
  assert.equal((await f.request(`/submissions/${guest.submission.id}`)).status, 404);
  assert.equal((await f.request(`/submissions/${guest.submission.id}`, { receipt: 'incorrect-but-long-secret' })).status, 404);
  const view = await f.request(`/submissions/${guest.submission.id}`, { receipt: guest.receiptToken }); assert.equal(view.status, 200);
  const serialized = JSON.stringify(await view.json());
  for (const forbidden of ['receiptHash', 'objectKey', 'finalObjectKey', 'secretAccessKey', 'synthetic-key', '12345678']) assert.equal(serialized.includes(forbidden), false);
  assert.equal((await f.request(`/submissions/${guest.submission.id}/edit`, { method: 'POST', body: { revision: 0, answers: { name: '更改' } }, receipt: guest.receiptToken })).status, 401);
});

test('only staff record details expose the current member contact projection, never personal or public lists', async () => {
  const f = fixture(); const form = await createForm(f); const created = await authorize(f, form); await complete(f, created);
  const account = { ...member, email: '12345678@qq.com', emailVerified: false, passwordHash: 'synthetic-private-hash', totp: { encrypted: 'synthetic-private-totp' }, securityVersion: 'synthetic-private-version' };
  const first = await f.repo.append(`identity/users/${member.id}`, account, 0);
  await f.repo.append(`identity/users/${member.id}`, { ...first, nickname: '最新昵称', emailVerified: true }, first.revision);
  const own = await (await f.request(`/submissions/${created.submission.id}`, { user: 'member' })).json();
  assert.equal(own.submitterContact, undefined); assert.equal(own.canEdit, true);
  const staff = await (await f.request(`/submissions/${created.submission.id}`, { user: 'owner' })).json();
  assert.deepEqual(staff.submitterContact, { qq: '12345678', email: '12345678@qq.com', emailVerified: true, nickname: '最新昵称', studentId: member.studentId, realName: member.realName, identityVerified: false });
  assert.equal(staff.canEdit, false);
  assert.equal(JSON.stringify(staff).includes('synthetic-private'), false);
  const staffList = await (await f.request(`/admin/forms/${form.id}/submissions`, { user: 'owner' })).json();
  const ownList = await (await f.request('/me/submissions', { user: 'member' })).json();
  for (const list of [staffList, ownList]) { assert.equal(JSON.stringify(list).includes('submitterContact'), false); assert.equal(JSON.stringify(list).includes('12345678@qq.com'), false); }
  const guestForm = await createForm(f, { access: 'public' });
  const guest = await authorize(f, guestForm, { submitterName: '测试访客' }, { user: undefined }); await complete(f, guest);
  const guestDetails = await (await f.request(`/submissions/${guest.submission.id}`, { receipt: guest.receiptToken })).json();
  assert.equal(guestDetails.submitterContact, undefined); assert.equal(guestDetails.canEdit, false);
  const staffGuestDetails = await (await f.request(`/submissions/${guest.submission.id}`, { user: 'owner' })).json();
  assert.equal(staffGuestDetails.submitterContact, undefined);
  assert.equal((await f.request(`/submissions/${created.submission.id}`, { user: 'owner', mfa: false })).status, 403);
});

test('member identity is snapshotted automatically and only exposed through owner or staff record access', async () => {
  const f = fixture(); const form = await createForm(f, { access: 'public' });
  const created = await authorize(f, form, { submitterIdentity: { studentId: 'forged-student', realName: '伪造身份', identityVerified: true } });
  const expected = { studentId: member.studentId, realName: member.realName, identityVerified: false };
  assert.deepEqual(created.submission.submitterIdentity, expected);
  const confirmation = await complete(f, created); assert.equal(confirmation.status, 200);
  assert.equal((await confirmation.json()).submission.submitterIdentity, undefined);
  assert.equal((await (await complete(f, created)).json()).submission.submitterIdentity, undefined);
  // Subsequent profile changes must not rewrite the account identity at the moment of submission.
  Object.assign(f.users.member, { studentId: '202600000099', realName: '测试更正姓名', identityVerified: true });
  await f.repo.append(`identity/users/${member.id}`, { ...f.users.member, email: '12345678@qq.com', emailVerified: false }, 0);
  const own = await (await f.request(`/submissions/${created.submission.id}`, { user: 'member' })).json();
  assert.deepEqual(own.submission.submitterIdentity, expected); assert.equal(own.submitterContact, undefined);
  const ownList = await (await f.request('/me/submissions', { user: 'member' })).json(); assert.deepEqual(ownList.items[0].submitterIdentity, expected);
  const staff = await (await f.request(`/submissions/${created.submission.id}`, { user: 'owner' })).json();
  assert.deepEqual(staff.submission.submitterIdentity, expected);
  assert.equal(staff.submitterContact.studentId, '202600000099'); assert.equal(staff.submitterContact.realName, '测试更正姓名'); assert.equal(staff.submitterContact.identityVerified, true);
  const staffList = await (await f.request(`/admin/forms/${form.id}/submissions`, { user: 'owner' })).json(); assert.deepEqual(staffList.items[0].submitterIdentity, expected);
  assert.equal((await f.request(`/submissions/${created.submission.id}`, { user: 'secondMember' })).status, 404);
  assert.equal((await f.request(`/submissions/${created.submission.id}`, { receipt: created.receiptToken })).status, 404);
  const guest = await authorize(f, form, { submitterName: '测试访客', submitterIdentity: expected }, { user: undefined });
  assert.equal(guest.submission.submitterIdentity, undefined); await complete(f, guest);
  const guestView = await (await f.request(`/submissions/${guest.submission.id}`, { receipt: guest.receiptToken })).json(); assert.equal(guestView.submission.submitterIdentity, undefined);
  for (const path of ['/forms', `/forms/${form.id}`]) {
    const serialized = JSON.stringify(await (await f.request(path)).json());
    assert.equal(serialized.includes(member.studentId), false); assert.equal(serialized.includes(member.realName), false); assert.equal(serialized.includes('submitterIdentity'), false);
  }
});

test('member receipt-only completion returns minimal confirmation without names, answers or filenames', async () => {
  const f = fixture(); f.users.member.nickname = member.realName;
  const form = await createForm(f, { fields: [textField, fileField] });
  const created = await authorize(f, form, { answers: { name: '测试专用私人答案' }, files: [{ fieldId: 'attachments', name: '测试私人文件名.txt', size: 7, type: 'text/plain' }] });
  const expectedKeys = ['createdAt', 'formId', 'id', 'revision', 'status', 'updatedAt'];
  for (const result of [await complete(f, created), await complete(f, created)]) {
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.deepEqual(Object.keys(body.submission).sort(), expectedKeys);
    assert.equal(body.submission.id, created.submission.id);
    assert.equal(body.submission.status, 'pending_review');
    const serialized = JSON.stringify(body);
    for (const sensitive of [member.studentId, member.realName, '测试专用私人答案', '测试私人文件名', 'submitterName', 'submitterIdentity', 'answers', 'files', 'userId']) assert.equal(serialized.includes(sensitive), false);
  }
  const personal = await (await f.request(`/submissions/${created.submission.id}`, { user: 'member' })).json();
  assert.equal(personal.submission.answers.name, '测试专用私人答案'); assert.equal(personal.submission.files[0].name, '测试私人文件名.txt');
  const guestForm = await createForm(f, { access: 'public' });
  const guest = await authorize(f, guestForm, { submitterName: '测试访客称呼', answers: { name: '测试访客答案' } }, { user: undefined });
  const guestDone = await (await complete(f, guest)).json();
  assert.equal(guestDone.submission.submitterName, '测试访客称呼'); assert.equal(guestDone.submission.answers.name, '测试访客答案');
});

test('identity CSV exports submission-time values and leaves historical identity cells blank', async () => {
  const f = fixture(); const form = await createForm(f);
  const historical = await authorize(f, form); await complete(f, historical);
  const legacyKey = `platform-v1/form-records/${historical.submission.id}.json`;
  const legacy = f.data.get(legacyKey); delete legacy.submitterIdentity; legacy.submitterName = '测试旧昵称';
  f.advance(1000);
  const current = await authorize(f, form); await complete(f, current);
  Object.assign(f.users.member, { studentId: '202600000099', realName: '测试更正姓名', identityVerified: true });
  await f.repo.append(`identity/users/${member.id}`, f.users.member, 0);
  const csv = await (await f.request(`/admin/forms/${form.id}/export`, { user: 'owner' })).text();
  assert.match(csv, /"学号","姓名"/);
  const rows = csv.split('\r\n');
  const currentRow = rows.find((row) => row.includes(current.submission.id));
  const legacyRow = rows.find((row) => row.includes(historical.submission.id));
  assert.ok(currentRow); assert.ok(legacyRow);
  assert.match(currentRow, /"202600000001","测试成员甲"/);
  assert.match(legacyRow, /"测试旧昵称","",""/);
  assert.equal(csv.includes('202600000099'), false); assert.equal(csv.includes('测试更正姓名'), false);
  const legacyDetail = await (await f.request(`/submissions/${historical.submission.id}`, { user: 'member' })).json();
  assert.equal(legacyDetail.submission.submitterIdentity, undefined); assert.equal(legacyDetail.submission.submitterName, '测试旧昵称');
});

test('detail canEdit uses the actual current form rules and completion status', async () => {
  const f = fixture(); let form = await createForm(f); const created = await authorize(f, form);
  const details = async () => (await (await f.request(`/submissions/${created.submission.id}`, { user: 'member' })).json()).canEdit;
  assert.equal(await details(), false); await complete(f, created); assert.equal(await details(), true);
  async function update(values) { const res = await f.request(`/admin/forms/${form.id}`, { method: 'POST', user: 'owner', body: { revision: form.revision, ...values } }); assert.equal(res.status, 200); form = (await res.json()).form; }
  await update({ allowEdit: false }); assert.equal(await details(), false);
  await update({ allowEdit: true, status: 'closed' }); assert.equal(await details(), false);
  await update({ status: 'published', deadline: '2026-10-21T15:01:00Z' }); assert.equal(await details(), true);
  f.advance(61000); assert.equal(await details(), false);
  await update({ deadline: '', status: 'archived' }); assert.equal(await details(), false);
});

test('answer validation checks required choices, numeric ranges, real dates and unknown fields', async () => {
  const f = fixture();
  const form = await createForm(f, { fields: [textField, { id: 'score', type: 'number', label: '分数', min: 0, max: 10, required: true }, { id: 'day', type: 'date', label: '日期', required: true }, { id: 'choice', type: 'select', label: '选择', options: ['甲', '乙'], required: true }, { id: 'checks', type: 'checkbox', label: '多选', options: ['甲', '乙'], required: true }] });
  const valid = { name: '测试', score: 0, day: '2026-10-21', choice: '甲', checks: ['乙'] };
  for (const answers of [{ ...valid, name: '' }, { ...valid, score: '0' }, { ...valid, score: -1 }, { ...valid, day: '2026-02-30' }, { ...valid, choice: '丙' }, { ...valid, checks: ['甲', '甲'] }, { ...valid, extra: '注入' }]) {
    assert.equal((await f.request(`/forms/${form.id}/submissions`, { method: 'POST', user: 'member', body: { answers } })).status, 400);
  }
  assert.equal((await authorize(f, form, { answers: valid })).submission.answers.score, 0);
});

test('atomic total quota and per-member quota cannot be oversubscribed concurrently or recycled', async () => {
  const f = fixture(); const form = await createForm(f, { maxSubmissions: 2, maxPerUser: 20 });
  const responses = await Promise.all(Array.from({ length: 5 }, () => f.request(`/forms/${form.id}/submissions`, { method: 'POST', user: 'member', body: { answers: { name: '并发' } } })));
  assert.equal(responses.filter((r) => r.status === 201).length, 2); assert.equal(responses.filter((r) => r.status === 409).length, 3);
  f.advance(86400000);
  assert.equal((await f.request(`/forms/${form.id}/submissions`, { method: 'POST', user: 'secondMember', body: { answers: { name: '次日' } } })).status, 409);
  const other = await createForm(f, { maxPerUser: 1 });
  const perUser = await Promise.all(Array.from({ length: 3 }, () => f.request(`/forms/${other.id}/submissions`, { method: 'POST', user: 'member', body: { answers: { name: '同一成员' } } })));
  assert.equal(perUser.filter((r) => r.status === 201).length, 1);
  const usage = (await (await f.request(`/admin/forms/${form.id}/submissions`, { user: 'owner' })).json()).usage;
  assert.deepEqual(usage, { authorizations: 2, completed: 0, fileBytes: 0 });
});

test('lowering a form limit counts earlier authorizations and leaves no new reservation loophole', async () => {
  const f = fixture(); const form = await createForm(f, { maxSubmissions: 20, maxPerUser: 20 });
  await authorize(f, form); await authorize(f, form);
  assert.equal((await f.request(`/admin/forms/${form.id}`, { method: 'POST', user: 'owner', body: { revision: form.revision, maxSubmissions: 3 } })).status, 200);
  const results = await Promise.all(Array.from({ length: 4 }, () => f.request(`/forms/${form.id}/submissions`, { method: 'POST', user: 'member', body: { answers: { name: '降低上限后' } } })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal((await f.repo.list(`form-quota/${form.id}/`)).length, 3);
});

test('a nearly full form skips hundreds of known occupied quota slots before its atomic claim', async () => {
  const f = fixture(); const form = await createForm(f, { maxSubmissions: 600 });
  const prefix = `form-quota/${form.id}/`;
  for (let index = 0; index < 500; index++) await f.repo.putNew(`${prefix}${String(index).padStart(4, '0')}.json`, { id: `synthetic-old-ticket-${index}` });
  const listCalls = []; const writeCalls = [];
  const originalList = f.repo.list; const originalPutNew = f.repo.putNew;
  f.repo.list = async (key) => { if (key === prefix) listCalls.push(key); return originalList(key); };
  f.repo.putNew = async (key, value) => { if (key.startsWith(prefix)) writeCalls.push(key); return originalPutNew(key, value); };
  const result = await authorize(f, form);
  assert.equal(result.submission.status, 'uploading');
  assert.equal(listCalls.length, 1);
  assert.deepEqual(writeCalls, [`${prefix}0500.json`]);
  assert.equal((await originalList(prefix)).length, 501);
});

test('multi-file completion freezes independent final copies, replay cannot alter downloads', async () => {
  const f = fixture(); const form = await createForm(f, { fields: [textField, fileField] });
  const created = await authorize(f, form, { files: [{ fieldId: 'attachments', name: '甲.txt', size: 10, type: 'text/plain' }, { fieldId: 'attachments', name: '乙.txt', size: 12, type: 'text/plain' }] });
  assert.equal(created.uploads.length, 2); assert.equal((await complete(f, created)).status, 200);
  for (const file of f.signed) f.objects.set(file.objectKey, { size: file.fileSize, contentType: file.contentType, etag: '"replayed-data"' });
  const fileId = created.submission.files[0].id;
  const download = await f.request(`/submissions/${created.submission.id}/files/${fileId}/download`, { method: 'POST', user: 'member' }); assert.equal(download.status, 200);
  const result = await download.json(); assert.notEqual(result.download.headers['If-Match'], '"replayed-data"');
  assert.equal(f.downloads[0].finalObjectKey.includes('/final/'), true);
  assert.equal((await f.request(`/submissions/${created.submission.id}/files/${fileId}/download`, { method: 'POST', user: 'secondMember' })).status, 404);
  assert.equal((await f.request(`/submissions/${created.submission.id}/files/${fileId}/download`, { method: 'POST', user: 'member', csrf: false })).status, 403);
  const frozen = f.objects.get(f.downloads[0].finalObjectKey); frozen.etag = '"tampered-final"';
  assert.equal((await f.request(`/submissions/${created.submission.id}/files/${fileId}/download`, { method: 'POST', user: 'member' })).status, 409);
  const usage = (await (await f.request(`/admin/forms/${form.id}/submissions`, { user: 'owner' })).json()).usage;
  assert.deepEqual(usage, { authorizations: 1, completed: 1, fileBytes: 22 });
});

test('multiple individually valid files cannot exceed the 20 MiB total submission limit', async () => {
  const f = fixture();
  const form = await createForm(f, { fields: [{ ...fileField, id: 'first', maxFiles: 5, maxFileBytes: 20 * 1024 * 1024 }, { ...fileField, id: 'second', maxFiles: 5, maxFileBytes: 20 * 1024 * 1024 }] });
  const files = Array.from({ length: 10 }, (_, index) => ({ fieldId: index < 5 ? 'first' : 'second', name: `test-${index}.txt`, size: 3 * 1024 * 1024, type: 'text/plain' }));
  const rejected = await f.request(`/forms/${form.id}/submissions`, { method: 'POST', user: 'member', body: { answers: {}, files } });
  assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error.code, 'TOTAL_FILES_TOO_LARGE');
  assert.equal((await f.repo.list(`form-quota/${form.id}/`)).length, 0);
  const exact = [{ fieldId: 'first', name: 'first.txt', size: 10 * 1024 * 1024, type: 'text/plain' }, { fieldId: 'second', name: 'second.txt', size: 10 * 1024 * 1024, type: 'text/plain' }];
  assert.equal((await authorize(f, form, { answers: {}, files: exact })).uploads.length, 2);
});

test('guest file submission and receipt download work without a session while member CSRF remains required', async () => {
  const f = fixture(); const form = await createForm(f, { access: 'public', fields: [fileField] });
  const created = await authorize(f, form, { answers: {}, submitterName: '测试访客', files: [{ fieldId: 'attachments', name: 'guest.txt', size: 7, type: 'text/plain' }] }, { user: undefined, csrf: false });
  assert.equal((await complete(f, created)).status, 200);
  const id = created.submission.id; const fileId = created.submission.files[0].id;
  assert.equal((await f.request(`/submissions/${id}`, { receipt: created.receiptToken })).status, 200);
  assert.equal((await f.request(`/submissions/${id}/files/${fileId}/download`, { method: 'POST', receipt: created.receiptToken, csrf: false })).status, 200);
  assert.equal((await f.request(`/submissions/${id}/files/${fileId}/download`, { method: 'POST', receipt: 'incorrect-but-long-secret', csrf: false })).status, 404);
  assert.equal((await f.request(`/submissions/${id}/files/${fileId}/download`, { method: 'POST', receipt: created.receiptToken, csrf: false, origin: 'https://attacker.test' })).status, 403);
  assert.equal((await f.request(`/forms/${form.id}/submissions`, { method: 'POST', user: 'member', csrf: false, body: { answers: {}, files: [] } })).status, 403);
});

test('OSCA ignoring CopySourceIfMatch is detected by final HEAD; incomplete copies cleaned', async () => {
  const f = fixture(); const form = await createForm(f, { fields: [fileField] });
  const created = await authorize(f, form, { answers: {}, files: [{ fieldId: 'attachments', name: 'test.txt', size: 5, type: 'text/plain' }] });
  f.gateway.copy = async (source, target) => { f.objects.set(target, { ...f.objects.get(source), etag: '"raced-etag"' }); };
  const result = await complete(f, created); assert.equal(result.status, 409); assert.equal((await result.json()).error.code, 'UPLOAD_CHANGED');
  assert.equal(f.deleted.length, 1); assert.equal(await f.repo.get(`form-completed/${created.submission.id}.json`), null);
});

test('concurrent completion publishes one immutable winner and does not delete it', async () => {
  const f = fixture(); const form = await createForm(f, { fields: [fileField] });
  const created = await authorize(f, form, { answers: {}, files: [{ fieldId: 'attachments', name: 'test.txt', size: 5, type: 'text/plain' }] });
  const results = await Promise.all([complete(f, created), complete(f, created)]); assert.equal(results.every((r) => r.status === 200), true);
  const saved = await f.repo.get(`form-completed/${created.submission.id}.json`);
  assert.equal(saved.files.length, 1); assert.equal(f.objects.has(saved.files[0].finalObjectKey), true); assert.equal(f.deleted.includes(saved.files[0].finalObjectKey), false);
});

test('ambiguous completion write preserves the candidate referenced by committed metadata', async () => {
  const f = fixture(); const form = await createForm(f, { fields: [fileField] });
  const created = await authorize(f, form, { answers: {}, files: [{ fieldId: 'attachments', name: 'test.txt', size: 5, type: 'text/plain' }] });
  const original = f.repo.putNew;
  f.repo.putNew = async (key, value) => { await original(key, value); if (key.startsWith('form-completed/')) throw new Error('synthetic transport failure'); };
  await assert.rejects(() => complete(f, created), /synthetic transport failure/);
  const saved = await f.repo.get(`form-completed/${created.submission.id}.json`); assert.equal(f.objects.has(saved.files[0].finalObjectKey), true); assert.equal(f.deleted.length, 0);
  assert.equal((await complete(f, created)).status, 200);
});

test('closed/deadline forms reject new submissions but authorized uploads can finish briefly', async () => {
  const f = fixture(); const form = await createForm(f, { deadline: '2026-10-21T15:01:00Z' });
  const created = await authorize(f, form);
  f.advance(61000);
  assert.equal((await f.request(`/forms/${form.id}/submissions`, { method: 'POST', user: 'secondMember', body: { answers: { name: '过期' } } })).status, 409);
  assert.equal((await complete(f, created)).status, 200);
  assert.equal((await f.request(`/submissions/${created.submission.id}/edit`, { method: 'POST', user: 'member', body: { revision: 0, answers: { name: '过期后修改' } } })).status, 409);
  assert.equal((await f.request('/forms', { user: 'member' })).status, 200);
  assert.equal((await (await f.request('/forms', { user: 'member' })).json()).items.length, 0);
  const other = await createForm(f); const second = await authorize(f, other); f.advance(3900001);
  assert.equal((await complete(f, second)).status, 410);
});

test('CSV exports UTF8 BOM, quotes, formulas safely and retains removed schema fields', async () => {
  const f = fixture(); const form = await createForm(f, { access: 'public', fields: [{ ...textField, label: '=危险标题' }] });
  const created = await authorize(f, form, { answers: { name: '=HYPERLINK("https://attacker.test")' }, submitterName: '+危险称呼' }, { user: undefined }); await complete(f, created);
  const updated = await f.request(`/admin/forms/${form.id}`, { method: 'POST', user: 'owner', body: { revision: form.revision, fields: [{ id: 'other', type: 'text', label: '另一个字段' }] } }); assert.equal(updated.status, 200);
  const res = await f.request(`/admin/forms/${form.id}/export`, { user: 'owner' }); assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.arrayBuffer()); assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  const csv = new TextDecoder().decode(bytes); assert.match(csv, /'=HYPERLINK/); assert.match(csv, /'\+危险称呼/); assert.match(csv, /'=危险标题/); assert.match(csv, /另一个字段/);
  assert.equal((await f.request(`/admin/forms/${form.id}/export`, { user: 'member' })).status, 403);
});

test('CSV separates fields whose type changes under the same id and retains original answers', async () => {
  const f = fixture(); const form = await createForm(f, { fields: [textField] });
  const first = await authorize(f, form, { answers: { name: '必须保留的旧文字' } }); await complete(f, first);
  const updated = await f.request(`/admin/forms/${form.id}`, { method: 'POST', user: 'owner', body: { revision: form.revision, fields: [{ ...fileField, id: 'name', label: '名称' }] } }); assert.equal(updated.status, 200);
  const res = await f.request(`/admin/forms/${form.id}/export`, { user: 'owner' }); const csv = await res.text();
  assert.match(csv, /必须保留的旧文字/); assert.match(csv, /名称（版本 1）/); assert.match(csv, /名称（版本 2）/); assert.equal(csv.includes('[name]'), false);
});

test('staff can delete a form and its index and data are purged', async () => {
  const f = fixture(); const form = await createForm(f);
  assert.equal((await f.request(`/admin/forms/${form.id}`, { method: 'DELETE', user: 'member' })).status, 403);
  assert.equal((await f.request(`/admin/forms/${form.id}`, { method: 'DELETE', user: 'owner' })).status, 200);
  assert.equal((await f.request(`/admin/forms/${form.id}`, { user: 'owner' })).status, 404);
  const list = await (await f.request('/admin/forms', { user: 'owner' })).json();
  assert.ok(!list.items.some((item) => item.id === form.id));

  const form2 = await createForm(f);
  assert.equal((await f.request(`/admin/forms/${form2.id}/delete`, { method: 'POST', user: 'owner' })).status, 200);
  assert.equal((await f.request(`/admin/forms/${form2.id}`, { user: 'owner' })).status, 404);
});
