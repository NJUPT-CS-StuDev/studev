import { academicYearId, academicYearWindow, isWithin, namedOrganizations, positionLabel, studentCenter } from '../organizations.mjs';
import { isConflict } from './store.mjs';

const rosterPeople = 'roster/people';
const publicOrganizations = orgs => new Set(orgs.filter(org => org.publicRoster && isWithin(org.id, studentCenter.id, orgs)).map(org => org.id));

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

export function rosterAppointment(row, orgs = namedOrganizations) {
  return row.title && row.startsOn && row.endsBefore && isWithin(row.organizationId, studentCenter.id, orgs);
}

function position(row) {
  const { organizationId, title, overseesOrganizationId, order, startsOn, endsBefore } = row;
  return { organizationId, title, overseesOrganizationId: overseesOrganizationId || '', order: order ?? 999, startsOn, endsBefore };
}

export function rosterPerson(user, orgs = namedOrganizations) {
  const appointments = (user.memberships ?? []).filter(row => rosterAppointment(row, orgs)).map(position);
  if (!appointments.length || !['active', 'pending'].includes(user.status)) return null;
  return {
    id: user.id, name: (user.realName || '').trim(), nickname: profileNickname(user), signature: user.signature || '',
    active: user.status === 'active', appointments,
  };
}

/** Update only the derived public fields, and use immutable account revision order so
 * a delayed publication cannot resurrect a retired or deleted appointment. */
export async function publishRosterPerson(repo, user, previous, orgs = namedOrganizations) {
  const current = rosterPerson(user, orgs);
  const before = previous ? rosterPerson(previous, orgs) : null;
  if (!current && !previous?.memberships?.some(row => rosterAppointment(row, orgs))) return;
  if (JSON.stringify(current) === JSON.stringify(before)) {
    const written = await repo.latest(rosterPeople + '/' + user.id);
    if (written && JSON.stringify(written.person) === JSON.stringify(current)) return;
  }
  const key = `${rosterPeople}/${user.id}/${String(user.revision).padStart(8, '0')}.json`;
  const value = { person: current, revision: user.revision };
  try { await repo.putNew(key, value); }
  catch (error) { if (!isConflict(error) || JSON.stringify(await repo.get(key)) !== JSON.stringify(value)) throw error; }
}

/** Clients display the organization and selected date projection of the same appointments. */
export function rosterView(people, orgs, origin, today, requestedYear) {
  const currentYear = academicYearId(today);
  const year = requestedYear || currentYear;
  const window = academicYearWindow(year);
  const yearSet = new Set([currentYear]);
  const currentYearStart = Number(currentYear.slice(0, 4));
  const publicIds = publicOrganizations(orgs);
  const rows = [];
  for (const person of people) {
    for (const appointment of person.appointments) {
      if (!publicIds.has(appointment.organizationId) || appointment.startsOn > today) continue;
      const first = Number(academicYearId(appointment.startsOn).slice(0, 4));
      const last = Math.min(currentYearStart, Number(academicYearId(appointment.endsBefore).slice(0, 4)));
      for (let start = first; start <= last; start++) {
        const candidate = academicYearWindow(`${start}-${start + 1}`);
        if (appointment.startsOn < candidate.endsBefore && candidate.startsOn < appointment.endsBefore) yearSet.add(candidate.id);
      }
      const overlaps = requestedYear
        ? appointment.startsOn < window.endsBefore && window.startsOn < appointment.endsBefore
        : today < appointment.endsBefore;
      if (overlaps) rows.push({ person, appointment });
    }
  }
  rows.sort((left, right) => left.appointment.order - right.appointment.order
    || left.appointment.startsOn.localeCompare(right.appointment.startsOn)
    || left.person.id.localeCompare(right.person.id));
  const groups = [...orgs].filter(org => publicIds.has(org.id)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(org => ({
    id: org.id,
    name: org.id === studentCenter.id ? '主席团' : org.name,
    people: rows.filter(({ appointment }) => org.id === appointment.organizationId)
      .map(({ person, appointment }) => ({
        id: person.id, name: person.name, nickname: person.nickname, role: positionLabel(appointment, orgs), signature: person.signature,
        avatarUrl: origin + '/api/platform/members/' + person.id + '/avatar', featured: org.id === studentCenter.id,
        startsOn: appointment.startsOn, endsBefore: appointment.endsBefore,
      })),
  })).filter(group => group.people.length);
  return {
    view: requestedYear ? 'year' : 'today', year, years: [...yearSet].sort().reverse(), today,
    totalCount: new Set(rows.map(({ person }) => person.id)).size,
    activeCount: new Set(rows.filter(({ person }) => person.active).map(({ person }) => person.id)).size,
    groups,
  };
}

export async function hasPublishedRosterAppointment(repo, id, orgs, today) {
  const record = await repo.latest(rosterPeople + '/' + id);
  const publicIds = publicOrganizations(orgs);
  return record?.person?.appointments.some(row => row.startsOn <= today && publicIds.has(row.organizationId));
}

export async function readRosterPeople(repo) {
  const heads = [...(await repo.heads(rosterPeople)).values()];
  const people = [];
  for (let start = 0; start < heads.length; start += 32) {
    for (const record of await Promise.all(heads.slice(start, start + 32).map(repo.readRevision))) {
      if (record?.person) people.push(record.person);
    }
  }
  return people;
}
