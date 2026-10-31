import product from '../../product.json' with { type: 'json' };
// Explicit synthetic production acceptance. Importing is inert; --run is required.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { initializeOwner, writePrivate } from './bootstrap-owner.mjs';
import { LiveClient, recordCheck } from './live-client.mjs';
import { privateFile } from '../private/files.mjs';

const origin = product.origin;
const statePath = privateFile('.env.platform-test.local.json');
const reportPath = new URL('../../docs/platform-operations.assets/live-verification.json', import.meta.url);
const fixturePath = new URL('../../tests/fixtures/collection-probe.txt', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const credentials = () => ({ qq: String(randomInt(100000000000, 999999999999)), studentId: `TEST${randomBytes(6).toString('hex').toUpperCase()}`, realName: '合成验收成员', password: randomBytes(20).toString('base64url') });
function storageUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://fgws3-ocloud.ihep.ac.cn') throw new Error('Unexpected object-storage origin');
  return url;
}
export async function verifyLive() {
  const checks = [], startedAt = new Date().toISOString();
  const check = (name, pass, details) => recordCheck(checks, name, pass, details);
  const { client: owner, access, user: ownerUser } = await initializeOwner();
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; state = { runs: [] }; }
  const run = { label: `验收测试 ${startedAt.slice(0, 16)}`, members: [credentials(), credentials()], forms: [], submissions: [], createdAt: startedAt, status: 'running' };
  state.runs.push(run);
  const save = () => writePrivate(statePath, JSON.stringify(state, null, 2) + '\n');
  await save();
  try {
    const guest = new LiveClient(origin), members = [new LiveClient(origin), new LiveClient(origin)];
    check('anonymous admin denied', (await guest.call('/admin/forms')).status === 401);
    check('cross-origin POST denied', (await guest.call('/auth/login', { method: 'POST', body: {}, headers: { Origin: 'https://example.invalid' } })).status === 403);
    check('public auth configuration', (await guest.call('/auth/config', { expected: 200 })).body.emailDeliveryEnabled === false);
    const legacyStatus = await fetch(`${origin}/api/collection/config`, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    check('legacy shared-password API retired', legacyStatus.status === 410);
    for (let index = 0; index < members.length; index++) {
      const info = run.members[index];
      const result = await members[index].call('/auth/register', { method: 'POST', body: { ...info, nickname: `验收成员${index + 1}` }, expected: 201 });
      info.id = result.body.user.id; info.revision = result.body.user.revision; await save();
      const login = await members[index].call('/auth/login', { method: 'POST', body: { studentId: info.studentId, password: info.password }, expected: 200 });
      check(`member ${index + 1} password-only session`, login.body.user.role === 'user' && !login.body.mfaRequired && !login.body.enrollmentRequired);
      check(`member ${index + 1} student identity complete`, login.body.user.studentId === info.studentId && login.body.user.realName === info.realName && login.body.user.profileComplete && !login.body.profileRequired && !login.body.user.identityVerified);
    }
    const duplicateStudent = credentials();
    check('student number uniqueness ignores case', (await guest.call('/auth/register', { method: 'POST', body: { ...duplicateStudent, studentId: run.members[0].studentId.toLowerCase() } })).status === 409);
    check('QQ contact remains unique', (await guest.call('/auth/register', { method: 'POST', body: { ...duplicateStudent, qq: run.members[0].qq } })).status === 409);
    check('QQ is not a normal login identifier', (await guest.call('/auth/login', { method: 'POST', body: { qq: run.members[0].qq, password: run.members[0].password } })).status === 400);
    const studentCaseLogin = new LiveClient(origin);
    check('student login normalizes letter case', (await studentCaseLogin.call('/auth/login', { method: 'POST', body: { studentId: run.members[0].studentId.toLowerCase(), password: run.members[0].password } })).status === 200);
    await studentCaseLogin.call('/auth/logout', { method: 'POST', body: {}, expected: 200 });
    const cannotVerifySelf = await members[0].call('/auth/profile', { method: 'POST', body: { revision: run.members[0].revision, identityVerified: true }, expected: 200 });
    run.members[0].revision = cannotVerifySelf.body.user.revision;
    check('member cannot self-verify identity', cannotVerifySelf.body.user.identityVerified === false);
    check('member cannot change bound student number', (await members[0].call('/auth/profile', { method: 'POST', body: { revision: run.members[0].revision, studentId: duplicateStudent.studentId, realName: run.members[0].realName } })).status === 403);
    const verifiedMember = await owner.call(`/admin/users/${run.members[0].id}`, { method: 'POST', body: { revision: run.members[0].revision, identityVerified: true }, expected: 200 });
    run.members[0].revision = verifiedMember.body.user.revision;
    check('owner can explicitly verify member identity', verifiedMember.body.user.identityVerified === true);
    await save();
    async function form(suffix, values) {
      const result = await owner.call('/admin/forms', { method: 'POST', body: { title: `${run.label} · ${suffix}`, description: '自动化验收用合成数据，不含真实成员资料。验收后归档。', status: 'published', maxSubmissions: 30, maxPerUser: 5, ...values }, expected: 201 });
      run.forms.push(result.body.form); await save(); return result.body.form;
    }
    async function submit(client, form, answers, file = false, extra = {}) {
      const bytes = await readFile(fixturePath);
      const created = await client.call(`/forms/${form.id}/submissions`, { method: 'POST', body: { answers, files: file ? [{ fieldId: 'upload', name: 'collection-probe.txt', size: bytes.length, type: 'text/plain' }] : [], ...extra }, expected: 201 });
      const item = { id: created.body.submission.id, formId: form.id, receiptToken: created.body.receiptToken };
      run.submissions.push(item); await save();
      for (const upload of created.body.uploads) {
        const put = await fetch(storageUrl(upload.url), { method: upload.method, headers: upload.headers, body: bytes, redirect: 'error', signal: AbortSignal.timeout(60000) });
        check('private object direct upload', put.ok);
      }
      const completed = await client.call(`/submissions/${item.id}/complete`, { method: 'POST', body: { receiptToken: item.receiptToken }, expected: 200 });
      check(file ? 'attachment frozen and confirmed' : 'information-only submission confirmed', completed.body.submission.status !== 'uploading');
      if (created.body.submission.userId) check('account confirmation does not echo identity or answers', completed.body.submission.submitterIdentity === undefined && completed.body.submission.submitterName === undefined && completed.body.submission.answers === undefined);
      check('completion idempotent', (await client.call(`/submissions/${item.id}/complete`, { method: 'POST', body: { receiptToken: item.receiptToken }, expected: 200 })).body.submission.id === item.id);
      return { ...item, submission: { ...created.body.submission, ...completed.body.submission } };
    }
    async function download(client, item, isGuest = false) {
      const result = await client.call(`/submissions/${item.id}/files/${item.submission.files[0].id}/download`, { method: 'POST', body: {}, headers: isGuest ? { 'X-Receipt-Token': item.receiptToken } : {}, expected: 200 });
      const descriptor = result.body.download;
      const response = await fetch(storageUrl(descriptor.url), { headers: descriptor.headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      check(isGuest ? 'guest receipt attachment hash' : 'member attachment hash', response.ok && hash(bytes) === hash(await readFile(fixturePath)), { bytes: bytes.length, sha256: hash(bytes) });
    }
    const infoForm = await form('纯信息', { access: 'members', allowEdit: true, fields: [{ id: 'note', type: 'text', label: '说明', required: true }] });
    check('member-only form hides from guest', (await guest.call(`/forms/${infoForm.id}`)).status === 401);
    check('required fields checked on server', (await members[0].call(`/forms/${infoForm.id}/submissions`, { method: 'POST', body: { answers: {}, files: [] } })).status === 400);
    const information = await submit(members[0], infoForm, { note: '=1+1' });
    check('record isolation between members', (await members[1].call(`/submissions/${information.id}`)).status === 404);
    check('member receipt cannot bypass account identity', (await guest.call(`/submissions/${information.id}`, { headers: { 'X-Receipt-Token': information.receiptToken } })).status === 404);
    const csv = await owner.call(`/admin/forms/${infoForm.id}/export`, { raw: true, expected: 200 });
    check('CSV formula protection', csv.body.includes("'=1+1"));
    const mixed = await form('混合材料', { access: 'members', allowEdit: true, requireReview: true, fields: [{ id: 'note', type: 'text', label: '材料说明', required: true }, { id: 'upload', type: 'file', label: '附件', required: true, extensions: ['txt'] }] });
    const submission = await submit(members[0], mixed, { note: '初始说明' }, true);
    await download(members[0], submission);
    const snapshot = (await members[0].call(`/submissions/${submission.id}`, { expected: 200 })).body.submission.submitterIdentity;
    check('member record carries verified identity snapshot', snapshot.studentId === run.members[0].studentId && snapshot.realName === run.members[0].realName && snapshot.identityVerified === true);
    const corrected = await owner.call(`/admin/users/${run.members[0].id}`, { method: 'POST', body: { revision: run.members[0].revision, realName: '核对后的合成成员' }, expected: 200 });
    run.members[0].revision = corrected.body.user.revision; await save();
    const changedDetails = (await owner.call(`/submissions/${submission.id}`, { expected: 200 })).body;
    check('name correction revokes verification and keeps historical snapshot', corrected.body.user.identityVerified === false && changedDetails.submitterContact.realName === '核对后的合成成员' && changedDetails.submission.submitterIdentity.realName === run.members[0].realName);
    const identityCsv = (await owner.call(`/admin/forms/${mixed.id}/export`, { raw: true, expected: 200 })).body;
    check('CSV includes student number and historical real name', identityCsv.includes('学号') && identityCsv.includes(run.members[0].studentId) && identityCsv.includes(run.members[0].realName) && !identityCsv.includes('核对后的合成成员'));
    const edited = await members[0].call(`/submissions/${submission.id}/edit`, { method: 'POST', body: { answers: { note: '已修正说明' }, revision: submission.submission.revision }, expected: 200 });
    const reviewed = await owner.call(`/submissions/${submission.id}/review`, { method: 'POST', body: { status: 'accepted', comment: '合成验收通过', revision: edited.body.submission.revision }, expected: 200 });
    const persisted = await members[0].call(`/submissions/${submission.id}`, { expected: 200 });
    check('edit and review persist', reviewed.body.submission.status === 'accepted' && persisted.body.submission.answers.note === '已修正说明' && persisted.body.submission.status === 'accepted');
    const usage = (await owner.call(`/admin/forms/${mixed.id}/submissions`, { expected: 200 })).body.usage;
    check('authorization and original attachment usage', usage.authorizations === 1 && usage.completed === 1 && usage.fileBytes === (await readFile(fixturePath)).length);
    check('member mutation requires CSRF', (await members[0].call(`/submissions/${submission.id}/edit`, { method: 'POST', headers: { 'X-CSRF-Token': '' }, body: { answers: { note: 'blocked' }, revision: persisted.body.submission.revision } })).status === 403);
    const publicFile = await form('公开附件', { access: 'public', fields: [{ id: 'upload', type: 'file', label: '文件', required: true, extensions: ['txt'] }] });
    const publicItem = await submit(guest, publicFile, {}, true, { submitterName: '验收访客' });
    check('guest receipt required', (await guest.call(`/submissions/${publicItem.id}`)).status === 404);
    check('guest receipt read', (await guest.call(`/submissions/${publicItem.id}`, { headers: { 'X-Receipt-Token': publicItem.receiptToken } })).status === 200);
    await download(guest, publicItem, true);
    const updated = await owner.call(`/admin/forms/${infoForm.id}`, { method: 'POST', body: { ...infoForm, status: 'closed' }, expected: 200 });
    run.forms[0] = updated.body.form;
    check('closed form rejects new authorizations', (await members[0].call(`/forms/${infoForm.id}/submissions`, { method: 'POST', body: { answers: { note: 'late' }, files: [] } })).status === 409);
    const promoted = await owner.call(`/admin/users/${run.members[1].id}`, { method: 'POST', body: { revision: run.members[1].revision, role: 'admin' }, expected: 200 });
    check('role promotion revokes old session', (await members[1].call('/auth/session')).status === 401);
    const pending = await members[1].call('/auth/login', { method: 'POST', body: { studentId: run.members[1].studentId, password: run.members[1].password }, expected: 200 });
    check('new administrator must enroll TOTP', pending.body.enrollmentRequired === true && (await members[1].call('/admin/forms')).status === 403);
    const disabled = await owner.call(`/admin/users/${run.members[1].id}`, { method: 'POST', body: { revision: promoted.body.user.revision, role: 'user', status: 'disabled' }, expected: 200 });
    run.members[1].revision = disabled.body.user.revision;
    check('disabled account cannot log in', (await members[1].call('/auth/login', { method: 'POST', body: { studentId: run.members[1].studentId, password: run.members[1].password } })).status === 401);
    check('owner cannot be downgraded', (await owner.call(`/admin/users/${ownerUser.id}`, { method: 'POST', body: { revision: ownerUser.revision, role: 'user' } })).status === 403);
    const legacy = await owner.call('/admin/legacy/submissions', { expected: 200 });
    check('historical collection visible through unified identity', Array.isArray(legacy.body.items));
    const existingTemplates = new Set((await owner.call('/admin/forms', { expected: 200 })).body.items.map(form => form.title));
    let usableTemplates = 0;
    for (const [suffix, values] of [
      ['信息登记模板', { fields: [{ id: 'topic', type: 'text', label: '登记内容', required: true }, { id: 'note', type: 'textarea', label: '补充说明' }] }],
      ['文件收集模板', { fields: [{ id: 'upload', type: 'file', label: '提交文件', required: true }] }],
      ['信息与材料模板', { requireReview: true, fields: [{ id: 'topic', type: 'text', label: '材料名称', required: true }, { id: 'note', type: 'textarea', label: '说明' }, { id: 'upload', type: 'file', label: '附件', required: true }] }],
    ]) {
      if (!existingTemplates.has(suffix)) await owner.call('/admin/forms', { method: 'POST', body: { title: suffix, description: '可修改后发布，也可复制后用于新的收集。', status: 'draft', access: 'members', allowEdit: true, maxSubmissions: 100, maxPerUser: 1, ...values }, expected: 201 });
      usableTemplates++;
    }
    check('three reusable draft templates available', usableTemplates === 3);
    run.status = 'api_verified'; await save();
  } catch (error) {
    run.status = 'failed'; await save(); throw error;
  } finally {
    await mkdir(new URL('../../docs/platform-operations.assets', import.meta.url), { recursive: true });
    await writeFile(reportPath, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), target: origin, synthetic: true, status: run.status, checks }, null, 2) + '\n');
    await owner.call('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  }
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--run')) console.log(JSON.stringify({ status: 'inert', action: 'Pass --run after production deployment.' }));
  else try { await verifyLive(); } catch (error) { console.error(JSON.stringify({ status: 'failed', message: String(error.message).replace(/https?:\/\/\S+/g, '[url]') })); process.exitCode = 1; }
}
