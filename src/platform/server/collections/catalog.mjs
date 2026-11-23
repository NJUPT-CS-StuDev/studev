import { fail } from '../common.mjs';
import { canManage, isRecipient, issuerView, openRound } from './definition.mjs';
import { collectionId, collectionKeys as keys, mapConcurrent, parseHistoryKey, studentId } from './records.mjs';
import { ownsSubmission, submissionView } from './submissions.mjs';

const recency = (a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)) || b.id.localeCompare(a.id);

export async function readItem(repo, id) {
  const item = collectionId.test(id) && await repo.latest(keys.definition(id));
  if (!item) fail(404, 'NOT_FOUND', '收集不存在。');
  return item;
}

export function readRound(item, id) {
  const round = item.rounds.find((row) => row.id === id);
  if (!round) fail(404, 'NOT_FOUND', '轮次不存在。');
  return round;
}

export async function definitions(repo) {
  const tips = await repo.heads(keys.definitions);
  const items = await mapConcurrent([...tips.values()], 20, repo.readRevision);
  return items.filter(Boolean).sort((a, b) =>
    String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt)) || b.id.localeCompare(a.id));
}

export async function myRecords(repo, viewer, itemIds = null) {
  if (!viewer.user || viewer.view === 'guest') return [];
  const sid = studentId(viewer.user.studentId);
  const prefixes = [keys.user(viewer.user.id)];
  if (viewer.user.identityVerified && /^[A-Z0-9]{4,24}$/.test(sid)) prefixes.push(keys.student(sid));
  const itemPrefix = itemIds?.size === 1 ? [...itemIds][0] + '/' : '';
  const entries = await Promise.all(prefixes.map(async (prefix) =>
    (await repo.list(prefix + itemPrefix)).map((key) => parseHistoryKey(prefix, key))));
  const locations = [...new Map(entries.flat().filter((row) => row && (!itemIds || itemIds.has(row.itemId)))
    .map((row) => [row.id, row])).values()];
  const records = await mapConcurrent(locations, 16, ({ itemId, roundId, id }) => repo.latest(keys.submission(itemId, roundId, id)));
  return records.filter((record) => record && ownsSubmission(record, viewer.user)).sort(recency);
}

export async function roundRecords(repo, itemId, roundId = null) {
  const prefix = roundId ? keys.round(itemId, roundId) : keys.submissions + '/' + itemId;
  const heads = await repo.heads(prefix);
  const records = await mapConcurrent([...heads.values()], 24, repo.readRevision);
  return records.filter((row) => row && row.itemId === itemId && (!roundId || row.roundId === roundId)).sort(recency);
}

function complete(record) {
  return record.fields.every((field) => !field.required || (field.type === 'file'
    ? record.files.some((file) => file.fieldId === field.id) : Object.hasOwn(record.answers, field.id)));
}

function statusFor(record) {
  return record && complete(record) ? record.status : 'missing';
}

function roundSummary(item, round, actor, byRound, now) {
  const eligible = isRecipient(item, actor);
  const myRecord = byRound.get(round.id);
  const { id, label, deadline, policy, fields } = round;
  return {
    id, label, deadline, policy, open: openRound(item, round, now), fieldCount: fields.length,
    fileCount: fields.filter((field) => field.type === 'file').length,
    ...(item.targetMode === 'selected' ? { totalCount: item.recipients.length } : {}),
    myStatus: eligible || myRecord ? statusFor(myRecord) : null,
  };
}

export function itemView(item, viewer, organizations, ownRecords, now, detail = false) {
  const { id, name, description, tags, term, termLabel, course, issuer, visibility, status, targetMode,
    publishedAt, updatedAt, revision, rounds, recipients } = item;
  const ownByRound = new Map();
  for (const record of ownRecords) {
    if (!ownByRound.has(record.roundId)) ownByRound.set(record.roundId, record);
  }
  const actor = viewer.view === 'guest' ? null : viewer.user;
  const manage = canManage(item, viewer, organizations);
  const safeIssuer = issuerView(issuer, organizations);
  if (!manage && actor?.id !== issuer.userId) safeIssuer.name = '';
  return {
    id, name, description, tags, term, termLabel, course, issuer: safeIssuer,
    visibility, status, targetMode, publishedAt, updatedAt, revision, recipientCount: recipients.length,
    ...(manage && detail ? { recipients } : {}),
    canManage: manage && !viewer.preview, inRecipients: isRecipient(item, actor),
    rounds: rounds.map((round) => ({
      ...(detail ? round : {}),
      ...roundSummary(item, round, actor, ownByRound, now),
    })),
  };
}

export function boardFor(item, records, rounds = item.rounds) {
  const people = new Map(item.recipients.map(({ studentId, name }) =>
    [studentId, { studentId, name, orgLabel: '', statuses: Object.create(null) }]));
  const byRound = new Map(rounds.map((round) => [round.id, new Map()]));
  const recipientIds = new Set(people.keys());
  for (const record of records) {
    const key = record.studentId || record.userId || record.id;
    if (!people.has(key)) people.set(key, { studentId: record.studentId, name: record.studentName || '', orgLabel: '', statuses: Object.create(null) });
    const byPerson = byRound.get(record.roundId);
    if (byPerson && !byPerson.has(key) && complete(record)) byPerson.set(key, record);
  }
  const roundStats = rounds.map((round) => {
    const byPerson = byRound.get(round.id);
    let submitted = 0, late = 0;
    for (const [key, person] of people) {
      const record = byPerson.get(key);
      person.statuses[round.id] = statusFor(record);
      if (!record || (item.targetMode === 'selected' && !recipientIds.has(key))) continue;
      submitted++;
      if (round.deadline && Date.parse(record.submittedAt) > Date.parse(round.deadline)) late++;
    }
    const total = item.targetMode === 'selected' ? recipientIds.size : submitted;
    return { roundId: round.id, total, submitted, late, missing: Math.max(0, total - submitted) };
  });
  return {
    board: [...people.values()].sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)) || a.name.localeCompare(b.name)),
    roundStats,
  };
}

export function ownHistory(items, records) {
  return records.map((record) => {
    const item = items.get(record.itemId);
    return submissionView(record, item, item?.rounds.find((round) => round.id === record.roundId));
  });
}

export function directoryPeople(users, organizationIds) {
  return users.filter((user) => user.status !== 'disabled' && user.studentId).flatMap((user) => {
    const ids = [...new Set((user.memberships || []).map((membership) => membership.organizationId))];
    const visible = organizationIds ? ids.filter((id) => organizationIds.has(id)) : ids;
    return !organizationIds || visible.length
      ? [{ studentId: studentId(user.studentId), name: user.realName || user.nickname, organizationIds: visible }] : [];
  }).sort((a, b) => a.studentId.localeCompare(b.studentId));
}
