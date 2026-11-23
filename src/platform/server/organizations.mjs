import { randomUUID } from 'node:crypto';
import { fail, text } from './common.mjs';
import {
  childrenOf,
  flattenOrganizationTree,
  isWithin,
  mergeOrganizations,
  namedOrganizations,
  organization,
  organizationName,
  positionLabel,
  studentCenter,
} from '../organizations.mjs';

export const ORG_TREE_KEY = 'organizations/tree.json';
const ORG_ID = /^[a-zA-Z0-9][a-zA-Z0-9:/_-]{1,63}$/;

export async function loadOrganizations(repo) {
  if (!repo) return namedOrganizations;
  const saved = await repo.get(ORG_TREE_KEY);
  const custom = Array.isArray(saved?.items) ? saved.items : [];
  return mergeOrganizations(custom);
}

export async function saveOrganization(repo, input) {
  const saved = await repo.get(ORG_TREE_KEY);
  const custom = Array.isArray(saved?.items) ? [...saved.items] : [];
  const current = mergeOrganizations(custom);

  const name = text(input?.name, '组织名称', 60, true);
  const rawParent = input?.parentId === undefined || input?.parentId === null || input?.parentId === '' ? null : String(input.parentId).trim();
  if (rawParent !== null && !organization(rawParent, current)) {
    fail(400, 'INVALID_PARENT', '上级组织不存在。');
  }

  let id = typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : '';
  if (id) {
    if (!ORG_ID.test(id)) fail(400, 'INVALID_ORGANIZATION_ID', '组织标识仅支持字母、数字及 : / _ -。');
  } else {
    id = `org:${randomUUID().slice(0, 8)}`;
  }

  if (rawParent === id) fail(400, 'INVALID_PARENT', '组织不能以自身作为上级。');
  if (rawParent && isWithin(rawParent, id, current)) {
    fail(400, 'INVALID_PARENT', '不能将下级组织设为上级，否则会形成环路。');
  }

  const kind = ['club', 'academic', 'other'].includes(input?.kind)
    ? input.kind
    : (rawParent ? (organization(rawParent, current)?.kind || 'other') : 'other');
  const publicRoster = typeof input?.publicRoster === 'boolean'
    ? input.publicRoster
    : (id === studentCenter.id || (rawParent ? isWithin(rawParent, studentCenter.id, current) : false));

  let titles = [];
  if (Array.isArray(input?.titles)) {
    titles = [...new Set(input.titles.map(t => text(t, '职务名称', 24, false)).filter(Boolean))].slice(0, 20);
  } else if (typeof input?.titles === 'string') {
    titles = [...new Set(input.titles.split(/[,，、\s]+/).map(t => text(t, '职务名称', 24, false)).filter(Boolean))].slice(0, 20);
  } else {
    const existing = organization(id, current);
    titles = existing?.titles ? [...existing.titles] : [];
  }

  const order = input?.order === undefined || input?.order === ''
    ? (organization(id, current)?.order ?? 500)
    : Number(input.order);
  if (!Number.isSafeInteger(order) || order < 0 || order > 9999) {
    fail(400, 'INVALID_FIELD', '排序序号须为 0–9999 的整数。');
  }

  const record = { id, name, parentId: rawParent, kind, publicRoster, order, titles };
  const idx = custom.findIndex(item => item.id === id);
  if (idx >= 0) custom[idx] = record;
  else custom.push(record);

  await repo.put(ORG_TREE_KEY, { version: 1, items: custom });
  const merged = mergeOrganizations(custom);
  return {
    organization: flattenOrganizationTree(merged).find(o => o.id === id) || record,
    items: flattenOrganizationTree(merged),
  };
}

export async function deleteOrganization(repo, id) {
  if (!id || id === studentCenter.id) fail(400, 'CANNOT_DELETE_ROOT', '内置核心组织不可删除。');
  if (namedOrganizations.some(o => o.id === id)) fail(400, 'CANNOT_DELETE_BUILTIN', '内置核心组织不可删除。');
  const saved = await repo.get(ORG_TREE_KEY);
  const custom = Array.isArray(saved?.items) ? [...saved.items] : [];
  const merged = mergeOrganizations(custom);
  if (!custom.some(item => item.id === id)) fail(404, 'ORGANIZATION_NOT_FOUND', '组织不存在。');
  if (childrenOf(id, merged).length > 0) fail(409, 'HAS_CHILDREN', '请先移除该组织下的全部子组织。');
  const nextCustom = custom.filter(item => item.id !== id);
  await repo.put(ORG_TREE_KEY, { version: 1, items: nextCustom });
  return { items: flattenOrganizationTree(mergeOrganizations(nextCustom)) };
}

function civilDate(value) {
  if (typeof value !== 'string' || !/^(20|21)\d\d-\d\d-\d\d$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function overlapsMembership(left, right) {
  return left.organizationId === right.organizationId && (
    !left.startsOn || !right.startsOn || left.startsOn < right.endsBefore && right.startsOn < left.endsBefore
  );
}

export function validateMemberships(value, orgs = namedOrganizations, academicYear) {
  if (!Array.isArray(value) || value.length > 100) fail(400, 'INVALID_MEMBERSHIPS', '组织归属无效。');
  const memberships = [];
  for (const row of value) {
    const org = organization(row?.organizationId, orgs);
    if (!org) fail(400, 'INVALID_ORGANIZATION', '请选择有效的组织。');
    const title = row.title ?? '';
    if (typeof title !== 'string' || title.length > 60 || (title && org.titles.length && !org.titles.includes(title))) {
      fail(400, 'INVALID_POSITION', '请选择该组织的职务。');
    }
    const overseesOrganizationId = row.overseesOrganizationId ?? '';
    if (overseesOrganizationId !== '' && (!title || organization(overseesOrganizationId, orgs)?.parentId !== org.id)) {
      fail(400, 'INVALID_ORGANIZATION', '请选择该组织直属的分管组织。');
    }
    const order = row.order ?? 999;
    if (!Number.isSafeInteger(order) || order < 0 || order > 9999) fail(400, 'INVALID_FIELD', '排序序号须为 0–9999 的整数。');
    let startsOn = row.startsOn || '';
    let endsBefore = row.endsBefore || '';
    if (!startsOn && !endsBefore && title && isWithin(org.id, studentCenter.id, orgs)) {
      startsOn = academicYear?.startsOn;
      endsBefore = academicYear?.endsBefore;
      if (!startsOn || !endsBefore) fail(400, 'APPOINTMENT_DATES_REQUIRED', '学发任职需要生效日与结束日。');
    }
    if ((startsOn || endsBefore) && (!civilDate(startsOn) || !civilDate(endsBefore) || startsOn >= endsBefore)) {
      fail(400, 'INVALID_APPOINTMENT_DATES', '任职的结束日应晚于生效日。');
    }
    const membership = { organizationId: org.id, title, overseesOrganizationId, order,
      ...(startsOn ? { startsOn, endsBefore } : {}),
    };
    if (memberships.some(other => overlapsMembership(membership, other))) {
      fail(400, 'OVERLAPPING_MEMBERSHIPS', '同一个组织的任期不能重叠。');
    }
    memberships.push(membership);
  }
  return memberships;
}

export function membershipView(memberships = [], orgs = namedOrganizations) {
  return memberships.map(row => ({
    organizationId: row.organizationId,
    organizationName: organizationName(row.organizationId, orgs),
    title: row.title,
    overseesOrganizationId: row.overseesOrganizationId || '',
    position: positionLabel(row, orgs),
    order: row.order ?? 999,
    ...(row.startsOn && row.endsBefore ? { startsOn: row.startsOn, endsBefore: row.endsBefore } : {}),
  }));
}
