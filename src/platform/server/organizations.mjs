import { fail } from './common.mjs';
import { organization, organizationName, positionLabel } from '../organizations.mjs';

export function validateMemberships(value) {
  if (!Array.isArray(value) || value.length > 24) fail(400, 'INVALID_MEMBERSHIPS', '组织归属无效。');
  const seen = new Set();
  return value.map(row => {
    const org = organization(row?.organizationId);
    if (!org || seen.has(org.id)) fail(400, 'INVALID_ORGANIZATION', '请选择不同的组织。');
    if ('department' in row || 'responsibleDepartment' in row) fail(400, 'INVALID_MEMBERSHIPS', '请按组织填写任职。');
    seen.add(org.id);
    const title = row.title ?? '';
    if (title !== '' && !org.titles.includes(title)) fail(400, 'INVALID_POSITION', '请选择该组织的职务。');
    const overseesOrganizationId = row.overseesOrganizationId ?? '';
    if (overseesOrganizationId !== '' && (!title || organization(overseesOrganizationId)?.parentId !== org.id)) {
      fail(400, 'INVALID_ORGANIZATION', '请选择该组织直属的分管组织。');
    }
    const order = row.order ?? 999;
    if (!Number.isSafeInteger(order) || order < 0 || order > 9999) fail(400, 'INVALID_FIELD', '排序序号须为 0–9999 的整数。');
    return { organizationId: org.id, title, overseesOrganizationId, order };
  });
}

export function membershipView(memberships = []) {
  return memberships.map(row => ({
    organizationId: row.organizationId, organizationName: organizationName(row.organizationId),
    title: row.title, overseesOrganizationId: row.overseesOrganizationId,
    position: positionLabel(row), order: row.order,
  }));
}
