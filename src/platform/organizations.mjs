export const studentCenter = {
  id: 'student-development',
  name: '学生发展中心',
  term: '2026-2027',
  departments: ['运营支持部', '易班建设部', '媒体宣传部', '心理工作部'],
  titles: ['主席', '执行主席', '分管主席', '部长', '副部长', '部员'],
};

export function organization(id) {
  if (id === studentCenter.id) return studentCenter;
  const klass = typeof id === 'string' && /^class:([A-Z][0-9]{6,9})$/.exec(id);
  if (klass) return { id, name: `${klass[1]} 班`, departments: [], titles: ['班长', '副班长', '团支书', '学习委员', '生活委员', '文体委员'] };
  return null;
}

export const leadership = title => ['主席', '执行主席', '分管主席'].includes(title);

export function positionLabel(membership) {
  if (!membership?.title) return '';
  if (membership.responsibleDepartment) return `${membership.title} · ${membership.responsibleDepartment}`;
  return membership.title;
}
