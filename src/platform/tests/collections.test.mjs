import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCollectionsService } from '../server/collections/index.mjs';
import { collectionKeys, locateSubmission, revisionKey } from '../server/collections/records.mjs';
import { seedRoundQuota } from '../server/collections/quota.mjs';
import { submissionWasLate } from '../server/collections/submissions.mjs';
import { createIdentity } from '../server/identity.mjs';
import { createRepository } from '../server/store.mjs';
import { hashPassword } from '../server/crypto.mjs';
import { AppError, fail } from '../server/common.mjs';
import { loadOrganizations, saveOrganization } from '../server/organizations.mjs';
import { memoryBlob, memoryGateway, testEnvironment } from './fixtures.mjs';

const ORIGIN = 'https://studev.test';
const ROOT = '/api/platform/collections';
const orgA = 'student-development/operations';
const orgB = 'student-development/media';
const note = { id: 'note', type: 'text', label: '说明', required: true };
const attachment = { id: 'upload', type: 'file', label: '附件', required: true, extensions: ['txt'] };

async function collectionsFixture() {
  let clock = Date.UTC(2026, 10, 22, 12);
  const store = memoryBlob(), gateway = memoryGateway();
  const { env } = await testEnvironment();
  const owner = { id: 'owner-test', studentId: 'OWNER01', realName: '所有者姓名', nickname: '所有者昵称', identityVerified: true, role: 'owner', memberships: [] };
  const admin = { id: 'admin-test', studentId: 'ADMIN01', realName: '甲部门管理员', role: 'admin', memberships: [{ organizationId: orgA, title: '部长' }] };
  const outsider = { id: 'other-admin', studentId: 'ADMIN02', realName: '乙部门管理员', role: 'admin', memberships: [{ organizationId: orgB, title: '部长' }] };
  const alice = { id: 'alice-test', studentId: 'TEST1001', realName: '甲学生', role: 'user', memberships: [{ organizationId: orgA }] };
  const bob = { id: 'bob-test', studentId: 'TEST1002', realName: '乙学生', role: 'user', memberships: [{ organizationId: orgB }] };
  const users = { owner, admin, outsider, alice, bob };
  const repo = createRepository(store, { secret: env.PLATFORM_SESSION_SECRET, now: () => clock });
  const identity = {
    async authenticate(request, { required = false, csrf = false } = {}) {
      const user = users[request.headers.get('x-user')];
      if (!user && (required || csrf)) fail(401, 'AUTH_REQUIRED', '登录');
      if (!user) return null;
      if (csrf && request.headers.get('x-csrf-token') !== 'valid') fail(403, 'CSRF_REJECTED', 'CSRF');
      return { user };
    },
    async loadAllUsers() { return Object.values(users); },
    loadOrganizations: () => loadOrganizations(repo),
  };
  const svc = createCollectionsService({ repo, identity, env, now: () => clock, getGateway: () => gateway });

  async function call(path = '', { user, body, csrf = true, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const headers = new Headers({ origin: ORIGIN });
    if (user) headers.set('x-user', user);
    if (csrf) headers.set('x-csrf-token', 'valid');
    if (body !== undefined) headers.set('content-type', 'application/json');
    const request = new Request(ORIGIN + ROOT + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    try {
      const result = await svc.handle({ request, env }, new URL(request.url).pathname);
      if (!result) return { status: 404 };
      const data = result.headers.get('content-type').includes('json') ? await result.json() : Buffer.from(await result.arrayBuffer()).toString('utf8');
      return { status: result.status, data };
    } catch (error) {
      if (error instanceof AppError) return { status: error.status, data: { error: error.code } };
      throw error;
    }
  }
  async function create({ user = 'owner', round = {}, ...input } = {}) {
    const result = await call('/items', { user, body: {
      name: '采集', status: 'published', visibility: 'members', targetMode: 'open', term: '2026-2027-1',
      issuerOrganizationId: orgA, issuerTitle: user === 'admin' ? '部长' : '',
      rounds: [{ label: '首轮', fields: [note], ...round }], ...input,
    } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.item;
  }
  const itemPath = (item) => '/items/' + item.id;
  const roundPath = (item) => itemPath(item) + '/rounds/' + item.rounds[0].id;
  const submit = (item, user, body = { answers: { note: '完成' }, files: [] }) => call(roundPath(item) + '/submissions', { user, body });
  const complete = ({ receiptId, receiptToken }) => call('/submissions/' + receiptId + '/complete', { body: { receiptToken } });
  const cancel = ({ receiptId, receiptToken }) => call('/submissions/' + receiptId + '/cancel', { body: { receiptToken } });
  return { users, repo, store, gateway, call, create, itemPath, roundPath, submit, complete, cancel, advance: (ms) => { clock += ms; } };
}

test('collection reads and writes use the signed-in role and organization scope', async () => {
  const f = await collectionsFixture();
  const publicItem = await f.create({ visibility: 'public' });
  const privateItem = await f.create({
    user: 'admin', targetMode: 'selected', recipients: [{ studentId: 'TEST1001', name: '甲学生' }],
    tags: ['课程实验'], course: { id: 'information/course-plan/JS160201S', code: 'JS160201S', name: '计算机网络' },
  });
  const draft = await f.create({ status: 'draft' });
  const guest = (await f.call()).data;
  assert.equal(guest.viewer, null);
  assert.deepEqual(guest.items.map(({ id }) => id), [publicItem.id]);
  assert.equal(guest.items[0].issuer.name, '');
  assert.deepEqual((await f.call('', { user: 'bob' })).data.items.map(({ id }) => id), [publicItem.id]);
  const mine = (await f.call(f.itemPath(privateItem), { user: 'alice' })).data.item;
  assert.equal(mine.inRecipients, true);
  assert.equal(mine.recipients, undefined);
  assert.equal(mine.course.code, 'JS160201S');
  assert.deepEqual(mine.tags, ['课程实验']);
  assert.equal((await f.call(f.itemPath(privateItem), { user: 'outsider' })).status, 404);
  assert.equal((await f.call(f.itemPath(draft), { user: 'alice' })).status, 404);
  const staff = (await f.call(f.itemPath(privateItem), { user: 'admin' })).data.item;
  assert.deepEqual(staff.recipients, [{ studentId: 'TEST1001', name: '甲学生', groupId: orgA, groupLabel: '运营支持部' }]);
  const owner = (await f.call('?view=guest', { user: 'owner' })).data;
  assert.deepEqual(owner.viewer, { id: f.users.owner.id, role: 'owner', isStaff: true, canPublish: true });
  assert.equal(Object.hasOwn(owner, 'view'), false);
  assert.equal(Object.hasOwn(owner, 'views'), false);
  assert.deepEqual(new Set(owner.items.map(({ id }) => id)), new Set([publicItem.id, privateItem.id, draft.id]));
  const member = (await f.call('?view=admin', { user: 'alice' })).data;
  assert.deepEqual(member.viewer, { id: f.users.alice.id, role: 'user', isStaff: false, canPublish: false });
  assert.equal((await f.call(f.itemPath(publicItem) + '?view=owner', { user: 'alice', body: { revision: 1, status: 'closed' } })).status, 403);
  assert.equal((await f.call('/people?view=admin', { user: 'alice' })).status, 403);
  const directory = (await f.call('/people', { user: 'admin' })).data.people;
  assert.deepEqual(directory.map(({ studentId }) => studentId).sort(), ['ADMIN01', 'TEST1001']);
  assert.equal((await f.call('/items', { user: 'admin', body: {
    name: '越权', term: '2026-2027-1', issuerOrganizationId: orgB, rounds: [{ label: '填表', fields: [note] }],
  } })).status, 403);
});

test('selected recipients use a saved organization label without broadening collection access', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ user: 'admin', targetMode: 'selected', recipients: [
    { studentId: 'TEST1001', name: '甲学生', groupId: orgA, groupLabel: '伪造名称' },
    { studentId: 'TEST1002', name: '乙学生' },
  ] });
  const getBoard = () => f.call(f.roundPath(item) + '/submissions', { user: 'admin' });
  const name = (await loadOrganizations(f.repo)).find(org => org.id === orgA).name;
  assert.deepEqual(item.recipients[0], { studentId: 'TEST1001', name: '甲学生', groupId: orgA, groupLabel: name });
  await f.submit(item, 'alice');
  let report = (await getBoard()).data;
  assert.equal(report.board[0].orgId, orgA);
  assert.equal(report.board[0].orgLabel, name);
  assert.equal(report.board[1].orgId, undefined);
  assert.equal(report.items[0].complete, true);
  assert.equal((await f.call(f.roundPath(item) + '/submissions', { user: 'bob' })).status, 403);
  assert.equal((await f.call(f.itemPath(item), { user: 'bob' })).data.item.recipients, undefined);

  await saveOrganization(f.repo, { id: orgA, parentId: 'student-development', name: '更新后的组名' });
  const untouched = await f.call(f.itemPath(item), { user: 'admin', body: { revision: item.revision, name: '改收集名称' } });
  assert.equal(untouched.status, 200);
  assert.deepEqual(untouched.data.item.recipients, item.recipients);
  const roster = await f.call(f.itemPath(item), { user: 'admin', body: { revision: untouched.data.item.revision,
    recipients: [{ studentId: 'TEST1001', name: '甲学生', groupId: orgA }] } });
  assert.equal(roster.status, 200);
  assert.equal(roster.data.item.recipients[0].groupLabel, name);
  const forged = await f.call(f.itemPath(item), { user: 'admin', body: { revision: roster.data.item.revision,
    recipients: [{ studentId: 'TEST1001', name: '甲学生', groupId: orgB }] } });
  assert.equal(forged.data.item.recipients[0].groupId, orgA);
  const forbidden = await f.call(f.itemPath(item), { user: 'admin', body: { revision: forged.data.item.revision,
    audienceOrganizationId: orgB } });
  assert.equal(forbidden.data.error, 'AUDIENCE_FORBIDDEN');
  report = (await getBoard()).data;
  assert.equal(report.board[0].orgLabel, name);
});

test('participant progress shares the scoped roster counts and exposes no other participant data', async () => {
  const f = await collectionsFixture();
  const parent = 'network';
  const classOne = 'network/class1';
  const classTwo = 'network/class2';
  const subgroup = 'network/class1/group-a';
  for (const [id, name, parentId] of [
    [parent, '计算机科学与技术', null], [classOne, '1 班', parent], [classTwo, '2 班', parent], [subgroup, 'A 组', classOne],
  ]) await saveOrganization(f.repo, { id, name, parentId, kind: 'academic' });
  f.users.alice.memberships.push({ organizationId: subgroup }, { organizationId: parent });
  f.users.bob.memberships.push({ organizationId: classTwo });
  f.users.bob.identityVerified = true;
  const item = await f.create({ visibility: 'public', targetMode: 'selected', audienceOrganizationId: parent, recipients: [
    { studentId: 'TEST1001', name: '甲学生', groupId: classTwo }, { studentId: 'TEST1002', name: '乙学生' },
    { studentId: 'TEST1003', name: '丙学生' },
  ] });
  const path = f.itemPath(item);
  const round = f.roundPath(item);
  const board = round + '/submissions';
  assert.equal(item.showProgress, false);
  assert.deepEqual(item.recipients.map(row => row.groupId), [classOne, classTwo, undefined]);
  assert.equal((await f.call(board, { user: 'bob' })).status, 403);
  assert.equal((await f.call(path, { user: 'bob' })).data.item.canViewProgress, false);
  const on = (await f.call(path, { user: 'owner', body: { revision: item.revision, showProgress: true } })).data.item;
  assert.equal(on.showProgress, true);
  assert.equal((await f.call(board)).status, 403);
  assert.equal((await f.call(board, { user: 'outsider' })).status, 403);
  assert.equal((await f.call(board, { user: 'alice' })).status, 403);
  f.users.alice.identityVerified = true;
  const record = await f.submit(item, 'alice');
  const staff = (await f.call(board, { user: 'owner' })).data.progress;
  assert.deepEqual(staff.groups, [
    { id: classOne, label: '1 班', total: 1, submitted: 1, missing: 0, late: 0, records: 1 },
    { id: classTwo, label: '2 班', total: 1, submitted: 0, missing: 1, late: 0, records: 0 },
    { id: '', label: '待核对', total: 1, submitted: 0, missing: 1, late: 0, records: 0 },
  ]);
  assert.equal((await f.call(path, { user: 'alice' })).data.item.canViewProgress, true);
  const own = (await f.call(board, { user: 'alice' })).data;
  assert.deepEqual(own, { progress: { ...staff, ownStatus: 'submitted' } });
  const other = (await f.call(board, { user: 'bob' })).data;
  assert.deepEqual(other, { progress: { ...staff, ownStatus: 'missing' } });
  for (const privateValue of ['甲学生', 'TEST1001', record.data.submission.id, '完成']) {
    assert.ok(!JSON.stringify(other).includes(privateValue));
  }
  assert.equal((await f.call(round + '/csv', { user: 'bob' })).status, 403);
  assert.equal((await f.call(round + '/files', { user: 'bob', body: { submissionIds: [record.data.submission.id] } })).status, 403);
  const stopped = (await f.call(round, { user: 'owner', body: { revision: on.revision, policy: 'closed' } })).data.item;
  assert.equal((await f.call(board, { user: 'bob' })).status, 200);
  assert.equal((await f.call(path + '/unpublish', { user: 'owner', body: { revision: stopped.revision } })).status, 200);
  assert.equal((await f.call(board, { user: 'alice' })).status, 404);
  assert.equal((await f.call(path, { user: 'alice' })).data.mySubmissions.length, 1);
});

test('open progress counts distinct people and successful submissions without an expected count', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ visibility: 'public', showProgress: true, round: { submissionMode: 'multiple', maxPerUser: 3 } });
  assert.equal((await f.submit(item, 'alice')).status, 201);
  assert.equal((await f.submit(item, 'alice')).status, 201);
  const path = f.roundPath(item) + '/submissions';
  assert.deepEqual((await f.call(path, { user: 'alice' })).data, {
    progress: { total: null, submitted: 1, missing: null, late: 0, records: 2, groups: [], ownStatus: 'submitted', ownLate: false },
  });
  assert.equal((await f.call(path, { user: 'bob' })).data.progress.ownStatus, 'missing');
  const disabled = await f.call(f.itemPath(item), { user: 'owner', body: { revision: item.revision, showProgress: false } });
  assert.equal(disabled.status, 200);
  assert.equal((await f.call(path, { user: 'alice' })).status, 403);
});

test('compact reads reuse current revisions without exposing withdrawn items or full submission content', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ visibility: 'public', targetMode: 'selected', recipients: [{ studentId: 'TEST1001', name: '甲学生' }] });
  await f.create({ status: 'draft' });
  assert.equal((await f.call()).data.items.length, 1);
  const submitted = await f.submit(item, 'alice');
  assert.equal(submitted.status, 201);
  const path = f.roundPath(item) + '/submissions';
  assert.equal((await f.call(path, { user: 'owner' })).data.items.length, 1);

  const reads = [];
  const get = f.store.get;
  f.store.get = (key, options) => { reads.push(key); return get(key, options); };
  assert.equal((await f.call()).data.items.length, 1);
  const compact = (await f.call(path, { user: 'owner' })).data.items[0];
  assert.equal(compact.id, submitted.data.submission.id);
  for (const key of ['answers', 'files', 'fields', 'userId']) assert.ok(!Object.hasOwn(compact, key));
  assert.ok(!reads.some(key => key.includes('/collection/submissions/')));
  assert.equal(reads.filter(key => key.includes('/collection/definitions/')).length, 1);
  reads.length = 0;
  assert.equal((await f.call('/mine', { user: 'alice' })).data.items[0].answers.note, '完成');
  assert.equal(reads.filter(key => key.includes('/collection/definitions/')).length, 1);
  assert.ok(!reads.some(key => key.endsWith('/collection/catalog.json')));
  assert.equal((await f.call(path, { user: 'bob' })).status, 403);

  assert.equal((await f.call(f.itemPath(item) + '/unpublish', { user: 'owner', body: { revision: item.revision } })).status, 200);
  assert.equal((await f.call()).data.items.length, 0);
  assert.equal((await f.call(f.itemPath(item), { user: 'alice' })).data.mySubmissions.length, 1);
});

test('stopping keeps access and withdrawal preserves private receipts, review and historical answers', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ user: 'admin', round: { requireReview: true, allowEdit: true } });
  const inserted = await f.submit(item, 'alice', { answers: { note: '  =FORMULA(1) ' }, files: [],
    studentId: 'FAKE01', studentName: '伪造姓名' });
  assert.equal(inserted.status, 201);
  assert.equal(inserted.data.receiptId, undefined);
  assert.equal(inserted.data.submission.studentId, 'TEST1001');
  assert.deepEqual(inserted.data.submission.answers, { note: '=FORMULA(1)' });
  assert.equal(inserted.data.submission.status, 'pending_review');
  const { id, revision } = inserted.data.submission;
  const recordPath = '/submissions/' + id;
  assert.equal((await f.call(recordPath, { user: 'bob' })).status, 404);
  assert.equal((await f.call(recordPath, { user: 'outsider' })).status, 404);
  assert.equal((await f.call(recordPath, { user: 'alice' })).data.canEdit, true);
  assert.equal((await f.call(recordPath + '/review', { user: 'alice', body: { revision, status: 'accepted' } })).status, 403);
  const nextFields = [{ id: 'note', label: '补充说明', type: 'checkbox', options: ['以后使用'] }];
  const changed = await f.call(f.roundPath(item), { user: 'admin', body: { revision: item.revision, fields: nextFields } });
  assert.equal(changed.status, 200);
  const csv = await f.call(f.roundPath(item) + '/csv', { user: 'owner' });
  assert.equal(csv.status, 200);
  assert.ok(csv.data.startsWith('\uFEFF'));
  assert.ok(csv.data.includes('"补充说明"'));
  assert.ok(csv.data.includes('"说明"'));
  assert.ok(csv.data.includes("'=FORMULA(1)"));
  const edited = await f.call(recordPath + '/edit', { user: 'alice', body: { revision, answers: { note: '更正' } } });
  assert.equal(edited.status, 200);
  const reviewed = await f.call(recordPath + '/review', { user: 'admin', body: { revision: edited.data.submission.revision, status: 'accepted', comment: '通过' } });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.submission.review.comment, '通过');
  const report = await f.call(f.roundPath(item) + '/submissions', { user: 'admin' });
  assert.equal(report.data.board[0].statuses[item.rounds[0].id], 'accepted');
  assert.equal(report.data.progress.submitted, 1);
  assert.equal(report.data.items[0].createdAt, inserted.data.submission.createdAt);
  assert.equal((await f.call(f.roundPath(item) + '/submissions', { user: 'alice' })).status, 403);
  const path = f.itemPath(item);
  const stopped = await f.call(path, { user: 'admin', body: { revision: changed.data.item.revision, status: 'closed' } });
  assert.equal(stopped.status, 200);
  assert.equal((await f.call(path, { user: 'bob' })).status, 200);
  assert.equal((await f.submit(item, 'bob')).data.error, 'COLLECTION_CLOSED');
  const withdrawn = await f.call(path + '/unpublish', { user: 'admin', body: { revision: stopped.data.item.revision } });
  assert.equal(withdrawn.status, 200);
  assert.equal((await f.call(f.itemPath(item), { user: 'bob' })).status, 404);
  assert.equal((await f.call(f.itemPath(item))).status, 404);
  assert.equal((await f.submit(item, 'alice')).status, 404);
  assert.equal((await f.call('', { user: 'alice' })).data.items.some(({ id }) => id === item.id), false);
  const historical = (await f.call(f.itemPath(item), { user: 'alice' })).data;
  assert.equal(historical.item.status, 'draft');
  assert.equal(historical.item.canManage, false);
  assert.deepEqual(historical.mySubmissions.map((row) => row.id), [id]);
  assert.equal((await f.call('/mine', { user: 'alice' })).data.items[0].status, 'accepted');
  assert.equal((await f.call(recordPath, { user: 'alice' })).data.canEdit, false);
  assert.equal((await f.call(path, { user: 'admin', method: 'DELETE', body: { revision: withdrawn.data.item.revision } })).data.error, 'DRAFT_HAS_SUBMISSIONS');
  const duplicate = await f.call(f.itemPath(item) + '/duplicate', { user: 'admin', body: {} });
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.data.item.status, 'draft');
});

test('draft deletion removes definition content and protects outstanding upload confirmations', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ visibility: 'public', round: { fields: [note, attachment] } });
  const path = f.itemPath(item);
  const submission = await f.submit(item, 'alice', { answers: { note: '上传' }, files: [{ fieldId: 'upload', name: '材料.txt', size: 7, type: 'text/plain' }] });
  assert.equal(submission.status, 201);
  const deletion = (revision, options = {}) => f.call(path, { user: 'owner', method: 'DELETE', body: { revision }, ...options });
  assert.equal((await deletion(item.revision)).data.error, 'DRAFT_REQUIRED');
  const { data: { item: draft } } = await f.call(path + '/unpublish', { user: 'owner', body: { revision: item.revision } });
  assert.equal((await deletion(draft.revision, { csrf: false })).data.error, 'CSRF_REJECTED');
  assert.equal((await deletion(draft.revision)).data.error, 'DRAFT_HAS_AUTHORIZATIONS');
  f.advance(71 * 60_000);
  assert.equal((await f.complete(submission.data)).data.error, 'SUBMISSION_EXPIRED');
  assert.equal((await deletion(item.revision)).data.error, 'REVISION_CONFLICT');
  assert.deepEqual((await deletion(draft.revision)).data, { deleted: true });
  assert.equal((await f.call(path, { user: 'owner' })).status, 404);
  assert.equal((await f.call('', { user: 'owner' })).data.items.length, 0);
  const prefix = collectionKeys.definition(item.id);
  const keys = await f.repo.list(prefix + '/');
  assert.equal(keys.length, draft.revision + 1);
  for (const [index, key] of keys.entries()) assert.deepEqual(await f.repo.get(key), { deleted: true, revision: index + 1 });
});

test('deadline closes at the cutoff and late reopening keeps submissions independently of review and schedule edits', async () => {
  const f = await collectionsFixture();
  const deadline = '2026-11-22T12:00:10.000Z';
  const item = await f.create({ visibility: 'public', user: 'admin', round: { deadline, requireReview: true, allowEdit: true } });
  const path = f.itemPath(item);
  const roundPath = f.roundPath(item);
  const patch = (body) => f.call(roundPath, { user: 'admin', body });
  assert.equal((await patch({ revision: item.revision, policy: 'allow-late' })).data.error, 'LATE_REQUIRES_DEADLINE');
  const undated = await f.create();
  assert.equal((await f.call(f.roundPath(undated), { user: 'owner', body: { revision: undated.revision, policy: 'allow-late' } })).data.error, 'LATE_REQUIRES_DEADLINE');
  const { data: { submission: onTime } } = await f.submit(item, 'alice');
  assert.equal(onTime.late, false);
  f.advance(9_999);
  assert.equal((await f.call(path)).data.item.rounds[0].open, true);
  f.advance(1);
  const read = (await f.call(path)).data;
  assert.equal(read.serverTime, Date.parse(deadline));
  assert.equal(read.item.status, 'published');
  assert.equal(read.item.rounds[0].open, false);
  const catalog = await f.call();
  assert.equal(catalog.data.serverTime, read.serverTime);
  assert.equal(catalog.data.items.find((row) => row.id === item.id).rounds[0].open, false);
  assert.equal((await f.submit(item, 'bob')).data.error, 'COLLECTION_CLOSED');
  const edit = () => f.call('/submissions/' + onTime.id + '/edit', { user: 'alice', body: { revision: onTime.revision, answers: { note: '补交修改' } } });
  assert.equal((await edit()).data.error, 'EDIT_CLOSED');
  assert.equal((await f.call(roundPath, { user: 'alice', body: { revision: item.revision, policy: 'allow-late' } })).status, 403);
  const { data: { item: reopened } } = await patch({ revision: item.revision, policy: 'allow-late' });
  assert.equal(reopened.rounds[0].open, true);
  assert.equal(reopened.rounds[0].deadline, deadline);
  const { data: { submission: edited } } = await edit();
  assert.equal(edited.createdAt, onTime.createdAt);
  assert.equal(edited.submittedAt, deadline);
  assert.equal(edited.late, true);
  const { data: { submission: uploaded } } = await f.submit(item, 'bob');
  assert.equal(uploaded.submittedAt, deadline);
  assert.equal(uploaded.status, 'pending_review');
  assert.equal(uploaded.late, true);
  assert.equal((await f.repo.latest(collectionKeys.submission(item.id, item.rounds[0].id, uploaded.id))).late, true);
  const { data: { submission: approved } } = await f.call('/submissions/' + uploaded.id + '/review', {
    user: 'admin', body: { revision: uploaded.revision, status: 'accepted' },
  });
  assert.equal(approved.status, 'accepted');
  assert.equal(approved.late, true);
  const future = '2026-12-01T12:00:00.000Z';
  assert.equal((await patch({ revision: reopened.revision, deadline: future })).data.error, 'LATE_REQUIRES_DEADLINE');
  const { data: { item: stopped } } = await patch({ revision: reopened.revision, deadline: future, policy: 'closed' });
  assert.equal(stopped.rounds[0].open, false);
  assert.equal((await f.call(path)).status, 200);
  assert.equal((await f.submit(item, 'bob')).data.error, 'COLLECTION_CLOSED');
  const board = (await f.call(roundPath + '/submissions', { user: 'admin' })).data;
  assert.equal(board.progress.late, 2);
  assert.equal(board.items.find((row) => row.id === uploaded.id).late, true);
});

test('historical receipts retain their recorded late decisions at a restored cutoff', () => {
  const deadline = '2026-06-15T15:00:00.000Z';
  const base = { deadline, submittedAt: deadline };
  assert.equal(submissionWasLate({ ...base, status: 'submitted' }), false);
  assert.equal(submissionWasLate({ ...base, status: 'accepted' }), false);
  assert.equal(submissionWasLate({ ...base, status: 'accepted', late: true }), true);
  assert.equal(submissionWasLate({ ...base, status: 'late' }), true);
  assert.equal(submissionWasLate({ ...base, status: 'accepted', submittedAt: '2026-06-15T15:00:00.001Z' }), true);
});

test('signed uploads survive a deadline, finalize concurrently and leave only their immutable final attachment', async () => {
  const f = await collectionsFixture();
  const deadline = '2026-11-22T12:00:10Z';
  const item = await f.create({ round: { deadline, fields: [note, attachment] } });
  const list = f.store.list;
  f.store.list = async (options) => {
    if (options.prefix.includes('/rate/collection-submit/')) f.advance(10_000);
    return list(options);
  };
  const result = await f.submit(item, 'alice', { answers: { note: '私密' }, files: [{ fieldId: 'upload', name: '材料.txt', size: 7, type: 'text/plain' }] });
  f.store.list = list;
  assert.equal(result.status, 201);
  assert.equal(result.data.submission.status, 'uploading');
  assert.equal((await f.complete(result.data)).data.error, 'UPLOAD_MISMATCH');
  const upload = f.gateway.uploads.at(-1);
  f.gateway.upload(upload, 'fixture');
  f.advance(1000);
  assert.equal((await f.submit(item, 'bob')).data.error, 'COLLECTION_CLOSED');
  const completions = await Promise.all([f.complete(result.data), f.complete(result.data)]);
  for (const completed of completions) {
    assert.equal(completed.status, 200);
    assert.equal(completed.data.submission.status, 'submitted');
    assert.equal(completed.data.submission.late, false);
    for (const key of ['studentId', 'studentName', 'files', 'answers']) assert.ok(!Object.hasOwn(completed.data.submission, key));
  }
  assert.deepEqual(completions[0].data, completions[1].data);
  assert.equal(f.gateway.objects.has(upload.objectKey), false);
  assert.equal(f.gateway.objects.size, 1);
  assert.equal((await f.complete(result.data)).status, 200);
  const { id, files: [file] } = result.data.submission;
  const download = '/submissions/' + id + '/files/' + file.id + '/download';
  assert.equal((await f.call(download, { body: {} })).status, 401);
  assert.equal((await f.call(download, { user: 'bob', body: {} })).status, 404);
  assert.equal((await f.call(download, { user: 'alice', body: {}, csrf: false })).status, 403);
  const owns = await f.call(download, { user: 'alice', body: {} });
  assert.equal(owns.status, 200);
  assert.equal(owns.data.download.headers['If-Match'], [...f.gateway.objects.values()][0].etag);
  assert.equal((await f.call(f.roundPath(item) + '/files', { user: 'owner', body: { submissionIds: [id] } })).data.files[0].name, '材料.txt');
});

test('scoped file exports validate every selected submission before signing attachments', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ visibility: 'public', round: { fields: [note, { ...note, id: 'private-note' }, attachment] } });
  async function upload(user, note) {
    const started = await f.submit(item, user, {
      answers: { note, 'private-note': '不用于命名' },
      files: [{ fieldId: 'upload', name: '材料.txt', size: 7, type: 'text/plain' }],
    });
    assert.equal(started.status, 201);
    f.gateway.upload(f.gateway.uploads.at(-1), 'fixture');
    assert.equal((await f.complete(started.data)).status, 200);
    return started.data.submission.id;
  }
  const first = await upload('alice', '甲实验组');
  const second = await upload('bob', '乙实验组');
  const otherItem = await f.create();
  const outside = (await f.submit(otherItem, 'alice')).data.submission.id;
  const path = f.roundPath(item) + '/files';
  const sign = f.gateway.presignDownload;
  let signed = 0;
  f.gateway.presignDownload = (...args) => { signed++; return sign(...args); };

  assert.equal((await f.call(path, { user: 'owner', body: { submissionIds: [first, outside] } })).data.error, 'EXPORT_SUBMISSION_NOT_FOUND');
  assert.equal((await f.call(path, { user: 'alice', body: { submissionIds: [first] } })).status, 403);
  assert.equal((await f.call(path, { user: 'owner', body: { submissionIds: [first] }, csrf: false })).status, 403);
  assert.equal((await f.call(path, { user: 'owner', body: { submissionIds: 'all' } })).data.error, 'INVALID_EXPORT_SELECTION');
  assert.equal((await f.call(path, { user: 'owner', body: { submissionIds: [first], answerFieldIds: ['*'] } })).data.error, 'INVALID_EXPORT_FIELDS');
  assert.deepEqual((await f.call(path, { user: 'owner', body: { submissionIds: [] } })).data.files, []);
  assert.equal(signed, 0);

  const scoped = await f.call(path, { user: 'owner', body: { submissionIds: [first, first], answerFieldIds: ['note'] } });
  assert.equal(scoped.status, 200);
  const [{ id, submissionId, revision, fieldLabel, answers, download }] = scoped.data.files;
  assert.equal(submissionId, first);
  assert.equal(fieldLabel, '附件');
  assert.deepEqual(answers, { note: '甲实验组' });
  assert.equal(download, undefined);
  const all = await f.call(path, { user: 'owner', body: { submissionIds: [first, second] } });
  assert.equal(signed, 0);
  assert.deepEqual(new Set(all.data.files.map(file => file.submissionId)), new Set([first, second]));
  assert.ok(all.data.files.every(file => !Object.hasOwn(file, 'answers')));
  assert.equal((await f.call(path, { user: 'owner' })).status, 405);

  const selected = { id, submissionId, revision };
  assert.equal((await f.call(path, { user: 'alice', body: { attachments: [selected] } })).status, 403);
  assert.equal((await f.call(path, { user: 'owner', body: { attachments: [selected] }, csrf: false })).status, 403);
  assert.equal((await f.call(path, { user: 'owner', body: { attachments: [selected, { ...selected, revision: revision + 1 }] } })).data.error, 'EXPORT_CHANGED');
  assert.equal((await f.call(path, { user: 'owner', body: { attachments: [{ ...selected, submissionId: outside }] } })).data.error, 'EXPORT_CHANGED');
  assert.equal((await f.call(path, { user: 'owner', body: { attachments: [{ ...selected, id: 'wrong' }] } })).data.error, 'EXPORT_CHANGED');
  assert.equal(signed, 0);
  const authorized = await f.call(path, { user: 'owner', body: { attachments: [selected] } });
  assert.equal(authorized.status, 200);
  assert.equal(signed, 1);
  assert.deepEqual(Object.keys(authorized.data.files[0]).sort(), ['download', 'id', 'revision', 'submissionId']);
  assert.ok(authorized.data.files[0].download.headers['If-Match']);
});

test('a collection names the same verified attachment on the student receipt and in its export', async () => {
  const f = await collectionsFixture();
  const pattern = '{学号}-{姓名}-实验2报告';
  const item = await f.create({
    targetMode: 'selected', recipients: [{ studentId: 'TEST1001', name: '名单显示名' }], attachmentNamePattern: pattern,
    round: { fields: [{ ...attachment, extensions: ['docx'] }] },
  });
  assert.equal(item.attachmentNamePattern, pattern);
  assert.equal(item.hasAttachmentNamePattern, true);
  const path = f.itemPath(item);
  const filesPath = f.roundPath(item) + '/files';
  const participant = (await f.call(path, { user: 'alice' })).data.item;
  assert.equal(participant.hasAttachmentNamePattern, true);
  assert.equal(participant.attachmentNamePattern, undefined);
  assert.equal((await f.call(path, { user: 'bob' })).status, 404);
  const original = '我的第二次实验.DOCX';
  const named = 'TEST1001-甲学生-实验2报告.DOCX';
  const started = await f.submit(item, 'alice', {
    answers: {}, files: [{ fieldId: 'upload', name: original, size: 7, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
  });
  assert.equal(started.status, 201);
  assert.equal(started.data.submission.files[0].name, original);
  assert.equal(started.data.submission.files[0].archiveName, named);
  f.gateway.upload(f.gateway.uploads.at(-1), 'fixture');
  const completed = (await f.complete(started.data)).data.submission;
  assert.equal(completed.status, 'submitted');
  assert.equal(completed.files, undefined);
  const { id } = completed;
  const ownFile = (await f.call(path, { user: 'alice' })).data.mySubmissions[0].files[0];
  assert.equal(ownFile.name, original);
  assert.equal(ownFile.archiveName, named);
  assert.equal((await f.call(filesPath, { user: 'alice', body: { submissionIds: [id] } })).status, 403);
  const preview = (await f.call(filesPath, { user: 'owner', body: { submissionIds: [id] } })).data;
  assert.equal(preview.attachmentNamePattern, pattern);
  assert.equal(preview.files[0].name, original);
  assert.equal(preview.files[0].archiveName, named);
  const selection = { id: ownFile.id, submissionId: id, revision: completed.revision };
  const signed = async () => (await f.call(filesPath, { user: 'owner', body: { attachments: [selection] } })).data.files[0];
  const exportFile = await signed();
  assert.equal(exportFile.archiveName, named);
  assert.equal(exportFile.download.fileName, original);

  const edit = (body) => f.call(path, { user: 'owner', body });
  for (const invalid of ['{姓名}-{伪造字段}', '{学号', '前缀/文件']) {
    assert.equal((await edit({ revision: item.revision, attachmentNamePattern: invalid })).data.error, 'INVALID_ATTACHMENT_NAME_PATTERN');
  }
  const updated = (await edit({ revision: item.revision, attachmentNamePattern: '{班级}-{批次}-{附件项}-{原文件名}' })).data.item;
  const changed = '运营支持部-首轮-附件-我的第二次实验.DOCX';
  assert.equal((await signed()).archiveName, changed);
  assert.equal((await f.call(`/submissions/${id}`, { user: 'alice' })).data.submission.files[0].archiveName, changed);
  const cleared = (await edit({ revision: updated.revision, attachmentNamePattern: '' })).data.item;
  assert.equal(cleared.hasAttachmentNamePattern, false);
  assert.equal((await signed()).archiveName, undefined);
  assert.equal((await f.call(`/submissions/${id}`, { user: 'alice' })).data.submission.files[0].name, original);
});

test('an attachment copy with changed bytes and an ambiguous commit retain distinct safety guarantees', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { fields: [note, attachment] } });
  const result = await f.submit(item, 'alice', { answers: { note: '安全' }, files: [{ fieldId: 'upload', name: '材料.txt', size: 7, type: 'text/plain' }] });
  const upload = f.gateway.uploads.at(-1);
  f.gateway.upload(upload, 'fixture');
  const originalCopy = f.gateway.copy;
  f.gateway.copy = async (...args) => { f.gateway.upload(upload, 'changed'); await originalCopy(...args); };
  assert.equal((await f.complete(result.data)).data.error, 'UPLOAD_CHANGED');
  assert.equal([...f.gateway.objects.keys()].filter((key) => key.includes('/final/')).length, 0);
  f.gateway.copy = originalCopy;
  const originalSet = f.store.setJSON;
  f.store.setJSON = async (key, ...args) => {
    await originalSet(key, ...args);
    if (key.includes('/collection/submissions/') && key.endsWith('/00000001.json')) throw new Error('response not received');
  };
  await assert.rejects(f.complete(result.data), /response not received/);
  assert.equal([...f.gateway.objects.keys()].filter((key) => key.includes('/final/')).length, 1);
  f.store.setJSON = originalSet;
  assert.equal((await f.complete(result.data)).status, 200);
});

test('a first upload and its completion reuse quota revisions and preserve one durable cleanup task', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { fields: [note, attachment] } });
  const roundId = item.rounds[0].id;
  const quota = 'platform-v1/' + collectionKeys.quota(item.id, roundId) + '/';
  const cleanup = 'platform-v1/' + collectionKeys.cleanup(item.id, roundId);
  const calls = { quota: 0, cleanup: 0 };
  const { list, setJSON } = f.store;
  f.store.list = (options) => {
    if (options.prefix === quota) calls.quota++;
    return list(options);
  };
  f.store.setJSON = (key, value, options) => {
    if (key.startsWith(cleanup) && options?.onlyIfNew) calls.cleanup++;
    return setJSON(key, value, options);
  };
  const result = await f.submit(item, 'alice', {
    answers: { note: '资料' }, files: [{ fieldId: 'upload', name: '资料.txt', type: 'text/plain', size: 3 }],
  });
  assert.equal(result.status, 201);
  assert.deepEqual(calls, { quota: 1, cleanup: 1 });
  const task = await f.repo.get(collectionKeys.cleanup(item.id, roundId, result.data.receiptId));
  assert.equal(task.staging.length, 1);
  f.gateway.upload(f.gateway.uploads.at(-1), 'one');
  assert.equal((await f.complete(result.data)).status, 200);
  assert.deepEqual(calls, { quota: 2, cleanup: 1 });
  const saved = await f.repo.latest(collectionKeys.quota(item.id, roundId));
  assert.deepEqual(saved.active, {});
  assert.equal(saved.completed[result.data.submission.id], 'TEST1001');
});

test('multiple quotas reserve from one bounded set under concurrency and replacement holds one place', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { submissionMode: 'multiple', maxPerUser: 2, maxSubmissions: 3 } });
  const sameUser = await Promise.all(Array.from({ length: 5 }, () => f.submit(item, 'alice')));
  assert.equal(sameUser.filter((response) => response.status === 201).length, 2);
  assert.equal(sameUser.filter((response) => response.data.error === 'USER_LIMIT_REACHED').length, 3);
  const concurrent = await Promise.all([f.submit(item, 'bob'), f.submit(item, 'bob')]);
  assert.equal(concurrent.filter((response) => response.status === 201).length, 1);
  assert.equal(concurrent.filter((response) => response.data.error === 'COLLECTION_FULL').length, 1);
  const count = await f.call(f.roundPath(item) + '/submissions', { user: 'owner' });
  assert.equal(count.data.progress.records, 3);
  const lower = await f.call(f.roundPath(item), { user: 'owner', body: { revision: item.revision, maxSubmissions: 1 } });
  assert.equal(lower.status, 200);
  assert.equal((await f.submit(item, 'admin')).data.error, 'COLLECTION_FULL');
  const replacement = await f.create({ round: { maxSubmissions: 1 } });
  const before = await f.submit(replacement, 'alice');
  const after = await f.submit(replacement, 'alice', { answers: { note: '替换' }, files: [] });
  assert.equal(before.status, 201);
  assert.equal(after.status, 201);
  assert.equal(after.data.submission.id, before.data.submission.id);
  assert.equal(after.data.submission.revision, 2);
  assert.equal((await f.submit(replacement, 'bob')).data.error, 'COLLECTION_FULL');
});

test('a stable attempt resends the same reservation while cancelled or expired uploads return both slots', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { fields: [note, attachment], submissionMode: 'multiple', maxPerUser: 1, maxSubmissions: 1 } });
  const body = { attemptId: randomUUID(), answers: { note: '内容' }, files: [{ fieldId: 'upload', name: '资料.txt', type: 'text/plain', size: 3 }] };
  const first = await f.submit(item, 'alice', body);
  const firstObject = f.gateway.uploads.at(-1);
  f.gateway.upload(firstObject, 'one');
  const again = await f.submit(item, 'alice', body);
  assert.equal(first.data.receiptId, again.data.receiptId);
  assert.equal(firstObject.objectKey, f.gateway.uploads.at(-1).objectKey);
  assert.equal((await f.submit(item, 'alice', { ...body, answers: { note: '新内容' } })).data.error, 'ATTEMPT_CHANGED');
  assert.equal((await f.submit(item, 'bob', body)).data.error, 'COLLECTION_FULL');
  assert.deepEqual((await f.cancel(first.data)).data, { cancelled: true });
  assert.deepEqual((await f.cancel(first.data)).data, { cancelled: true });
  assert.equal((await f.complete(first.data)).data.error, 'SUBMISSION_EXPIRED');
  assert.equal((await f.submit(item, 'alice', body)).status, 410);
  assert.equal(f.gateway.objects.has(firstObject.objectKey), false);
  const second = await f.submit(item, 'bob', body);
  assert.equal(second.status, 201);
  const secondObject = f.gateway.uploads.at(-1);
  f.gateway.upload(secondObject, 'two');
  f.advance(65 * 60_000 + 2_000);
  assert.equal((await f.complete(second.data)).status, 410);
  const third = await f.submit(item, 'bob', { ...body, attemptId: randomUUID() });
  assert.equal(third.status, 201);
  assert.equal(f.gateway.objects.has(secondObject.objectKey), true);
  f.gateway.upload(f.gateway.uploads.at(-1), 'new');
  assert.equal((await f.complete(third.data)).status, 200);
  assert.equal(f.gateway.objects.has(secondObject.objectKey), false);
  assert.equal((await f.cancel(third.data)).data.error, 'SUBMISSION_COMMITTED');
  assert.equal((await f.complete(third.data)).status, 200);
  const count = (await f.call(f.roundPath(item) + '/submissions', { user: 'owner' })).data.progress;
  assert.equal(count.records, 1);
});

test('attachment confirmation overlaps independent copies and removes them if another attachment fails validation', { timeout: 5_000 }, async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { fields: [note, { ...attachment, maxFiles: 2 }] } });
  const staged = await f.submit(item, 'alice', {
    answers: { note: '内容' },
    files: ['甲.txt', '乙.txt'].map(name => ({ fieldId: 'upload', name, type: 'text/plain', size: 3 })),
  });
  const [first, absent] = f.gateway.uploads;
  f.gateway.upload(first, 'one');
  let startCopy, releaseCopy, verifyMissing, releaseMissing;
  const copying = new Promise(resolve => { startCopy = resolve; });
  const readyToCopy = new Promise(resolve => { releaseCopy = resolve; });
  const missingChecked = new Promise(resolve => { verifyMissing = resolve; });
  const readyToCheckMissing = new Promise(resolve => { releaseMissing = resolve; });
  const { head, copy } = f.gateway;
  f.gateway.head = async key => {
    if (key !== absent.objectKey) return head(key);
    await readyToCheckMissing;
    const result = await head(key);
    verifyMissing();
    return result;
  };
  f.gateway.copy = async (...args) => {
    startCopy();
    await readyToCopy;
    return copy(...args);
  };
  const confirming = f.complete(staged.data);
  try {
    await copying;
    releaseMissing();
    await missingChecked;
  } finally {
    releaseMissing();
    releaseCopy();
  }
  assert.equal((await confirming).data.error, 'UPLOAD_MISMATCH');
  assert.equal(await f.repo.get(collectionKeys.locator(staged.data.submission.id)), null);
  assert.equal(f.gateway.objects.size, 1);
  assert.equal(f.gateway.objects.has(first.objectKey), true);
});

test('a cancelled confirmation cannot settle after its files have been copied', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { fields: [note, attachment] } });
  const body = { answers: { note: '内容' }, files: [{ fieldId: 'upload', name: '资料.txt', type: 'text/plain', size: 3 }] };
  const first = await f.submit(item, 'alice', body);
  f.gateway.upload(f.gateway.uploads.at(-1), 'old');
  const copy = f.gateway.copy;
  let copied, resume;
  const started = new Promise((resolve) => { copied = resolve; });
  const released = new Promise((resolve) => { resume = resolve; });
  f.gateway.copy = async (...args) => { await copy(...args); copied(); await released; };
  const confirming = f.complete(first.data);
  await started;
  assert.deepEqual((await f.cancel(first.data)).data, { cancelled: true });
  resume();
  assert.equal((await confirming).data.error, 'SUBMISSION_EXPIRED');
  assert.equal(f.gateway.objects.size, 0);
  assert.equal((await f.submit(item, 'alice', body)).status, 201);
});

test('a cancellation cannot report success after a concurrent confirmation used its slot', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { fields: [note, attachment] } });
  const staged = await f.submit(item, 'alice', {
    answers: { note: '内容' }, files: [{ fieldId: 'upload', name: '资料.txt', type: 'text/plain', size: 3 }],
  });
  f.gateway.upload(f.gateway.uploads.at(-1), 'one');
  const quota = 'platform-v1/' + collectionKeys.quota(item.id, item.rounds[0].id) + '/';
  let readStarted, resume;
  const waiting = new Promise(resolve => { readStarted = resolve; });
  const released = new Promise(resolve => { resume = resolve; });
  const list = f.store.list;
  let delayed = false;
  f.store.list = async options => {
    if (options.prefix === quota && !delayed) {
      delayed = true;
      readStarted();
      await released;
    }
    return list(options);
  };
  const cancelling = f.cancel(staged.data);
  await waiting;
  try {
    assert.equal((await f.complete(staged.data)).status, 200);
  } finally {
    resume();
  }
  assert.equal((await cancelling).data.error, 'SUBMISSION_COMMITTED');
});

test('slow storage cleanup cannot fail an already confirmed upload', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { fields: [note, attachment] } });
  const staged = await f.submit(item, 'alice', { answers: { note: '内容' }, files: [{ fieldId: 'upload', name: '资料.txt', size: 3, type: 'text/plain' }] });
  const upload = f.gateway.uploads.at(-1);
  f.gateway.upload(upload, 'one');
  const remove = f.gateway.delete;
  f.gateway.delete = (_key, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  assert.equal((await f.complete(staged.data)).status, 200);
  assert.equal(f.gateway.objects.has(upload.objectKey), true);
  f.gateway.delete = remove;
  assert.equal((await f.complete(staged.data)).status, 200);
  assert.equal(f.gateway.objects.has(upload.objectKey), false);
});

test('replacement preserves retained files, retries cleanup and rejects noncanonical attachment paths', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { fields: [note, attachment,
    { ...attachment, id: 'keep', label: '保留', required: false }, { ...attachment, id: 'legacy', label: '历史', required: false }] } });
  const file = (fieldId, name) => ({ fieldId, name, type: 'text/plain', size: 3 });
  const first = await f.submit(item, 'alice', { answers: { note: '旧答卷' }, files: [file('upload', '旧.txt'), file('keep', '保留.txt')] });
  for (const upload of f.gateway.uploads) f.gateway.upload(upload, 'old');
  assert.equal((await f.complete(first.data)).status, 200);
  const roundId = item.rounds[0].id;
  const prefix = collectionKeys.submission(item.id, roundId, first.data.submission.id);
  const current = await f.repo.latest(prefix);
  const replaced = current.files.find((row) => row.fieldId === 'upload');
  const kept = current.files.find((row) => row.fieldId === 'keep');
  const legacyPath = 'studev-submissions/legacy/historical-shared-file';
  f.gateway.objects.set(legacyPath, { size: 3 });
  const legacy = { ...replaced, id: randomUUID(), fieldId: 'legacy', objectKey: legacyPath };
  await f.repo.append(prefix, { ...current, files: [...current.files, legacy] }, current.revision);
  const download = await f.call(`/submissions/${current.id}/files/${legacy.id}/download`, { user: 'alice', body: {} });
  assert.equal(download.status, 409);
  const second = await f.submit(item, 'alice', { answers: { note: '新答卷' }, keepFiles: [kept.id], files: [file('upload', '新.txt')] });
  f.gateway.upload(f.gateway.uploads.at(-1), 'new');
  const remove = f.gateway.delete;
  f.gateway.delete = (key) => key === replaced.objectKey ? Promise.reject(new Error('busy')) : remove(key);
  assert.equal((await f.complete(second.data)).status, 200);
  assert.equal(f.gateway.objects.has(replaced.objectKey), true);
  assert.equal(f.gateway.objects.has(kept.objectKey), true);
  f.gateway.delete = remove;
  const third = await f.submit(item, 'bob', { answers: { note: '另一份答卷' }, files: [file('upload', '另交.txt')] });
  assert.equal(third.status, 201);
  assert.equal(f.gateway.objects.has(replaced.objectKey), true);
  assert.deepEqual((await f.cancel(third.data)).data, { cancelled: true });
  assert.equal(f.gateway.objects.has(replaced.objectKey), false);
  assert.equal(f.gateway.objects.has(kept.objectKey), true);
  assert.equal(f.gateway.objects.has(legacyPath), true);
  assert.equal((await f.repo.latest(prefix)).files.filter((row) => row.fieldId === 'upload')[0].name, '新.txt');
});

test('cutover seeds a live legacy upload and current submissions without counting a completed receipt twice', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ round: { fields: [note, attachment], submissionMode: 'multiple', maxPerUser: 1, maxSubmissions: 2 } });
  const body = { answers: { note: '资料' }, files: [{ fieldId: 'upload', name: '资料.txt', type: 'text/plain', size: 3 }] };
  const current = await f.submit(item, 'alice', body);
  f.gateway.upload(f.gateway.uploads.at(-1), 'one');
  assert.equal((await f.complete(current.data)).status, 200);
  const pending = await f.submit(item, 'bob', body);
  f.gateway.upload(f.gateway.uploads.at(-1), 'two');
  const roundId = item.rounds[0].id;
  const prefix = collectionKeys.quota(item.id, roundId);
  for (const key of await f.repo.list(prefix + '/')) await f.repo.remove(key);
  const receipts = [];
  for (const { data: { receiptId } } of [current, pending]) {
    const { payloadDigest, discarded, ...legacy } = await f.repo.get(collectionKeys.request(receiptId));
    await f.repo.put(collectionKeys.request(receiptId), legacy);
    receipts.push([receiptId, legacy]);
  }
  const seeded = await seedRoundQuota(f.repo, item.id, roundId, receipts);
  assert.equal(Object.keys(seeded.completed).length, 1);
  assert.deepEqual(Object.keys(seeded.active), [pending.data.receiptId]);
  await f.repo.putNew(revisionKey(prefix, 1), { ...seeded, revision: 1 });
  assert.equal((await f.submit(item, 'admin', body)).data.error, 'COLLECTION_FULL');
  assert.equal((await f.complete(pending.data)).status, 200);
  assert.equal((await f.complete(current.data)).status, 200);
});

test('only verified identities inherit unclaimed historical submissions, while anonymous history stays staff-only', async () => {
  const f = await collectionsFixture();
  const item = await f.create({ visibility: 'public' });
  const time = new Date().toISOString();
  const seed = async (studentId, userId = null) => {
    const record = { id: randomUUID(), itemId: item.id, roundId: item.rounds[0].id, userId, studentId,
      studentName: '历史记录', answers: { note: '历史内容' }, files: [], fields: [note], createdAt: time, submittedAt: time, status: 'submitted' };
    await locateSubmission(f.repo, record);
    await f.repo.append(collectionKeys.submission(item.id, record.roundId, record.id), record);
    if (studentId && !userId) {
      await f.repo.putNew(collectionKeys.student(studentId) + item.id + '/' + record.roundId + '/' + record.id + '.json', {});
      await f.repo.putNew(collectionKeys.replacement(item.id, record.roundId, studentId), { id: record.id });
    }
    return record.id;
  };
  const historic = await seed('TEST1001');
  const anonymous = await seed('');
  assert.equal((await f.call('/mine', { user: 'alice' })).data.items.length, 0);
  assert.equal((await f.call('/submissions/' + historic, { user: 'alice' })).status, 404);
  f.users.alice.identityVerified = true;
  assert.deepEqual((await f.call('/mine', { user: 'alice' })).data.items.map(({ id }) => id), [historic]);
  assert.equal((await f.call('/submissions/' + historic, { user: 'alice' })).status, 200);
  assert.equal((await f.call('/submissions/' + anonymous, { user: 'alice' })).status, 404);
  assert.equal((await f.call('/submissions/' + anonymous, { user: 'owner' })).status, 200);
  const replaced = await f.submit(item, 'alice');
  assert.equal(replaced.status, 201);
  assert.equal(replaced.data.submission.id, historic);
  assert.equal((await f.call('/mine', { user: 'alice' })).data.items.length, 1);
  f.users.alice.identityVerified = false;
  assert.equal((await f.call('/submissions/' + historic, { user: 'alice' })).status, 200);
});

test('field and answer primitives reject malformed schemas and inconsistent payloads', async () => {
  const f = await collectionsFixture();
  const schema = { name: '校验', term: '2026-2027-1', issuerOrganizationId: orgA, rounds: [{ label: '一轮', fields: [note, note] }] };
  assert.equal((await f.call('/items', { user: 'owner', body: { ...schema, term: '2026-2028-1' } })).data.error, 'INVALID_SEMESTER');
  assert.equal((await f.call('/items', { user: 'owner', body: schema })).status, 400);
  assert.equal((await f.call('/items', { user: 'owner', body: { ...schema, rounds: [{ label: '一轮', fields: [{ ...note, id: undefined }] }] } })).status, 400);
  const item = await f.create({ round: { fields: [
    { id: 'day', type: 'date', label: '日期', required: true },
    { id: 'qty', type: 'number', label: '数量', min: 0, max: 3 },
    { id: 'choices', type: 'checkbox', label: '选项', options: ['甲', '乙'] },
  ] } });
  for (const answers of [
    { day: '2026-02-30' }, { day: '2026-11-22', qty: 4 }, { day: '2026-11-22', injected: true },
    { day: '2026-11-22', choices: ['甲', '甲'] },
  ]) assert.equal((await f.submit(item, 'alice', { answers })).status, 400);
});

test('dynamic org tree, batch pre-import without QQ, and seamless pending student self-activation', async () => {
  const store = memoryBlob();
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
