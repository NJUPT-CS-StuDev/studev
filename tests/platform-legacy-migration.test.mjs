import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { inventoryLegacy, applyLegacy } from '../scripts/platform/migrate-legacy.mjs';
import { createRepository } from '../src/server/platform-store.mjs';
import { createFormsService } from '../src/server/platform-forms.mjs';
import { memoryBlob, memoryGateway } from './helpers/platform-fixtures.mjs';

const hash = v => createHash('sha256').update(v).digest('hex');
const root = resolve('D:/Temp/codex/legacy/migration-tests');
const id = '00000000-0000-4000-a000-000000000001';
const formId = '00000000-0000-4000-a000-000000000002';
const submissionId = '00000000-0000-4000-a000-000000000003';
const sourceId = '1793400000000-00000000-0000-4000-a000-000000000004';
async function backup(t) {
  const dir = join(root, randomUUID()); await mkdir(dir, { recursive: true });
  t.after(async () => { assert.ok(resolve(dir).startsWith(root + '\\')); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
async function fixture({ bound = true } = {}) {
  const store = memoryBlob(), repo = createRepository(store, { secret: 'synthetic-migration-session-secret-123456' }), gateway = memoryGateway();
  const user = { id, qq: '10000001', nickname: '测试昵称', role: 'member', status: 'active', passwordHash: 'synthetic-password-hash', totp: { encrypted: 'synthetic-encrypted-seed', epoch: 'epoch', recoveryHashes: ['synthetic-recovery-hash'] }, securityVersion: 'preserved-security-version', createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' };
  await repo.append(`identity/users/${id}`, user);
  await repo.putNew('identity/qq/10000001.json', { id });
  if (bound) await repo.putNew(`identity/binding/${id}.json`, { studentId: 'TEST00001', realName: '测试姓名' });
  const form = await repo.append(`forms/${formId}`, { id: formId, title: '原有表单', status: 'closed', access: 'members', description: '', deadline: '', requireReview: false, allowEdit: false, maxPerUser: 1, maxSubmissions: 500, fields: [{ id: 'name', type: 'text', label: '名称' }], createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' });
  await repo.putNew(`form-index/${formId}.json`, { id: formId });
  await repo.putNew(`form-records/${submissionId}.json`, { id: submissionId, formId, submitterName: '旧表单记录', answers: { name: '材料' }, files: [], schemaSnapshot: form, createdAt: user.createdAt });
  const objectKey = `studev-submissions/club-test/staging/${sourceId}.txt`, finalObjectKey = `studev-submissions/club-test/final/${sourceId}/original`;
  const body = Buffer.from('synthetic historical attachment\n');
  gateway.upload({ objectKey, contentType: 'text/plain' }, body); await gateway.copy(objectKey, finalObjectKey);
  const entry = { id: sourceId, name: '旧提交者', contact: '仅工作人员可见', description: '历史说明', fileName: '资料.txt', fileSize: body.length, contentType: 'text/plain', objectKey, receiptHash: hash('synthetic-receipt-only'), createdAt: user.createdAt, uploadExpiresAt: 1793400300 };
  await store.setJSON(`collections/club-test/entries/${sourceId}.json`, entry);
  const head = await gateway.head(finalObjectKey);
  await store.setJSON(`collections/club-test/completed/${sourceId}.json`, { ...head, finalObjectKey, completedAt: user.createdAt });
  for (const revision of [1, 2]) await store.setJSON(`collections/club-test/reviews/${sourceId}/${String(revision).padStart(4, '0')}.json`, { revision, status: revision === 1 ? 'rejected' : 'accepted', comment: `审核 ${revision}`, reviewedAt: user.createdAt });
  const objects = {
    ...gateway,
    async fingerprint(key, etag) { const head = await gateway.head(key); assert.equal(head.etag, etag); const body = gateway.objects.get(key).body; return { size: body.length, sha256: hash(body) }; },
  };
  return { store, repo, objects, user, entry, body, finalObjectKey, config: { OSCA_PREFIX: 'studev-submissions/' } };
}

test('default inventory does not write, finds QQ binding, all metadata attachments, snapshotless indexes and missing historical indexes', async () => {
  const f = await fixture(), before = structuredClone([...f.store.values]), objectsBefore = JSON.stringify([...f.objects.objects]);
  const plan = await inventoryLegacy(f);
  assert.deepEqual([...f.store.values], before); assert.equal(JSON.stringify([...f.objects.objects]), objectsBefore);
  assert.equal(plan.report.accounts.qqOnly.length, 1); assert.equal(plan.report.accounts.qqOnly[0].studentId, 'TEST00001');
  assert.equal(plan.report.accounts.needingMapping.length, 0); assert.equal(plan.report.collections[0].reviews, 2);
  assert.equal(plan.report.attachments.storedObjects, 2); assert.equal(plan.report.attachments.bytes, f.body.length);
  assert.equal(plan.report.formIndexesWithoutSnapshots.length, 1); assert.equal(plan.report.currentSubmissionIndexesToCreate, 1);
  assert.equal(JSON.stringify(plan.report).includes('synthetic-encrypted-seed'), false);
  assert.equal(JSON.stringify(plan.report).includes('synthetic-password-hash'), false);
});

test('apply backs up every changed key first and preserves credentials/history; migrated data uses current list/export/download paths and reruns converge', async t => {
  const f = await fixture(), original = structuredClone([...f.store.values]), dir = await backup(t), plan = await inventoryLegacy(f);
  const set = f.store.setJSON;
  f.store.setJSON = async (...args) => { const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')); assert.ok(manifest.metadata.some(c => c.key === args[0])); return set(...args); };
  const result = await applyLegacy(plan, { backupDir: dir, writesStopped: true });
  f.store.setJSON = set;
  assert.equal(result.applied, true);
  const user = await f.repo.latest(`identity/users/${id}`);
  for (const key of ['id', 'passwordHash', 'totp', 'securityVersion']) assert.deepEqual(user[key], f.user[key]);
  assert.equal(user.studentId, 'TEST00001'); assert.equal(user.role, 'admin');
  assert.deepEqual(await f.repo.get(`identity/users/${id}/00000001.json`), original.find(([k]) => k.endsWith(`${id}/00000001.json`))[1]);
  const migratedId = plan.report.collections[0].items[0].submissionId, record = await f.repo.get(`form-records/${migratedId}.json`);
  assert.deepEqual(record.answers, { name: f.entry.name, contact: f.entry.contact, description: f.entry.description });
  assert.equal((await f.repo.latest(`form-events/${migratedId}`)).review.comment, '审核 2');
  assert.equal(f.objects.objects.has(f.finalObjectKey), true);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.metadata.length, plan.changes.length);
  for (const c of manifest.metadata) { const before = original.find(([key]) => key === c.key); assert.deepEqual(c.beforeBase64 ? JSON.parse(Buffer.from(c.beforeBase64, 'base64')) : null, before?.[1] ?? null); }
  const service = createFormsService({ repo: f.repo, identity: { authenticate: async () => ({ user: { id, role: 'owner' } }) }, env: { PLATFORM_ORIGIN: 'https://studev.test', OSCA_ENDPOINT: 'https://s3.test', OSCA_BUCKET: 'synthetic', OSCA_ACCESS_KEY_ID: 'synthetic', OSCA_SECRET_ACCESS_KEY: 'synthetic', OSCA_PREFIX: 'studev-submissions/' }, getGateway: () => f.objects });
  const call = (path, method = 'GET') => service.handle({ request: new Request(`https://studev.test/api/platform${path}`, { method, headers: { Origin: 'https://studev.test' } }) }, `/api/platform${path}`);
  const rows = await (await call(`/admin/forms/${record.formId}/submissions`)).json(); assert.equal(rows.items.length, 1); assert.equal(rows.items[0].status, 'accepted');
  assert.match(await (await call(`/admin/forms/${record.formId}/export`)).text(), /历史说明/);
  const downloaded = await (await call(`/submissions/${migratedId}/files/${record.files[0].id}/download`, 'POST')).json(); assert.equal(downloaded.download.fileName, '资料.txt');
  assert.equal((await (await call(`/admin/forms/${formId}/submissions`)).json()).items.length, 1);
  f.store.setJSON = set;
  const rerun = await inventoryLegacy(f); assert.equal(rerun.changes.length, 0); assert.equal(rerun.report.plannedAttachmentCopies, 0);
  await applyLegacy(rerun, { backupDir: await backup(t), writesStopped: true });
});

test('unmapped accounts and claimed student IDs block all writes; supplied owner mapping binds without dropping an account', async t => {
  const f = await fixture({ bound: false }), before = structuredClone([...f.store.values]);
  const plan = await inventoryLegacy(f); assert.equal(plan.report.accounts.needingMapping[0].userId, id);
  await assert.rejects(applyLegacy(plan, { backupDir: await backup(t), writesStopped: true }), /INVENTORY_BLOCKED/);
  assert.deepEqual([...f.store.values], before);
  const mapping = { accounts: [{ qq: f.user.qq, studentId: 'TEST00001', realName: '测试姓名' }] };
  const mapped = await inventoryLegacy({ ...f, mapping }); assert.equal(mapped.report.accounts.needingMapping.length, 0);
  await f.repo.putNew('identity/student/TEST00001.json', { id: 'another-user' });
  const conflict = await inventoryLegacy({ ...f, mapping }); assert.ok(conflict.report.blockers.some(b => b.code === 'STUDENT_CLAIM_CONFLICT'));
});

test('missing or changed completed attachment blocks apply before any production write', async t => {
  const f = await fixture(); f.objects.objects.delete(f.finalObjectKey);
  const before = structuredClone([...f.store.values]), plan = await inventoryLegacy(f);
  assert.ok(plan.report.blockers.some(b => b.code === 'COMPLETED_ATTACHMENT_MISSING'));
  await assert.rejects(applyLegacy(plan, { backupDir: await backup(t), writesStopped: true }), /INVENTORY_BLOCKED/);
  assert.deepEqual([...f.store.values], before);
});

test('source mutation or corrupt copy aborts with a durable manifest before publishing any current metadata', async t => {
  const f = await fixture(), plan = await inventoryLegacy(f), before = structuredClone([...f.store.values]);
  const copy = f.objects.copy;
  f.objects.copy = async (source, target, etag) => { await copy(source, target, etag); f.objects.objects.get(target).body = Buffer.from('corrupt'); };
  const dir = await backup(t);
  await assert.rejects(applyLegacy(plan, { backupDir: dir, writesStopped: true }), /COPIED_ATTACHMENT_MISMATCH/);
  assert.ok(await readFile(join(dir, 'manifest.json'))); assert.deepEqual([...f.store.values], before);
  const another = await fixture(), changed = await inventoryLegacy(another);
  await another.repo.put('form-index/new.json', { id: 'concurrent-writer' });
  await assert.rejects(applyLegacy(changed, { backupDir: await backup(t), writesStopped: true }), /SOURCE_KEYSET_CHANGED/);
});
