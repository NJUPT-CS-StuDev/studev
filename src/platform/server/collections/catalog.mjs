import { createHash } from 'node:crypto';
import { fail } from '../common.mjs';
import { collectionProgress, roundAcceptsSubmissions } from '../../collections.mjs';
import { activeMemberships } from '../../organizations.mjs';
import { canManage, canSeeProgress, isRecipient, issuerView } from './definition.mjs';
import { collectionId, collectionKeys as keys, mapConcurrent, parseHistoryKey, studentId } from './records.mjs';
import { ownsSubmission, submissionView, submissionWasLate } from './submissions.mjs';

const recency = (a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)) || b.id.localeCompare(a.id);

export async function readItem(repo, id) {
  const item = collectionId.test(id) && await repo.latest(keys.definition(id));
  if (!item || item.deleted) fail(404, 'NOT_FOUND', '收集不存在。');
  return item;
}

export function readRound(item, id) {
  const round = item.rounds.find((row) => row.id === id);
  if (!round) fail(404, 'NOT_FOUND', '轮次不存在。');
  return round;
}

export async function definitions(repo, tips) {
  const heads = tips ?? await repo.heads(keys.definitions);
  const items = await mapConcurrent([...heads.values()], 20, repo.readRevision);
  return items.filter((item) => item && !item.deleted).sort((a, b) =>
    String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt)) || b.id.localeCompare(a.id));
}

// Both the public catalog and staff boards derive from immutable revisions.
// Validate every snapshot against the strongly consistent listing before use.
async function projection(repo, key, prefix, build) {
  const [heads, snapshot] = await Promise.all([repo.heads(prefix), repo.get(key).catch(() => null)]);
  const ordered = [...heads.values()].sort((a, b) => a.key.localeCompare(b.key));
  const version = createHash('sha256').update(JSON.stringify(ordered.map(({ key, etag }) => [key, etag]))).digest('hex');
  if (snapshot?.version === version) return snapshot.rows;
  const rows = await build(heads);
  const value = { version, rows };
  if (Buffer.byteLength(JSON.stringify(value)) <= 2 * 1024 * 1024) {
    await repo.put(key, value).catch(() => {});
  }
  return rows;
}

export function catalogItems(repo) {
  return projection(repo, keys.catalog, keys.definitions, async (heads) => (await definitions(repo, heads)).map(item => ({
    ...item,
    recipients: item.recipients.map(({ studentId }) => ({ studentId })),
    rounds: item.rounds.map(({ id, label, deadline, policy, fields }) => ({
      id, label, deadline, policy, fieldCount: fields.length, fileCount: fields.filter(field => field.type === 'file').length,
    })),
  })));
}

export async function myRecords(repo, user, itemIds = null) {
  if (!user) return [];
  const sid = studentId(user.studentId);
  const prefixes = [keys.user(user.id)];
  if (user.identityVerified && /^[A-Z0-9]{4,24}$/.test(sid)) prefixes.push(keys.student(sid));
  const itemPrefix = itemIds?.size === 1 ? [...itemIds][0] + '/' : '';
  const entries = await Promise.all(prefixes.map(async (prefix) =>
    (await repo.list(prefix + itemPrefix)).map((key) => parseHistoryKey(prefix, key))));
  const locations = [...new Map(entries.flat().filter((row) => row && (!itemIds || itemIds.has(row.itemId)))
    .map((row) => [row.id, row])).values()];
  const records = await mapConcurrent(locations, 16, ({ itemId, roundId, id }) => repo.latest(keys.submission(itemId, roundId, id)));
  return records.filter((record) => record && ownsSubmission(record, user)).sort(recency);
}

export async function roundRecords(repo, itemId, roundId = null, tips) {
  const prefix = roundId ? keys.round(itemId, roundId) : keys.submissions + '/' + itemId;
  const heads = tips ?? await repo.heads(prefix);
  const records = await mapConcurrent([...heads.values()], 24, repo.readRevision);
  return records.filter((row) => row && row.itemId === itemId && (!roundId || row.roundId === roundId)).sort(recency);
}

function complete(record) {
  return record.fields.every((field) => !field.required || (field.type === 'file'
    ? record.files.some((file) => file.fieldId === field.id) : Object.hasOwn(record.answers, field.id)));
}

export function boardRecords(repo, itemId, roundId) {
  return projection(repo, keys.board(itemId, roundId), keys.round(itemId, roundId), async heads =>
    (await roundRecords(repo, itemId, roundId, heads)).map(record => {
      const { id, studentId, studentName, userId, roundId, status, submittedAt, createdAt } = record;
      return { id, studentId, studentName, userId, roundId, status, submittedAt, createdAt,
        complete: complete(record), late: submissionWasLate(record), fileBytes: record.files.reduce((bytes, file) => bytes + file.size, 0),
        hasFiles: record.files.length > 0 };
    }));
}

function recordComplete(record) {
  return record.complete ?? complete(record);
}

function statusFor(record) {
  return record && recordComplete(record) ? record.status : 'missing';
}

function roundSummary(item, round, actor, byRound, now, detail) {
  const eligible = isRecipient(item, actor);
  const myRecord = byRound.get(round.id);
  const { id, label, deadline, policy, fields } = round;
  return {
    id, label, deadline, policy, open: roundAcceptsSubmissions(item, round, now),
    fieldCount: round.fieldCount ?? fields.length,
    fileCount: round.fileCount ?? fields.filter((field) => field.type === 'file').length,
    ...(item.targetMode === 'selected' ? { totalCount: item.recipients.length } : {}),
    ...(detail ? { myStatus: eligible || myRecord ? statusFor(myRecord) : null } : {}),
  };
}

export function itemView(item, viewer, organizations, ownRecords, now, detail = false) {
  const { id, name, description, tags, term, course, issuer, visibility, status, targetMode,
    publishedAt, updatedAt, revision, rounds, recipients } = item;
  const ownByRound = new Map();
  for (const record of ownRecords) {
    if (!ownByRound.has(record.roundId)) ownByRound.set(record.roundId, record);
  }
  const actor = viewer.user;
  const manage = canManage(item, viewer, organizations);
  const safeIssuer = issuerView(issuer, organizations);
  if (!manage && actor?.id !== issuer.userId) safeIssuer.name = '';
  return {
    id, name, description, tags, term, course, issuer: safeIssuer,
    visibility, status, targetMode, publishedAt, updatedAt, revision, recipientCount: recipients.length,
    ...(manage && detail ? { recipients, showProgress: item.showProgress === true,
      audienceOrganizationId: targetMode === 'selected' ? item.audienceOrganizationId || issuer.organizationId : null } : {}),
    canManage: manage, inRecipients: isRecipient(item, actor),
    ...(detail ? { canViewProgress: manage || canSeeProgress(item, viewer) } : {}),
    rounds: rounds.map((round) => ({
      ...(detail ? round : {}),
      ...roundSummary(item, round, actor, ownByRound, now, detail),
    })),
  };
}

const order = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function boardFor(item, round, records, viewer, manage) {
  const selected = item.targetMode === 'selected';
  const roster = new Map(item.recipients.map(person => [person.studentId, person]));
  const people = new Map(item.recipients.map(person => [person.studentId, person]));
  const groups = new Map();
  const rows = [];
  const latest = new Map();
  const add = (row, person) => {
    rows.push(row);
    if (!selected) return;
    const id = person?.groupId || '';
    if (!groups.has(id)) groups.set(id, { id, label: person?.groupLabel || '待核对', rows: [] });
    groups.get(id).rows.push(row);
  };
  for (const person of roster.values()) {
    add({ id: person.studentId, studentId: person.studentId, expected: true, status: 'missing', late: false }, person);
  }
  let own;
  for (const record of records) {
    const key = record.studentId || record.userId || record.id;
    const person = roster.get(key);
    if (manage && !people.has(key)) people.set(key, { studentId: record.studentId, name: record.studentName || '' });
    const complete = recordComplete(record);
    add({ id: record.id, studentId: record.studentId, personId: record.userId, expected: !!person, submissionId: record.id,
      submittedAt: record.submittedAt, complete, status: record.status, late: submissionWasLate(record) }, person);
    if (complete) {
      if (!latest.has(key)) latest.set(key, record);
      if (!own && ownsSubmission(record, viewer.user)) own = record;
    }
  }
  const { counts } = collectionProgress(rows, selected);
  const progress = { ...counts, groups: [...groups.values()].map(({ id, label, rows }) => {
    const { counts } = collectionProgress(rows, true);
    return { id, label, ...counts };
  }).sort((a, b) => Number(!a.id) - Number(!b.id) || order.compare(a.label, b.label)),
  ownStatus: own?.status ?? (isRecipient(item, viewer.user) ? 'missing' : null),
  ownLate: own ? submissionWasLate(own) : false };
  if (!manage) return { progress };
  const board = [...people].map(([key, person]) => ({
    studentId: person.studentId, name: person.name,
    ...(person.groupId ? { orgId: person.groupId } : {}), orgLabel: person.groupLabel || '',
    statuses: { [round.id]: statusFor(latest.get(key)) },
  })).sort((a, b) => order.compare(a.studentId || '', b.studentId || '') || order.compare(a.name, b.name));
  return { progress, board };
}

export async function historyItems(repo, records) {
  const ids = [...new Set(records.map(record => record.itemId))];
  const items = await mapConcurrent(ids, 16, async id => [id, await repo.latest(keys.definition(id))]);
  return new Map(items.filter(([, item]) => item && !item.deleted));
}

export function ownHistory(items, records) {
  return records.map((record) => {
    const item = items.get(record.itemId);
    return submissionView(record, item, item?.rounds.find((round) => round.id === record.roundId));
  });
}

export function directoryPeople(users, organizationIds, today) {
  return users.filter((user) => user.status !== 'disabled' && user.studentId).flatMap((user) => {
    const ids = [...new Set(activeMemberships(user.memberships, today).map((membership) => membership.organizationId))];
    const visible = organizationIds ? ids.filter((id) => organizationIds.has(id)) : ids;
    return !organizationIds || visible.length
      ? [{ studentId: studentId(user.studentId), name: user.realName || user.nickname, organizationIds: visible }] : [];
  }).sort((a, b) => a.studentId.localeCompare(b.studentId));
}
