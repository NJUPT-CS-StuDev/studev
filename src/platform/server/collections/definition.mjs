import { randomUUID } from 'node:crypto';
import { fail, text } from '../common.mjs';
import { activeMemberships, flattenOrganizationTree, isWithin, organization, organizationName, organizationPath, positionLabel } from '../../organizations.mjs';
import { deadlineReached, isSemester, pinnedCollections } from '../../collections.mjs';
import { boolean, fields, integer, validObject } from './fields.mjs';
import { collectionId, studentId } from './records.mjs';

export const isManagement = (role) => role === 'admin' || role === 'owner';

export function viewerInfo(viewer, organizations) {
  const { user, today } = viewer;
  const isStaff = isManagement(user?.role);
  const issuerOptions = isStaff ? publishChoices(user, organizations, today) : [];
  return {
    issuerOptions,
    viewer: user ? { id: user.id, role: user.role, isStaff, canPublish: issuerOptions.length > 0 } : null,
  };
}

function scopes(memberships) {
  return memberships.flatMap((claim) =>
    [claim.organizationId, claim.overseesOrganizationId].filter(Boolean));
}

export function canManage(item, viewer, orgs) {
  if (viewer.user?.role === 'owner') return true;
  if (viewer.user?.role !== 'admin') return false;
  return scopes(activeMemberships(viewer.user.memberships, viewer.today))
    .some((scope) => isWithin(item.issuer.organizationId, scope, orgs));
}

export function isRecipient(item, user) {
  return Boolean(user && (item.targetMode === 'open' ||
    item.recipients.some((row) => row.studentId === studentId(user.studentId))));
}

export function canSee(item, viewer, orgs) {
  if (canManage(item, viewer, orgs)) return true;
  if (item.status === 'draft' || !item.publishedAt) return false;
  if (item.visibility === 'public') return true;
  return isRecipient(item, viewer.user);
}

export function canSeeProgress(item, viewer) {
  const { user } = viewer;
  return Boolean(item.showProgress && item.status !== 'draft' && item.publishedAt &&
    /^[A-Z0-9]{4,24}$/.test(studentId(user?.studentId)) &&
    (item.targetMode === 'open' || user.identityVerified) && isRecipient(item, user));
}

function publishChoices(user, orgs, today) {
  const memberships = activeMemberships(user.memberships, today);
  const allowed = scopes(memberships);
  const visible = user.role === 'owner' ? () => true : (node) => allowed.some((scope) => isWithin(node.id, scope, orgs));
  return flattenOrganizationTree(orgs).filter(visible).map((node) => {
    const membership = memberships.find((claim) => claim.organizationId === node.id);
    const title = membership ? positionLabel(membership, orgs) : '';
    return {
      organizationId: node.id, organizationName: node.fullName, orgShortName: node.name, title,
      label: title ? node.fullName + ' · ' + title : node.fullName,
    };
  });
}

export function issuerView(issuer, orgs) {
  return {
    organizationId: issuer.organizationId, organizationName: organizationName(issuer.organizationId, orgs) || issuer.organizationId,
    orgShortName: organization(issuer.organizationId, orgs)?.name || issuer.organizationId,
    title: issuer.title, name: issuer.name,
  };
}

export function publishedIssuer(body, viewer, orgs) {
  const choice = publishChoices(viewer.user, orgs, viewer.today).find(({ organizationId, title }) =>
    organizationId === body.issuerOrganizationId && title === (body.issuerTitle || ''));
  if (!choice) fail(403, 'ISSUER_FORBIDDEN', '此账号无法以该组织的身份发布。');
  return {
    userId: viewer.user.id,
    name: viewer.user.nickname || viewer.user.realName?.at(-1) || '',
    organizationId: choice.organizationId,
    title: choice.title,
  };
}

function choice(value, options, label) {
  if (!options.includes(value)) fail(400, 'INVALID_FIELD', label + '无效。');
  return value;
}

function dateTime(value) {
  if (!value) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(400, 'INVALID_DEADLINE', '截止时间无效。');
  }
  return new Date(value).toISOString();
}

function recipientGroup(user, scope, orgs, today) {
  const branches = new Map();
  for (const { organizationId } of activeMemberships(user?.memberships, today)) {
    const path = organizationPath(organizationId, orgs);
    const index = path.findIndex(node => node.id === scope);
    if (index < 0) continue;
    const branch = path[index + 1] ?? path[index];
    branches.set(branch.id, branch);
  }
  if (branches.size > 1) branches.delete(scope);
  return branches.size === 1 ? branches.values().next().value : null;
}

async function recipients(value, previous, scope, viewer, orgs, loadUsers) {
  if (!Array.isArray(value) || !value.length || value.length > 1000) fail(400, 'INVALID_RECIPIENTS', '应交名单须包含 1–1000 人。');
  const result = new Map();
  for (const row of value) {
    const id = studentId(row?.studentId);
    if (!/^[A-Z0-9]{4,24}$/.test(id)) fail(400, 'INVALID_STUDENT_ID', '应交名单的学号无效。');
    result.set(id, { studentId: id, name: text(row.name || id, '姓名', 40, true) });
  }
  const saved = new Map(previous.filter(row => row.groupId).map(row => [row.studentId, row]));
  const needsGroup = [...result.values()].filter(row => !saved.has(row.studentId));
  const directory = needsGroup.length ? new Map((await loadUsers())
    .filter(user => user.studentId && user.status !== 'disabled')
    .map(user => [studentId(user.studentId), user])) : new Map();
  for (const recipient of result.values()) {
    const snapshot = saved.get(recipient.studentId);
    const group = snapshot ? { id: snapshot.groupId, name: snapshot.groupLabel } :
      recipientGroup(directory.get(recipient.studentId), scope, orgs, viewer.today);
    if (group) Object.assign(recipient, { groupId: group.id, groupLabel: group.name });
  }
  return [...result.values()].sort((a, b) => a.studentId.localeCompare(b.studentId));
}

function courseReference(value) {
  if (value === null || value === undefined) return null;
  const code = text(value?.code, '课程号', 48, true);
  if (!validObject(value) || !/^[A-Za-z0-9_-]+$/.test(code) || value.id !== 'information/course-plan/' + code) {
    fail(400, 'INVALID_COURSE', '请选择校园课程目录中的课程。');
  }
  return { id: value.id, code, name: text(value.name, '课程名称', 160, true) };
}

export function roundInput(body, { now, existing, id = existing?.id ?? randomUUID() }) {
  const deadline = dateTime(body.deadline);
  const policy = choice(body.policy ?? 'strict', ['strict', 'allow-late', 'closed'], '提交规则');
  const unchangedLate = existing?.policy === 'allow-late' && deadline === existing.deadline;
  if (policy === 'allow-late' && !unchangedLate && !deadlineReached(deadline, now)) {
    fail(409, 'LATE_REQUIRES_DEADLINE', '原截止时间到达后才能开放补交。');
  }
  return {
    id,
    label: text(body.label, '轮次名称', 80, true),
    deadline, policy,
    fields: fields(body.fields),
    requireReview: boolean(body.requireReview),
    allowEdit: boolean(body.allowEdit),
    maxPerUser: integer(body.maxPerUser, 1, 1, 20, '每人提交次数'),
    maxSubmissions: integer(body.maxSubmissions, 500, 1, 1000, '总授权次数'),
    maxTotalFileBytes: integer(body.maxTotalFileBytes, 100 * 1024 * 1024, 1, 100 * 1024 * 1024, '附件总大小'),
    submissionMode: choice(body.submissionMode ?? 'replace', ['replace', 'multiple'], '提交方式'),
  };
}

export async function itemInput(body, now, existing, viewer, orgs, issuer, loadUsers) {
  const targetMode = choice(body.targetMode ?? existing?.targetMode ?? 'open', ['open', 'selected'], '受众');
  const status = choice(body.status ?? existing?.status ?? 'draft', ['draft', 'published', 'closed'], '收集状态');
  const visibility = choice(body.visibility ?? existing?.visibility ?? 'members', ['public', 'members'], '可见范围');
  const showProgress = boolean(body.showProgress, existing?.showProgress === true);
  const term = body.term ?? existing?.term;
  if (!isSemester(term)) fail(400, 'INVALID_SEMESTER', '请选择收集所属的学期。');
  if (existing && existing.status !== 'draft' && status === 'draft') {
    fail(400, 'UNPUBLISH_REQUIRED', '请使用取消发布操作将收集撤回为草稿。');
  }
  if ((!existing || existing.status === 'draft') && status === 'closed') {
    fail(400, 'PUBLISH_REQUIRED', '收集发布后才能停止收集。');
  }
  if (pinnedCollections.includes(existing?.id) && (visibility !== 'public' || targetMode !== 'open' || status === 'draft')) {
    fail(400, 'PINNED_COLLECTION_PUBLIC', '常用收集入口应保持公开，且面向所有登录用户。');
  }
  let rounds = existing?.rounds;
  if (body.rounds !== undefined) {
    if (!Array.isArray(body.rounds) || !body.rounds.length || body.rounds.length > 100) fail(400, 'INVALID_ROUNDS', '请设置 1–100 轮。');
    const seen = new Set();
    rounds = body.rounds.map((row) => {
      if (!validObject(row) || (row.id !== undefined && (!collectionId.test(row.id) || seen.has(row.id)))) {
        fail(400, 'INVALID_ROUNDS', '轮次标识无效或重复。');
      }
      const round = roundInput(row, { now: Date.parse(now), id: row.id });
      seen.add(round.id);
      return round;
    });
    if (existing && existing.rounds.some((round) => !seen.has(round.id))) {
      fail(400, 'ROUND_ID_REQUIRED', '请保留已有轮次；可停止继续接收该轮提交。');
    }
  }
  if (!rounds) fail(400, 'INVALID_ROUNDS', '请设置至少一轮。');
  const savedRecipients = existing?.recipients ?? [];
  const previousScope = existing?.audienceOrganizationId || existing?.issuer.organizationId;
  if (targetMode === 'selected' && body.audienceOrganizationId != null && typeof body.audienceOrganizationId !== 'string') {
    fail(400, 'INVALID_AUDIENCE', '请选择应交名单所属的组织。');
  }
  const audienceOrganizationId = targetMode === 'selected'
    ? (body.audienceOrganizationId ?? existing?.audienceOrganizationId) || issuer.organizationId : null;
  const scopeChanged = audienceOrganizationId !== previousScope;
  if (audienceOrganizationId && (scopeChanged || body.recipients != null)) {
    if (scopeChanged && !orgs.some(org => org.id === audienceOrganizationId)) {
      fail(400, 'INVALID_AUDIENCE', '请选择应交名单所属的组织。');
    }
    if (!canManage({ issuer: { organizationId: audienceOrganizationId } }, viewer, orgs)) {
      fail(403, 'AUDIENCE_FORBIDDEN', '此账号无权管理所选应交组织。');
    }
  }
  const roster = targetMode !== 'selected' ? [] : body.recipients == null && savedRecipients.length && !scopeChanged
    ? savedRecipients : await recipients(body.recipients ?? savedRecipients, scopeChanged ? [] : savedRecipients,
      audienceOrganizationId, viewer, orgs, loadUsers);
  const tags = body.tags ?? existing?.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 20) fail(400, 'INVALID_TAGS', '最多可添加 20 个标签。');
  return {
    name: text(body.name ?? existing?.name, '收集名称', 120, true),
    description: text(body.description ?? existing?.description, '收集说明', 5000),
    tags: [...new Set(tags.map((tag) => text(tag, '标签', 40, true)))],
    term,
    course: Object.hasOwn(body, 'course') && (body.course?.id !== null || body.course?.code !== existing?.course?.code || body.course?.name !== existing?.course?.name)
      ? courseReference(body.course) : existing?.course ?? null,
    targetMode, status, visibility, rounds, audienceOrganizationId, showProgress,
    recipients: roster,
    publishedAt: existing?.publishedAt || (status === 'published' ? now : ''),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}
