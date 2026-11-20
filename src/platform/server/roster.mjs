export const SUPPORTED_ROSTER_TERMS = new Set(['2026-2027']);

const DEPARTMENTS_2026_2027 = [
  '主席团',
  '运营支持部',
  '易班建设部',
  '媒体宣传部',
  '心理工作部',
];

export function qqAvatarUrl(qq) {
  return typeof qq === 'string' && /^[1-9]\d{4,11}$/.test(qq)
    ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qq)}&s=640`
    : '';
}

/** Bump when the public snapshot shape changes; stale stored snapshots are rebuilt on read. */
export const ROSTER_SCHEMA = 7;


export function normalizeDepartmentName(dept) {
  const raw = typeof dept === 'string' ? dept.trim() : '';
  if (raw === '主席团与统筹' || raw === '统筹与协调') return '主席团';
  return raw;
}

export function normalizeRoleTitle(title) {
  const raw = typeof title === 'string' ? title.trim() : '';
  if (raw === '学生发展中心主席 · StuDev 发起人' || raw.startsWith('执行统筹 · ')) {
    return '执行主席 · 运营支持部';
  }
  if (raw.startsWith('分管协调 · ')) return raw.replace(/^分管协调 · /, '分管主席 · ');
  return raw;
}

/** A nickname is only meaningful when it differs from the real name. */
function distinctNickname(user) {
  const nick = typeof user?.nickname === 'string' ? user.nickname.trim() : '';
  if (!nick || nick === user.realName || nick === user.studentId || nick === user.qq) return '';
  return nick;
}

/** An explicit nickname wins; otherwise use the final character of the name. */
export function profileNickname(user) {
  const nickname = distinctNickname(user);
  if (nickname) return nickname;
  const name = typeof user?.realName === 'string' ? user.realName.trim() : '';
  return [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(name)].at(-1)?.segment || '同学';
}

/** Public organization membership includes appointed staff with department and title. */
export function isRosterMember(user, term = user?.term) {
  return Boolean(user && SUPPORTED_ROSTER_TERMS.has(term) && user.term === term
    && ['admin', 'owner'].includes(user.role) && ['active', 'pending'].includes(user.status)
    && normalizeDepartmentName(user.department) && normalizeRoleTitle(user.title));
}

/** Only this projection leaves the private identity store, including on cached reads. */
export function publicRoster(snapshot, origin) {
  return {
    schema: ROSTER_SCHEMA, term: snapshot.term, updatedAt: snapshot.updatedAt,
    totalCount: snapshot.totalCount, activeCount: snapshot.activeCount,
    groups: snapshot.groups.map(group => ({ name: group.name, people: group.people.map(person => ({
      id: person.id, nickname: person.nickname, role: person.role, signature: person.signature,
      avatarUrl: origin + '/api/platform/members/' + person.id + '/avatar', featured: person.featured,
    })) })),
  };
}

export function buildRosterSnapshot(users, term, updatedAt, origin) {
  const rosterUsers = users.filter(user => isRosterMember(user, term))
    .sort((a, b) => ((a.order ?? 999) - (b.order ?? 999)) || a.id.localeCompare(b.id));
  const departmentOrder = [...DEPARTMENTS_2026_2027];
  for (const user of rosterUsers) {
    const department = normalizeDepartmentName(user.department || '学生发展中心');
    if (!departmentOrder.includes(department)) departmentOrder.push(department);
  }
  const groups = departmentOrder.map(name => ({ name, people: rosterUsers
    .filter(user => normalizeDepartmentName(user.department || '学生发展中心') === name)
    .map(user => ({ id: user.id, nickname: profileNickname(user), role: normalizeRoleTitle(user.title),
      signature: user.signature || '', featured: name === '主席团' }))
  })).filter(group => group.people.length);
  return publicRoster({ term, updatedAt, totalCount: rosterUsers.length,
    activeCount: rosterUsers.filter(user => user.status === 'active').length, groups }, origin);
}
