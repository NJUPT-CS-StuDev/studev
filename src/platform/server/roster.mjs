import { isWithin, namedOrganizations, positionLabel, studentCenter } from '../organizations.mjs';

const appointments = (user, orgs = namedOrganizations) =>
  (user?.memberships ?? []).filter(row => row.title && isWithin(row.organizationId, studentCenter.id, orgs));
export const ROSTER_SCHEMA = 10;
export const rosterTerm = /^\d{4}-\d{4}$/;
export const archiveKey = term => `roster/archives/${term}.json`;

export function qqAvatarUrl(qq) {
  return typeof qq === 'string' && /^[1-9]\d{4,11}$/.test(qq)
    ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qq)}&s=640`
    : '';
}

export function profileNickname(user) {
  const nick = typeof user?.nickname === 'string' ? user.nickname.trim() : '';
  if (nick && nick !== user.realName && nick !== user.studentId && nick !== user.qq) return nick;
  const name = typeof user?.realName === 'string' ? user.realName.trim() : '';
  return [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(name)].at(-1)?.segment || '同学';
}

export function isRosterMember(user, orgs = namedOrganizations) {
  return Boolean(user && ['active', 'pending'].includes(user.status) && appointments(user, orgs).length);
}

/** The public projection also applies to archived records. */
export function publicRoster(snapshot, origin) {
  return {
    schema: ROSTER_SCHEMA, term: snapshot.term, updatedAt: snapshot.updatedAt,
    ...(snapshot.archivedAt ? { archivedAt: snapshot.archivedAt } : {}),
    totalCount: snapshot.totalCount, activeCount: snapshot.activeCount,
    groups: snapshot.groups.map(group => ({ name: group.name, people: group.people.map(person => ({
      id: person.id, name: person.name, nickname: person.nickname, role: person.role, signature: person.signature,
      avatarUrl: origin + '/api/platform/members/' + person.id + '/avatar', featured: person.featured,
    })) })),
  };
}

export function buildRosterSnapshot(users, term, updatedAt, origin, orgs = namedOrganizations) {
  const rosterUsers = users.filter(user => isRosterMember(user, orgs));
  const rows = rosterUsers.flatMap(user => appointments(user, orgs).map(membership => ({ user, membership })))
    .sort((a, b) => (a.membership.order ?? 999) - (b.membership.order ?? 999) || a.user.id.localeCompare(b.user.id));
  const groups = orgs.filter(org => org.publicRoster !== false && isWithin(org.id, studentCenter.id, orgs)).map(org => ({
    name: org.id === studentCenter.id ? '主席团' : org.name, people: rows
    .filter(({ membership }) => membership.organizationId === org.id)
    .map(({ user, membership }) => ({ id: user.id, name: (user.realName || '').trim(), nickname: profileNickname(user),
      role: positionLabel(membership, orgs), signature: user.signature || '', featured: org.id === studentCenter.id })) }))
    .filter(group => group.people.length);
  return publicRoster({ term, updatedAt, totalCount: rosterUsers.length,
    activeCount: rosterUsers.filter(user => user.status === 'active').length, groups }, origin);
}
