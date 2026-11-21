export const studentCenter = {
  id: 'student-development',
  name: '学生发展中心',
  term: '2026-2027',
  parentId: null,
  titles: ['主席', '执行主席', '分管主席'],
};

const departments = [
  { id: 'operations', name: '运营支持部' },
  { id: 'yiban', name: '易班建设部' },
  { id: 'media', name: '媒体宣传部' },
  { id: 'mental-health', name: '心理工作部' },
].map(({ id, name }) => ({
  id: `${studentCenter.id}/${id}`,
  name,
  parentId: studentCenter.id,
  titles: ['部长', '副部长', '部员'],
}));

export const namedOrganizations = [studentCenter, ...departments];

export function organization(id) {
  const known = namedOrganizations.find(org => org.id === id);
  if (known) return known;
  const klass = typeof id === 'string' && /^class:([A-Z][0-9]{6,9})$/.exec(id);
  if (klass) return { id: klass[0], name: `${klass[1]} 班`, parentId: null, titles: ['班长', '副班长', '团支书', '学习委员', '生活委员', '文体委员'] };
  return null;
}

export const childrenOf = id => namedOrganizations.filter(org => org.parentId === id);

export function organizationPath(id) {
  const chain = [];
  for (let org = organization(id); org; org = organization(org.parentId)) chain.unshift(org);
  return chain;
}

export const organizationName = id => organizationPath(id).map(org => org.name).join(' › ');
export const isWithin = (id, scope) => organizationPath(id).some(org => org.id === scope);

export function positionLabel({ title, overseesOrganizationId }) {
  const oversees = organization(overseesOrganizationId);
  return title && oversees ? `${title} · 分管${oversees.name}` : title;
}
