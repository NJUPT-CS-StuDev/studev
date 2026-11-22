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

export function validateMemberships(value, orgs = namedOrganizations) {
  if (!Array.isArray(value) || value.length > 24) fail(400, 'INVALID_MEMBERSHIPS', '组织归属无效。');
  const seen = new Set();
  return value.map(row => {
    const org = organization(row?.organizationId, orgs);
    if (!org || seen.has(org.id)) fail(400, 'INVALID_ORGANIZATION', '请选择不同的组织。');
    if ('department' in row || 'responsibleDepartment' in row) fail(400, 'INVALID_MEMBERSHIPS', '请按组织填写任职。');
    seen.add(org.id);
    const title = row.title ?? '';
    if (title !== '' && org.titles.length > 0 && !org.titles.includes(title)) fail(400, 'INVALID_POSITION', '请选择该组织的职务。');
    const overseesOrganizationId = row.overseesOrganizationId ?? '';
    if (overseesOrganizationId !== '' && (!title || organization(overseesOrganizationId, orgs)?.parentId !== org.id)) {
      fail(400, 'INVALID_ORGANIZATION', '请选择该组织直属的分管组织。');
    }
    const order = row.order ?? 999;
    if (!Number.isSafeInteger(order) || order < 0 || order > 9999) fail(400, 'INVALID_FIELD', '排序序号须为 0–9999 的整数。');
    return { organizationId: org.id, title, overseesOrganizationId, order };
  });
}

export function membershipView(memberships = [], orgs = namedOrganizations) {
  return memberships.map(row => ({
    organizationId: row.organizationId,
    organizationName: organizationName(row.organizationId, orgs),
    title: row.title,
    overseesOrganizationId: row.overseesOrganizationId || '',
    position: positionLabel(row, orgs),
    order: row.order ?? 999,
  }));
}
