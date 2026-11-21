import { fail } from './common.mjs';
import { leadership, organization, positionLabel } from '../organizations.mjs';

export function validateMemberships(value) {
  if (!Array.isArray(value) || value.length > 24) fail(400, 'INVALID_MEMBERSHIPS', '组织归属无效。');
  const seen = new Set();
  return value.map(row => {
    const org = organization(row?.organizationId);
    if (!org || seen.has(org.id)) fail(400, 'INVALID_ORGANIZATION', '请选择不同的组织。');
    seen.add(org.id);
    const department = row.department ?? '';
    const title = row.title ?? '';
    const responsibleDepartment = row.responsibleDepartment ?? '';
    if (department !== '' && !org.departments.includes(department)) fail(400, 'INVALID_DEPARTMENT', '请选择该组织的部门。');
    if (title !== '' && !org.titles.includes(title)) fail(400, 'INVALID_POSITION', '请选择该组织的职务。');
    if (responsibleDepartment !== '' && (!leadership(title) || !org.departments.includes(responsibleDepartment))) {
      fail(400, 'INVALID_DEPARTMENT', '请选择有效的分管部门。');
    }
    const order = row.order ?? 999;
    if (!Number.isSafeInteger(order) || order < 0 || order > 9999) fail(400, 'INVALID_FIELD', '排序序号须为 0–9999 的整数。');
    return { organizationId: org.id, department, title, responsibleDepartment, order };
  });
}

export function membershipView(memberships = []) {
  return memberships.map(row => ({
    organizationId: row.organizationId, organizationName: organization(row.organizationId)?.name || row.organizationId,
    department: row.department, title: row.title, responsibleDepartment: row.responsibleDepartment,
    position: positionLabel(row), order: row.order,
  }));
}
