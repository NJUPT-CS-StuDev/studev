import { randomUUID } from 'node:crypto';
import { fail, text } from '../common.mjs';
import { flattenOrganizationTree, isWithin, organization, organizationName, positionLabel } from '../../organizations.mjs';
import { boolean, fields, integer, validObject } from './fields.mjs';
import { collectionId, studentId } from './records.mjs';

export const roles = ['guest', 'user', 'admin', 'owner'];
export const isManagement = (view) => view === 'admin' || view === 'owner';

export async function collectionViewer(identity, request, url, { required = false, mutation = false } = {}) {
  const requested = url.searchParams.get('view');
  if (requested && !roles.includes(requested)) fail(400, 'INVALID_VIEW', '该视角不存在。');
  const auth = await identity.authenticate(request, { required, csrf: mutation }).catch((error) => {
    if (!required && requested === 'guest' && !request.headers.has('authorization') && error.code === 'TOKEN_INVALID') return null;
    throw error;
  });
  const user = auth?.user ?? null;
  const role = user?.role ?? 'guest';
  const view = requested || role;
  const views = roles.slice(0, roles.indexOf(role) + 1).reverse();
  if (!views.includes(view)) fail(403, 'VIEW_FORBIDDEN', '此账号无法使用该视角。');
  if (mutation && view !== role) fail(403, 'VIEW_READ_ONLY', '预览视角只能浏览。');
  return { user, view, views, preview: view !== role };
}

export function viewerInfo(viewer, organizations) {
  const { user, view, views, preview } = viewer;
  const issuerOptions = isManagement(view) && !preview ? publishChoices(user, view, organizations) : [];
  return {
    view, views, issuerOptions,
    viewer: user ? { id: user.id, role: user.role, view, isStaff: isManagement(view), canPublish: issuerOptions.length > 0 } : null,
  };
}

function scopes(user) {
  return (user?.memberships || []).flatMap((claim) =>
    [claim.organizationId, claim.overseesOrganizationId].filter(Boolean));
}

export function canManage(item, viewer, orgs) {
  if (viewer.view === 'owner') return true;
  if (viewer.view !== 'admin') return false;
  return item.issuer.userId === viewer.user.id ||
    scopes(viewer.user).some((scope) => isWithin(item.issuer.organizationId, scope, orgs));
}

export function isRecipient(item, user) {
  return Boolean(user && (item.targetMode === 'open' ||
    item.recipients.some((row) => row.studentId === studentId(user.studentId))));
}

export function canSee(item, viewer, orgs) {
  if (canManage(item, viewer, orgs)) return true;
  if (item.status === 'draft' || item.status === 'archived' || !item.publishedAt) return false;
  if (item.visibility === 'public') return true;
  return viewer.view !== 'guest' && isRecipient(item, viewer.user);
}

export function openRound(item, round, now) {
  return item.status === 'published' && round.policy !== 'closed' &&
    (round.policy === 'allow-late' || !round.deadline || Date.parse(round.deadline) > now);
}

export function publishChoices(user, view, orgs) {
  const visible = view === 'owner' ? () => true : (node) => scopes(user).some((scope) => isWithin(node.id, scope, orgs));
  return flattenOrganizationTree(orgs).filter(visible).map((node) => {
    const membership = user.memberships?.find((claim) => claim.organizationId === node.id);
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
  const choice = publishChoices(viewer.user, viewer.view, orgs).find(({ organizationId, title }) =>
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

function recipients(value) {
  if (!Array.isArray(value) || !value.length || value.length > 1000) fail(400, 'INVALID_RECIPIENTS', '应交名单须包含 1–1000 人。');
  const result = new Map();
  for (const row of value) {
    const id = studentId(row?.studentId);
    if (!/^[A-Z0-9]{4,24}$/.test(id)) fail(400, 'INVALID_STUDENT_ID', '应交名单的学号无效。');
    result.set(id, { studentId: id, name: text(row.name || id, '姓名', 40, true) });
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

export function roundInput(body, id = randomUUID()) {
  return {
    id,
    label: text(body.label, '轮次名称', 80, true),
    deadline: dateTime(body.deadline),
    policy: choice(body.policy ?? 'strict', ['strict', 'allow-late', 'closed'], '提交规则'),
    fields: fields(body.fields),
    requireReview: boolean(body.requireReview),
    allowEdit: boolean(body.allowEdit),
    maxPerUser: integer(body.maxPerUser, 1, 1, 20, '每人提交次数'),
    maxSubmissions: integer(body.maxSubmissions, 500, 1, 1000, '总授权次数'),
    maxTotalFileBytes: integer(body.maxTotalFileBytes, 100 * 1024 * 1024, 1, 100 * 1024 * 1024, '附件总大小'),
    submissionMode: choice(body.submissionMode ?? 'replace', ['replace', 'multiple'], '提交方式'),
  };
}

export function itemInput(body, now, existing = null) {
  const targetMode = choice(body.targetMode ?? existing?.targetMode ?? 'open', ['open', 'selected'], '受众');
  const status = choice(body.status ?? existing?.status ?? 'draft', ['draft', 'published', 'closed', 'archived'], '收集状态');
  const visibility = choice(body.visibility ?? existing?.visibility ?? 'members', ['public', 'members'], '可见范围');
  let rounds = existing?.rounds;
  if (body.rounds !== undefined) {
    if (!Array.isArray(body.rounds) || !body.rounds.length || body.rounds.length > 100) fail(400, 'INVALID_ROUNDS', '请设置 1–100 轮。');
    const seen = new Set();
    rounds = body.rounds.map((row) => {
      if (!validObject(row) || (row.id !== undefined && (!collectionId.test(row.id) || seen.has(row.id)))) {
        fail(400, 'INVALID_ROUNDS', '轮次标识无效或重复。');
      }
      const round = roundInput(row, row.id);
      seen.add(round.id);
      return round;
    });
    if (existing && existing.rounds.some((round) => !seen.has(round.id))) {
      fail(400, 'ROUND_ID_REQUIRED', '请保留已有轮次；可停止继续接收该轮提交。');
    }
  }
  if (!rounds) fail(400, 'INVALID_ROUNDS', '请设置至少一轮。');
  const tags = body.tags ?? existing?.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 20) fail(400, 'INVALID_TAGS', '最多可添加 20 个标签。');
  return {
    name: text(body.name ?? existing?.name, '收集名称', 120, true),
    description: text(body.description ?? existing?.description, '收集说明', 5000),
    tags: [...new Set(tags.map((tag) => text(tag, '标签', 40, true)))],
    term: text(body.term ?? existing?.term, '学期', 40),
    termLabel: text(body.termLabel ?? existing?.termLabel, '学期名称', 60),
    course: Object.hasOwn(body, 'course') && (body.course?.id !== null || body.course?.code !== existing?.course?.code || body.course?.name !== existing?.course?.name)
      ? courseReference(body.course) : existing?.course ?? null,
    targetMode, status, visibility, rounds,
    recipients: targetMode === 'selected' ? recipients(body.recipients ?? existing?.recipients) : [],
    publishedAt: existing?.publishedAt || (status === 'published' ? now : ''),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}
