import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformHandler } from '../src/server/platform-app.mjs';
import { totpCode } from '../src/server/platform-totp.mjs';
import { memoryBlob, memoryGateway, requestClient, testEnvironment } from './helpers/platform-fixtures.mjs';

async function fixture() {
  const data = await testEnvironment(); const store = memoryBlob(), gateway = memoryGateway();
  let clock = 1_800_000_000_000;
  const handle = createPlatformHandler({ getStore: () => store, getGateway: () => gateway, now: () => clock });
  const client = () => requestClient(handle, data.env), owner = client();
  let result = await owner.call('/auth/login', { method: 'POST', body: { studentId: data.env.PLATFORM_OWNER_STUDENT_ID, password: data.password } });
  assert.equal(result.status, 200); assert.equal(result.body.passwordChangeRequired, true);
  assert.equal((await owner.call('/admin/forms')).status, 403);
  const ownerPassword = data.password + '-new';
  assert.equal((await owner.call('/auth/password', { method: 'POST', body: { currentPassword: data.password, newPassword: ownerPassword } })).status, 200);
  result = await owner.call('/auth/login', { method: 'POST', body: { studentId: data.env.PLATFORM_OWNER_STUDENT_ID, password: ownerPassword } });
  assert.equal(result.status, 200); assert.equal(result.body.enrollmentRequired, true);
  const setup = await owner.call('/auth/totp/setup', { method: 'POST', body: { password: ownerPassword } });
  assert.equal(setup.status, 200);
  result = await owner.call('/auth/totp/confirm', { method: 'POST', body: { code: totpCode(setup.body.secret, Math.floor(clock / 30000)) } });
  assert.equal(result.status, 200); assert.equal(result.body.recoveryCodes.length, 10);
  const ownerState = await owner.call('/auth/session');
  assert.equal((await owner.call('/auth/profile', { method: 'POST', body: { studentId: 'TESTOWNER01', realName: '测试所有者', revision: ownerState.body.user.revision } })).status, 200);
  assert.equal((await owner.call('/admin/forms')).status, 200);
  async function member(qq, nickname) {
    const user = client(); const registered = await user.call('/auth/register', { method: 'POST', body: { qq, nickname, studentId: `TEST${qq}`, realName: nickname, password: data.password } });
    assert.equal(registered.status, 201);
    assert.equal((await user.call('/auth/login', { method: 'POST', body: { studentId: `TEST${qq}`, password: data.password } })).status, 200);
    return { client: user, user: registered.body.user };
  }
  return { ...data, store, gateway, owner, client, member, advance: (ms) => { clock += ms; } };
}

test('real identity and form services compose: private mixed submissions, immutable download, edit, review and CSV', async () => {
  const f = await fixture(); const a = await f.member('100002', '成员甲'), b = await f.member('100003', '成员乙');
  const formResult = await f.owner.call('/admin/forms', { method: 'POST', body: {
    title: '混合表单', description: '合成测试', status: 'published', access: 'members', allowEdit: true, requireReview: true, maxPerUser: 2,
    fields: [{ id: 'note', type: 'text', label: '说明', required: true }, { id: 'upload', type: 'file', label: '附件', required: true, maxFiles: 1, extensions: ['txt'] }],
  } });
  assert.equal(formResult.status, 201); const form = formResult.body.form;
  const missingCsrf = await a.client.call(`/forms/${form.id}/submissions`, { method: 'POST', headers: { 'X-CSRF-Token': '' }, body: { answers: { note: 'hello' }, files: [] } });
  assert.equal(missingCsrf.status, 403);
  const created = await a.client.call(`/forms/${form.id}/submissions`, { method: 'POST', body: { answers: { note: '=unsafe spreadsheet formula' }, files: [{ fieldId: 'upload', name: 'fixture.txt', size: 7, type: 'text/plain' }] } });
  assert.equal(created.status, 201); const id = created.body.submission.id;
  f.gateway.upload(f.gateway.uploads.at(-1), Buffer.from('fixture'));
  const completed = await a.client.call(`/submissions/${id}/complete`, { method: 'POST', body: { receiptToken: created.body.receiptToken } });
  assert.equal(completed.status, 200); assert.equal(completed.body.submission.status, 'pending_review');
  assert.equal((await b.client.call(`/submissions/${id}`)).status, 404);
  assert.equal((await f.client().call(`/submissions/${id}`, { headers: { 'X-Receipt-Token': created.body.receiptToken } })).status, 404);
  assert.equal((await a.client.call('/me/submissions')).body.items.length, 1);
  assert.equal((await b.client.call('/me/submissions')).body.items.length, 0);
  const fileId = created.body.submission.files[0].id;
  assert.equal((await a.client.call(`/submissions/${id}/files/${fileId}/download`, { method: 'POST', body: {} })).status, 200);
  // Reusing the original PUT can modify staging but cannot affect the published final object.
  f.gateway.upload(f.gateway.uploads.at(-1), Buffer.from('changed'));
  assert.equal((await a.client.call(`/submissions/${id}/files/${fileId}/download`, { method: 'POST', body: {} })).status, 200);
  const csv = await f.owner.call(`/admin/forms/${form.id}/export`, { raw: true });
  assert.equal(csv.status, 200); assert.ok(csv.body.includes("'=unsafe spreadsheet formula"));
  const edited = await a.client.call(`/submissions/${id}/edit`, { method: 'POST', body: { answers: { note: '修正说明' }, revision: completed.body.submission.revision } });
  assert.equal(edited.status, 200);
  const reviewed = await f.owner.call(`/submissions/${id}/review`, { method: 'POST', body: { status: 'accepted', comment: '通过', revision: edited.body.submission.revision } });
  assert.equal(reviewed.status, 200);
  assert.equal((await a.client.call(`/submissions/${id}`)).body.submission.status, 'accepted');
  const listed = await f.owner.call(`/admin/forms/${form.id}/submissions`);
  assert.equal(listed.body.usage.authorizations, 1); assert.equal(listed.body.usage.completed, 1); assert.equal(listed.body.usage.fileBytes, 7);
  assert.ok(!JSON.stringify(listed.body).includes('finalObjectKey')); assert.ok(!JSON.stringify(listed.body).includes('receiptHash'));
});

test('real identity permits anonymous public submissions and receipt downloads while preserving signed-in CSRF checks', async () => {
  const f = await fixture(); const guest = f.client();
  const result = await f.owner.call('/admin/forms', { method: 'POST', body: {
    title: '公开文件收集', status: 'published', access: 'public',
    fields: [{ id: 'file', type: 'file', label: '附件', required: true, extensions: ['txt'] }],
  } });
  assert.equal(result.status, 201); const form = result.body.form;
  const created = await guest.call(`/forms/${form.id}/submissions`, { method: 'POST', body: { answers: {}, files: [{ fieldId: 'file', name: 'public.txt', size: 7, type: 'text/plain' }], submitterName: '匿名合成测试' } });
  assert.equal(created.status, 201);
  f.gateway.upload(f.gateway.uploads.at(-1), Buffer.from('fixture'));
  const id = created.body.submission.id, token = created.body.receiptToken;
  const complete = await guest.call(`/submissions/${id}/complete`, { method: 'POST', body: { receiptToken: token } });
  assert.equal(complete.status, 200);
  assert.equal((await guest.call(`/submissions/${id}`)).status, 404);
  assert.equal((await guest.call(`/submissions/${id}`, { headers: { 'X-Receipt-Token': token } })).status, 200);
  const fileId = complete.body.submission.files[0].id;
  assert.equal((await guest.call(`/submissions/${id}/files/${fileId}/download`, { method: 'POST', body: {}, headers: { 'X-Receipt-Token': token } })).status, 200);
  assert.equal((await guest.call(`/submissions/${id}/files/${fileId}/download`, { method: 'POST', body: {} })).status, 404);
});

test('role promotion and suspension revoke existing sessions; admin can manage forms and look up users but cannot delete forms', async () => {
  const f = await fixture(); const member = await f.member('100002', '待提升成员');
  const promoted = await f.owner.call(`/admin/users/${member.user.id}`, { method: 'POST', body: { revision: member.user.revision, role: 'admin' } });
  assert.equal(promoted.status, 200);
  assert.equal((await member.client.call('/auth/session')).status, 401);
  const login = await member.client.call('/auth/login', { method: 'POST', body: { studentId: member.user.studentId, password: f.password } });
  assert.equal(login.body.enrollmentRequired, false);
  assert.equal((await member.client.call('/admin/forms')).status, 200);
  const createdForm = await member.client.call('/admin/forms', { method: 'POST', body: { title: '管理员新建表', status: 'draft', access: 'members', fields: [{ id: 'note', type: 'text', label: '说明' }] } });
  assert.equal(createdForm.status, 201);
  assert.equal((await member.client.call(`/admin/forms/${createdForm.body.form.id}/delete`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await member.client.call('/admin/users')).status, 200);
  const disabled = await f.owner.call(`/admin/users/${member.user.id}`, { method: 'POST', body: { revision: promoted.body.user.revision, status: 'disabled' } });
  assert.equal(disabled.status, 200);
  assert.equal((await member.client.call('/auth/session')).status, 401);
  const ownerSession = await f.owner.call('/auth/session');
  assert.equal((await f.owner.call(`/admin/users/${ownerSession.body.user.id}`, { method: 'POST', body: { revision: ownerSession.body.user.revision, role: 'user' } })).status, 403);
});

test('student login, owner verification and submission identity preserve a private historical record', async () => {
  const f = await fixture(); const member = await f.member('100002', '同名测试成员');
  const qqLogin = await f.client().call('/auth/login', { method: 'POST', body: { qq: member.user.qq, password: f.password } });
  assert.equal(qqLogin.status, 400);
  const lowerCaseLogin = await f.client().call('/auth/login', { method: 'POST', body: { studentId: member.user.studentId.toLowerCase(), password: f.password } });
  assert.equal(lowerCaseLogin.status, 200);
  assert.equal((await f.client().call('/auth/login', { method: 'POST', body: { qq: member.user.qq, password: f.password } })).status, 400);
  const verification = await f.owner.call(`/admin/users/${member.user.id}`, { method: 'POST', body: { revision: member.user.revision, identityVerified: true } });
  assert.equal(verification.status, 200); assert.equal(verification.body.user.identityVerified, true);
  const createdForm = await f.owner.call('/admin/forms', { method: 'POST', body: { title: '自动关联身份', status: 'published', access: 'members', fields: [{ id: 'note', type: 'text', label: '说明' }] } });
  assert.equal(createdForm.status, 201);
  const created = await member.client.call(`/forms/${createdForm.body.form.id}/submissions`, { method: 'POST', body: { answers: { note: '无需再填姓名学号' }, files: [], submitterIdentity: { studentId: 'FORGED123', realName: '伪造身份', identityVerified: false } } });
  assert.equal(created.status, 201);
  const completed = await f.client().call(`/submissions/${created.body.submission.id}/complete`, { method: 'POST', body: { receiptToken: created.body.receiptToken } });
  assert.equal(completed.status, 200); assert.equal(completed.body.submission.submitterIdentity, undefined); assert.equal(completed.body.submission.submitterName, undefined); assert.equal(completed.body.submission.answers, undefined);
  let details = await member.client.call(`/submissions/${created.body.submission.id}`);
  assert.deepEqual(details.body.submission.submitterIdentity, { studentId: member.user.studentId, realName: '同名测试成员', identityVerified: true });
  assert.equal(details.body.submitterContact, undefined);
  const changed = await f.owner.call(`/admin/users/${member.user.id}`, { method: 'POST', body: { revision: verification.body.user.revision, realName: '核对后测试姓名' } });
  assert.equal(changed.status, 200); assert.equal(changed.body.user.identityVerified, false);
  details = await f.owner.call(`/submissions/${created.body.submission.id}`);
  assert.equal(details.body.submitterContact.realName, '核对后测试姓名');
  assert.equal(details.body.submission.submitterIdentity.realName, '同名测试成员');
  const csv = await f.owner.call(`/admin/forms/${createdForm.body.form.id}/export`, { raw: true });
  assert.equal(csv.status, 200); assert.ok(csv.body.includes('学号')); assert.ok(csv.body.includes(member.user.studentId)); assert.ok(csv.body.includes('同名测试成员')); assert.ok(!csv.body.includes('核对后测试姓名'));
  const publicForms = await f.client().call('/forms');
  assert.ok(!JSON.stringify(publicForms.body).includes(member.user.studentId));
});
