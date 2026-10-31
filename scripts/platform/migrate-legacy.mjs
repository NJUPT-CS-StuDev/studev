// Offline migration only. Default: production GET/HEAD/LIST, never application login.
// Quiesce ALL account/form/collection writes before --apply and keep them stopped
// until verification and deployment finish. Originals are retained for recovery.
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getStore } from '@edgeone/pages-blob';
import { S3Client, GetObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { normalizeStudentId, normalizeRealName } from '../../src/server/platform-identity.mjs';
import { ROSTER_SEED_2026_2027, buildRosterSnapshot, SUPPORTED_ROSTER_TERMS } from '../../src/server/platform-roster.mjs';

const ROOT = 'platform-v1/';
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = (v) => createHash('sha256').update(v).digest('hex');
const encode = (v) => Buffer.from(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uuid = (v) => { const h = sha(`studev-legacy-v1:${v}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
class MigrationError extends Error {
  constructor(code, key) { super(code); this.code = code; this.key = key; }
}
function check(condition, code, key) { if (!condition) throw new MigrationError(code, key); }
function profile(value) {
  try { return { studentId: normalizeStudentId(value.studentId), realName: normalizeRealName(value.realName) }; }
  catch { return null; }
}
function publicForm(form) {
  const { id, title, description, status, access, deadline, requireReview, allowEdit, maxPerUser, maxSubmissions, fields, revision, createdAt, updatedAt } = form;
  return { id, title, description, status, access, deadline, requireReview, allowEdit, maxPerUser, maxSubmissions, fields, revision, createdAt, updatedAt };
}
async function list(store, prefix) {
  const result = await store.list({ prefix, consistency: 'strong', paginate: true });
  check(!result.cursor, 'INCOMPLETE_BLOB_LIST', prefix);
  const keys = result.blobs.map(b => b.key).sort();
  check(new Set(keys).size === keys.length, 'DUPLICATE_BLOB_KEY', prefix);
  return keys;
}
async function read(store, key) { return store.get(key, { type: 'json', consistency: 'strong' }); }
async function bytes(store, key) {
  const value = await store.get(key, { type: 'arrayBuffer', consistency: 'strong' });
  return value === null ? null : Buffer.from(value);
}
async function scan(store) {
  const prefixes = ['platform-v1/identity/users/', 'platform-v1/identity/qq/', 'platform-v1/identity/student/', 'platform-v1/identity/binding/', 'platform-v1/forms/', 'platform-v1/form-index/', 'platform-v1/form-records/', 'platform-v1/form-events/', 'collections/'];
  const data = new Map(), lists = new Map();
  for (const prefix of prefixes) {
    const keys = await list(store, prefix); lists.set(prefix, keys);
    await parallel(keys, async key => { const value = await read(store, key); check(value !== null, 'SOURCE_DISAPPEARED', key); data.set(key, value); });
  }
  return { data, lists };
}
async function parallel(items, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (next < items.length) { const index = next++; await worker(items[index]); }
  }));
}
function latest(data, prefix) {
  const revisions = [...data.keys()].filter(k => k.startsWith(`${prefix}/`) && /^\d{8}\.json$/.test(k.slice(prefix.length + 1))).sort();
  const revision = revisions.length ? data.get(revisions.at(-1)) : null;
  const current = data.get(`${prefix}/current.json`);
  check(!current || !revision || same(current, revision), 'CURRENT_REVISION_MISMATCH', prefix);
  return current || revision;
}

/** Mapping JSON: { accounts: [{ userId (or qq), studentId, realName }] }.
 * Explicit mappings resolve ambiguous evidence; they never steal student claims.
 * The returned plan contains private data; only report is safe to publish locally.
 */
export async function inventoryLegacy({ store, objects, config = {}, mapping = { accounts: [] }, ownerProfile, now = () => new Date().toISOString() }) {
  check(Array.isArray(mapping.accounts), 'INVALID_MAPPING');
  const snapshot = await scan(store), { data } = snapshot;
  const users = [...new Set([...data.keys()].map(k => /^platform-v1\/identity\/users\/([^/]+)\//.exec(k)?.[1]).filter(Boolean))].map(id => {
    check(uuidPattern.test(id), 'INVALID_USER_ID', id);
    const user = latest(data, `${ROOT}identity/users/${id}`);
    check(user?.id === id && Number.isSafeInteger(user.revision), 'INVALID_USER', id);
    return user;
  });
  const report = { schemaVersion: 1, checkedAt: now(), productionDataModified: false, applied: false,
    accounts: { total: users.length, roleChanges: users.filter(u => u.role === 'member').length, bindingRecords: [...data.keys()].filter(k => k.startsWith(`${ROOT}identity/binding/`)).length, qqOnly: [], needingMapping: [] },
    collections: [], formIndexesWithoutSnapshots: [], currentSubmissionIndexesToCreate: 0,
    attachments: { scope: 'Every staging/final key referenced by collection metadata; bucket-wide listing is not required or attempted.', referenced: 0, bytes: 0, storedObjects: 0, storedBytes: 0, retainedOriginalObjects: [] }, blockers: [] };
  const writes = new Map(), copies = [];
  const block = (code, key) => report.blockers.push({ code, key });
  function put(key, value) {
    if (writes.has(key)) check(same(writes.get(key).value, value), 'DUPLICATE_TARGET', key);
    writes.set(key, { key, value });
  }
  function putNew(key, value) {
    const existing = data.get(key);
    if (existing) check(same(existing, value), 'TARGET_COLLISION', key);
    put(key, value);
  }
  const mapped = new Map();
  for (const entry of mapping.accounts) {
    const matches = users.filter(u => entry.userId ? u.id === entry.userId : u.qq === entry.qq);
    check(matches.length === 1 && profile(entry), 'INVALID_ACCOUNT_MAPPING');
    check(!mapped.has(matches[0].id), 'DUPLICATE_ACCOUNT_MAPPING', matches[0].id);
    mapped.set(matches[0].id, profile(entry));
  }
  const claims = new Map(); const updatedUsers = [];
  for (const user of users) {
    const evidence = [];
    const candidate = (value, source) => { const p = profile(value || {}); if (p) evidence.push({ ...p, source }); };
    candidate(user, 'account');
    if (user.role === 'owner' && ownerProfile) candidate(ownerProfile, 'owner-profile');
    for (const [key, value] of data) {
      if (key.startsWith(`${ROOT}identity/binding/${user.id}/`) || key === `${ROOT}identity/binding/${user.id}.json`) candidate(value, 'binding');
      if (key.startsWith(`${ROOT}identity/student/`) && value.id === user.id) candidate({ studentId: key.slice(`${ROOT}identity/student/`.length, -5), realName: user.realName }, 'student-index');
    }
    for (const seed of ROSTER_SEED_2026_2027) if (seed.qq === user.qq) candidate(seed, 'roster');
    for (const record of data.values()) if (record.userId === user.id) candidate(record.submitterIdentity, 'submission');
    const unique = [...new Map(evidence.map(p => [JSON.stringify([p.studentId, p.realName]), p])).values()];
    const selected = mapped.get(user.id) || (unique.length === 1 ? profile(unique[0]) : null);
    const complete = profile(user);
    if (!selected) {
      const row = { userId: user.id, qq: user.qq, reason: unique.length ? 'conflicting-records' : 'missing-student-profile', candidates: unique };
      report.accounts.needingMapping.push(row); block('ACCOUNT_MAPPING_REQUIRED', user.id);
    }
    if (!complete) report.accounts.qqOnly.push({ userId: user.id, qq: user.qq, bindable: Boolean(selected), ...(selected ? selected : {}), evidence: unique });
    if (!selected) { updatedUsers.push(user); continue; }
    if (user.studentId && normalizeStudentId(user.studentId) !== selected.studentId) block('MAPPING_CHANGES_EXISTING_STUDENT', user.id);
    const studentKey = `${ROOT}identity/student/${selected.studentId}.json`, claim = data.get(studentKey);
    if ((claim && claim.id !== user.id) || (claims.has(selected.studentId) && claims.get(selected.studentId) !== user.id)) block('STUDENT_CLAIM_CONFLICT', user.id);
    claims.set(selected.studentId, user.id);
    if (!claim) putNew(studentKey, { id: user.id });
    const role = user.role === 'member' ? 'admin' : user.role;
    if (!['owner', 'admin', 'user'].includes(role)) block('INVALID_ROLE', user.id);
    const changed = user.studentId !== selected.studentId || user.realName !== selected.realName || role !== user.role;
    // Same UID, password, encrypted TOTP, security version and immutable history.
    const next = changed ? { ...user, ...selected, role, revision: user.revision + 1 } : user;
    if (changed) putNew(`${ROOT}identity/users/${user.id}/${String(next.revision).padStart(8, '0')}.json`, next);
    put(`${ROOT}identity/users/${user.id}/current.json`, next);
    updatedUsers.push(next);
  }
  const rosterTime = updatedUsers.map(u => u.updatedAt || u.createdAt).filter(Boolean).sort().at(-1) || '1970-01-01T00:00:00.000Z';
  for (const term of SUPPORTED_ROSTER_TERMS) put(`${ROOT}roster/${term}.json`, buildRosterSnapshot(updatedUsers, term, rosterTime));
  const formKeys = [...data.keys()].filter(k => k.startsWith(`${ROOT}form-index/`));
  for (const key of formKeys) {
    const index = data.get(key), form = latest(data, `${ROOT}forms/${index.id}`);
    if (!uuidPattern.test(index.id) || form?.id !== index.id) { block('FORM_MISSING', key); continue; }
    if (!index.form || !same(index.form, publicForm(form))) {
      report.formIndexesWithoutSnapshots.push({ key, formId: index.id, revision: form.revision });
      put(key, { id: index.id, form: publicForm(form) });
    }
    put(`${ROOT}forms/${form.id}/current.json`, form);
  }
  // Old production forms predate the per-form index; otherwise their historical
  // submissions would disappear from today's admin list and CSV export.
  for (const [key, record] of data) if (key.startsWith(`${ROOT}form-records/`)) {
    check(uuidPattern.test(record.id) && uuidPattern.test(record.formId), 'INVALID_FORM_RECORD', key);
    const indexKey = `${ROOT}form-submissions/${record.formId}/${record.id}.json`;
    if (!await read(store, indexKey)) { putNew(indexKey, { id: record.id }); report.currentSubmissionIndexesToCreate++; }
  }
  for (const prefix of [...new Set([...data.keys()].map(k => /^(platform-v1\/form-events\/[^/]+)\//.exec(k)?.[1]).filter(Boolean))]) put(`${prefix}/current.json`, latest(data, prefix));

  const collectionIds = [...new Set([...data.keys()].map(k => /^collections\/([^/]+)\//.exec(k)?.[1]).filter(Boolean))].sort();
  for (const collectionId of collectionIds) {
    check(/^[a-z0-9][a-z0-9-]{0,63}$/.test(collectionId), 'INVALID_COLLECTION_ID');
    const prefix = `collections/${collectionId}/`, objectPrefix = `${config.OSCA_PREFIX || 'studev-submissions/'}${collectionId}/`;
    const entries = [...data.keys()].filter(k => k.startsWith(`${prefix}entries/`)).map(k => data.get(k));
    const collection = { id: collectionId, metadataKeys: [...data.keys()].filter(k => k.startsWith(prefix)).length, submissions: entries.length, completed: 0, reviews: 0, attachmentBytes: 0, formId: uuid(`collection:${collectionId}`), items: [] };
    report.collections.push(collection);
    const formId = collection.formId, targetPrefix = `${config.OSCA_PREFIX || 'studev-submissions/'}platform/${formId}/`;
    const timestamp = entries.map(r => r.createdAt).sort()[0] || '1970-01-01T00:00:00.000Z';
    const form = { id: formId, title: `历史收件 · ${collectionId}`, description: '迁移的原始资料与审核记录。', status: 'archived', access: 'members', deadline: '', requireReview: true, allowEdit: false, maxPerUser: 20, maxSubmissions: 1000, revision: 1, createdAt: timestamp, updatedAt: timestamp,
      fields: [{ id: 'name', type: 'text', label: '称呼', description: '', required: true, maxLength: 1000 }, { id: 'contact', type: 'text', label: '联系方式', description: '', required: false, maxLength: 1000 }, { id: 'description', type: 'textarea', label: '说明', description: '', required: false, maxLength: 10000 }, { id: 'upload', type: 'file', label: '附件', description: '', required: true, maxFiles: 1, maxFileBytes: 20971520, extensions: [...new Set(entries.map(r => r.fileName.split('.').at(-1).toLowerCase()))] }] };
    if (entries.length) {
      if (entries.length > 1000) block('FORM_SUBMISSION_LIMIT', collectionId);
      putNew(`${ROOT}forms/${formId}/00000001.json`, form); putNew(`${ROOT}forms/${formId}/current.json`, form);
      putNew(`${ROOT}form-index/${formId}.json`, { id: formId, form: publicForm(form) });
    }
    const referenced = new Set(), storedKeys = new Set();
    for (let i = 0; i < entries.length; i++) {
      const record = entries[i];
      check(/^\d{13}-[a-f0-9-]{36}$/.test(record.id) && Number.isFinite(Date.parse(record.createdAt)), 'INVALID_COLLECTION_ENTRY', collectionId);
      const id = uuid(`submission:${collectionId}:${record.id}`), fileId = uuid(`file:${collectionId}:${record.id}`), extension = record.fileName.split('.').at(-1).toLowerCase();
      const completed = data.get(`${prefix}completed/${record.id}.json`);
      const sourceKey = completed?.finalObjectKey || record.objectKey;
      check(typeof record.objectKey === 'string' && record.objectKey.startsWith(`${objectPrefix}staging/`), 'UNSAFE_SOURCE_OBJECT', record.id);
      check(typeof sourceKey === 'string' && sourceKey.startsWith(objectPrefix) && !sourceKey.includes('..'), 'UNSAFE_SOURCE_OBJECT', record.id);
      const targetKey = completed ? `${targetPrefix}final/${id}/${fileId}/${uuid(`object:${sourceKey}`)}` : `${targetPrefix}staging/${id}/${fileId}.${extension}`;
      referenced.add(sourceKey);
      storedKeys.add(record.objectKey); storedKeys.add(sourceKey);
      const head = await objects.head(sourceKey);
      let attachment;
      if (!head) {
        if (completed) block('COMPLETED_ATTACHMENT_MISSING', sourceKey);
      } else {
        if (head.size !== record.fileSize || head.contentType !== record.contentType || (completed && (completed.size !== head.size || completed.etag !== head.etag || completed.contentType !== head.contentType))) block('ATTACHMENT_METADATA_MISMATCH', sourceKey);
        attachment = await objects.fingerprint(sourceKey, head.etag);
        check(attachment.size === head.size, 'ATTACHMENT_SIZE_MISMATCH', sourceKey);
        if (!/^"[^"\r\n]+"$/.test(head.etag || '')) block('ATTACHMENT_ETAG_INVALID', sourceKey);
        copies.push({ sourceKey, targetKey, ...head, ...attachment });
        report.attachments.referenced++; report.attachments.bytes += head.size; collection.attachmentBytes += head.size;
      }
      const file = { id: fileId, fieldId: 'upload', name: record.fileName, size: record.fileSize, type: record.contentType, extension, objectKey: completed ? `${targetPrefix}staging/${id}/${fileId}.${extension}` : targetKey };
      const migrated = { id, formId, submitterName: record.name, answers: { name: record.name, contact: record.contact, description: record.description }, files: [file], schemaSnapshot: publicForm(form), receiptHash: record.receiptHash, createdAt: record.createdAt, uploadExpiresAt: record.uploadExpiresAt * 1000, objectPrefix: targetPrefix };
      putNew(`${ROOT}form-records/${id}.json`, migrated); putNew(`${ROOT}form-submissions/${formId}/${id}.json`, { id });
      putNew(`${ROOT}form-quota/${formId}/${String(i).padStart(4, '0')}.json`, { id, createdAt: record.createdAt });
      if (completed && attachment) {
        collection.completed++;
        putNew(`${ROOT}form-completed/${id}.json`, { completedAt: completed.completedAt, status: 'pending_review', files: [{ id: fileId, finalObjectKey: targetKey, etag: attachment.etag || head.etag, size: head.size, contentType: head.contentType }] });
      }
      const reviews = [...data.keys()].filter(k => k.startsWith(`${prefix}reviews/${record.id}/`)).sort();
      let lastEvent;
      for (let n = 0; n < reviews.length; n++) {
        const review = data.get(reviews[n]);
        check(review.revision === n + 1 && ['accepted', 'rejected'].includes(review.status) && completed, 'INVALID_REVIEW_HISTORY', reviews[n]);
        lastEvent = { answers: migrated.answers, status: review.status, updatedAt: review.reviewedAt, review: { status: review.status, comment: review.comment, reviewedAt: review.reviewedAt }, revision: n + 1 };
        putNew(`${ROOT}form-events/${id}/${String(n + 1).padStart(8, '0')}.json`, lastEvent); collection.reviews++;
      }
      if (lastEvent) putNew(`${ROOT}form-events/${id}/current.json`, lastEvent);
      collection.items.push({ sourceId: record.id, submissionId: id, completed: Boolean(completed), attachmentPresent: Boolean(head), ...(attachment ? { bytes: attachment.size, sha256: attachment.sha256 } : {}) });
    }
    for (const key of [...data.keys()].filter(k => k.startsWith(`${prefix}completed/`) || k.startsWith(`${prefix}reviews/`))) {
      const id = key.slice(prefix.length).split('/')[1].replace(/\.json$/, '');
      if (!entries.some(r => r.id === id)) block('ORPHAN_COLLECTION_METADATA', key);
    }
    const stored = [];
    for (const key of storedKeys) { const head = await objects.head(key); if (head) stored.push({ key, size: head.size }); }
    report.attachments.storedObjects += stored.length;
    report.attachments.storedBytes += stored.reduce((n, o) => n + o.size, 0);
    for (const object of stored) if (!referenced.has(object.key)) report.attachments.retainedOriginalObjects.push({ key: object.key, bytes: object.size, retained: true });
  }
  // Read every proposed destination now. No overwrite of unrelated data.
  const changes = [];
  for (const operation of writes.values()) {
    const before = await bytes(store, operation.key);
    if (before && same(JSON.parse(before), operation.value)) continue;
    if (before && !data.has(operation.key) && !operation.key.startsWith(`${ROOT}roster/`)) block('TARGET_COLLISION', operation.key);
    changes.push({ ...operation, before });
  }
  for (const copy of copies) {
    const target = await objects.head(copy.targetKey);
    if (target) {
      const fingerprint = await objects.fingerprint(copy.targetKey, target.etag);
      check(target.size === copy.size && target.contentType === copy.contentType && fingerprint.sha256 === copy.sha256, 'TARGET_ATTACHMENT_COLLISION', copy.targetKey);
      copy.existing = true;
    }
  }
  report.plannedMetadataChanges = changes.length; report.plannedAttachmentCopies = copies.filter(c => !c.existing).length;
  const expectedRecords = [...new Set([...data.keys()].filter(k => k.startsWith(`${ROOT}form-records/`)).concat([...writes.keys()].filter(k => k.startsWith(`${ROOT}form-records/`))))].sort();
  const expectedUsers = [...new Set([...data.keys()].map(k => /^platform-v1\/identity\/users\/([^/]+)\//.exec(k)?.[1]).filter(Boolean))].sort();
  return { report, changes, copies, snapshot, store, objects, writes, expectedRecords, expectedUsers };
}

export async function applyLegacy(plan, { backupDir, writesStopped = false, scope = {} } = {}) {
  const { report, changes, copies, snapshot, store, objects } = plan;
  check(writesStopped, 'QUIESCE_WRITES_REQUIRED');
  check(backupDir && isAbsolute(backupDir), 'ABSOLUTE_PRIVATE_BACKUP_DIR_REQUIRED');
  check(!report.blockers.length, 'INVENTORY_BLOCKED');
  // A backup may contain password hashes/TOTP state. Never put it in a checkout.
  const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  await mkdir(backupDir, { recursive: true });
  const backupPath = await realpath(backupDir), repoPath = await realpath(repoRoot);
  const insideRepo = relative(repoPath, backupPath);
  check(insideRepo.startsWith('..') || isAbsolute(insideRepo), 'BACKUP_INSIDE_REPOSITORY');
  for (let directory = backupPath; directory !== dirname(directory); directory = dirname(directory)) {
    let git;
    try { git = await stat(join(directory, '.git')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    check(!git, 'BACKUP_INSIDE_REPOSITORY');
  }
  const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), scope,
    metadata: changes.map(c => ({ key: c.key, beforeBase64: c.before?.toString('base64') ?? null, beforeSha256: c.before ? sha(c.before) : null, afterSha256: sha(encode(c.value)) })),
    attachments: copies.map(c => ({ sourceKey: c.sourceKey, targetKey: c.targetKey, before: c.existing ? { sha256: c.sha256, size: c.size } : null, sha256: c.sha256, size: c.size, sourceEtag: c.etag })),
    retainedSourceKeys: [...snapshot.data.keys()], report };
  const handle = await open(resolve(backupPath, 'manifest.json'), 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(manifest, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
  check(sha(await readFile(resolve(backupPath, 'manifest.json'))) === sha(JSON.stringify(manifest, null, 2) + '\n'), 'BACKUP_VERIFICATION_FAILED');
  async function unchanged() {
    for (const [prefix, keys] of snapshot.lists) check(same(await list(store, prefix), keys), 'SOURCE_KEYSET_CHANGED', prefix);
    for (const [key, value] of snapshot.data) check(same(await read(store, key), value), 'SOURCE_CHANGED', key);
  }
  await unchanged();
  for (const copy of copies) {
    const current = await objects.fingerprint(copy.sourceKey, copy.etag);
    check(current.size === copy.size && current.sha256 === copy.sha256, 'SOURCE_ATTACHMENT_CHANGED', copy.sourceKey);
    if (!copy.existing) {
      check(!await objects.head(copy.targetKey), 'TARGET_ATTACHMENT_APPEARED', copy.targetKey);
      await objects.copy(copy.sourceKey, copy.targetKey, copy.etag);
    }
    const head = await objects.head(copy.targetKey), actual = head && await objects.fingerprint(copy.targetKey, head.etag);
    check(head?.size === copy.size && head.contentType === copy.contentType && actual?.sha256 === copy.sha256, 'COPIED_ATTACHMENT_MISMATCH', copy.targetKey);
    // The immutable completion planned in the manifest must match its copy.
    for (const c of changes) if (c.key.startsWith(`${ROOT}form-completed/`)) for (const file of c.value.files) if (file.finalObjectKey === copy.targetKey) {
      check(head.etag === file.etag, 'COPIED_ETAG_MISMATCH', copy.targetKey);
    }
  }
  // Attachments all verified before a single current metadata record is exposed.
  await unchanged();
  for (const c of changes) {
    const before = await bytes(store, c.key);
    check((before === null && c.before === null) || (before && c.before && before.equals(c.before)), 'DESTINATION_CHANGED', c.key);
    await store.setJSON(c.key, c.value, c.before === null ? { onlyIfNew: true } : undefined);
    check(same(await read(store, c.key), c.value), 'METADATA_WRITE_MISMATCH', c.key);
  }
  for (const [key, operation] of plan.writes) check(same(await read(store, key), operation.value), 'FINAL_COUNT_OR_VALUE_MISMATCH', key);
  check(same(await list(store, `${ROOT}form-records/`), plan.expectedRecords), 'SUBMISSION_COUNT_MISMATCH');
  const userIds = [...new Set((await list(store, `${ROOT}identity/users/`)).map(k => /^platform-v1\/identity\/users\/([^/]+)\//.exec(k)?.[1]).filter(Boolean))].sort();
  check(same(userIds, plan.expectedUsers), 'ACCOUNT_COUNT_MISMATCH');
  for (const collection of report.collections) if (collection.submissions) {
    check((await list(store, `${ROOT}form-submissions/${collection.formId}/`)).length === collection.submissions, 'COLLECTION_COUNT_MISMATCH', collection.id);
    for (const item of collection.items) {
      const prefix = `${ROOT}form-events/${item.submissionId}/`;
      const revisions = (await list(store, prefix)).filter(k => /\/\d{8}\.json$/.test(k));
      const originalReviews = [...snapshot.data.keys()].filter(k => k.startsWith(`collections/${collection.id}/reviews/${item.sourceId}/`));
      check(revisions.length === originalReviews.length, 'REVIEW_COUNT_MISMATCH', item.sourceId);
    }
  }
  for (const copy of copies) {
    const head = await objects.head(copy.targetKey), content = head && await objects.fingerprint(copy.targetKey, head.etag);
    check(head?.size === copy.size && head.contentType === copy.contentType && content?.sha256 === copy.sha256, 'FINAL_ATTACHMENT_MISMATCH', copy.targetKey);
  }
  // All immutable account/review revisions remain byte-for-byte logically intact.
  for (const [key, value] of snapshot.data) if (!changes.some(c => c.key === key)) check(same(await read(store, key), value), 'HISTORY_CHANGED', key);
  const verified = { ...report, applied: true, productionDataModified: changes.length + copies.filter(c => !c.existing).length > 0, verifiedMetadata: plan.writes.size, verifiedAttachments: copies.length };
  await writeFile(resolve(backupPath, 'verified.json'), JSON.stringify(verified, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return verified;
}

export function s3Objects(config) {
  const endpoint = new URL(config.OSCA_ENDPOINT);
  check(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash, 'INVALID_OSCA_ENDPOINT');
  check(config.OSCA_BUCKET && config.OSCA_ACCESS_KEY_ID && config.OSCA_SECRET_ACCESS_KEY, 'OSCA_CONFIGURATION_REQUIRED');
  check(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/$/.test(config.OSCA_PREFIX || 'studev-submissions/'), 'INVALID_OSCA_PREFIX');
  const client = new S3Client({ endpoint: endpoint.origin, region: config.OSCA_REGION || 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: config.OSCA_ACCESS_KEY_ID, secretAccessKey: config.OSCA_SECRET_ACCESS_KEY }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 2 });
  const send = async (Command, input) => {
    const command = new Command({ Bucket: config.OSCA_BUCKET, ...input });
    command.middlewareStack.add(next => async args => { args.request.headers['accept-encoding'] = 'identity'; return next(args); }, { step: 'build', name: 'migrationIdentityEncoding' });
    return client.send(command, { abortSignal: AbortSignal.timeout(120000) });
  };
  return {
    async head(key) {
      try { const h = await send(HeadObjectCommand, { Key: key }); return { size: h.ContentLength, contentType: h.ContentType, etag: h.ETag }; }
      catch (e) { if (e.$metadata?.httpStatusCode === 404) return null; throw e; }
    },
    async fingerprint(key, etag) {
      const result = await send(GetObjectCommand, { Key: key, IfMatch: etag });
      const hash = createHash('sha256'); let size = 0;
      for await (const chunk of result.Body) { hash.update(chunk); size += chunk.length; }
      return { size, sha256: hash.digest('hex') };
    },
    async copy(sourceKey, targetKey, etag) {
      await send(CopyObjectCommand, { Key: targetKey, CopySource: `${config.OSCA_BUCKET}/${sourceKey}`.split('/').map(encodeURIComponent).join('/'), CopySourceIfMatch: etag, MetadataDirective: 'COPY' });
    },
  };
}

async function productionConfig(projectId, token) {
  // Same read-only DescribePagesProjectEnvs operation as the official CLI's env pull,
  // kept in memory: no .env download, application login or provisioning.
  const response = await fetch('https://pages-api.cloud.tencent.com/v1', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ Action: 'DescribePagesProjectEnvs', ProjectId: projectId, Env: 'Production', Region: 'ap-guangzhou' }), signal: AbortSignal.timeout(60000) });
  check(response.ok, 'PRODUCTION_CONFIG_READ_FAILED');
  const result = await response.json(), vars = result.Data?.Response?.EnvVars;
  check(result.Code === 0 && Array.isArray(vars), 'PRODUCTION_CONFIG_READ_FAILED');
  return Object.fromEntries(vars.map(v => [v.Key, v.Value]));
}
async function main() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, mapping: { type: 'string' }, report: { type: 'string' }, 'backup-dir': { type: 'string' }, 'writes-stopped': { type: 'boolean', default: false }, 'owner-profile': { type: 'string' } }, strict: true });
  const projectId = process.env.LEGACY_PROJECT_ID, token = process.env.LEGACY_BLOB_TOKEN;
  check(projectId && token, 'PROCESS_CREDENTIALS_REQUIRED');
  const store = getStore({ name: 'studev-collections', projectId, token, consistency: 'strong' });
  const config = await productionConfig(projectId, token);
  const mapping = values.mapping ? JSON.parse(await readFile(values.mapping, 'utf8')) : { accounts: [] };
  const ownerProfile = values['owner-profile'] ? JSON.parse(await readFile(values['owner-profile'], 'utf8')) : undefined;
  const plan = await inventoryLegacy({ store, objects: s3Objects(config), config, mapping, ownerProfile });
  let report = plan.report;
  if (values.report) { await mkdir(dirname(resolve(values.report)), { recursive: true }); await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
  if (values.apply) report = await applyLegacy(plan, { backupDir: values['backup-dir'], writesStopped: values['writes-stopped'], scope: { projectId, store: 'studev-collections', bucket: config.OSCA_BUCKET } });
  if (values.report && values.apply) await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ applied: report.applied, accounts: report.accounts.total, qqOnly: report.accounts.qqOnly.length, needingMapping: report.accounts.needingMapping, collections: report.collections.map(({ id, submissions, completed, attachmentBytes }) => ({ id, submissions, completed, attachmentBytes })), snapshotlessFormIndexes: report.formIndexesWithoutSnapshots.length, attachments: report.attachments.referenced, blockers: report.blockers, report: values.report }));
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main().catch(error => {
  // SDK/fetch errors can contain credentials, signed URLs and private payloads.
  console.error(JSON.stringify({ status: 'migration_failed', code: error instanceof MigrationError ? error.code : 'SERVICE_ERROR_REDACTED', name: /^[A-Za-z0-9_]{1,64}$/.test(error.name || '') ? error.name : 'Unknown', httpStatus: error.$metadata?.httpStatusCode, ...(error instanceof MigrationError && error.key ? { key: error.key } : {}) })); process.exitCode = 1;
});
