import { pathToFileURL } from 'node:url';
import { studentCenter } from '../../src/platform/organizations.mjs';
import { validateMemberships } from '../../src/platform/server/organizations.mjs';
import { archiveKey, buildRosterSnapshot, publicRoster, rosterTerm } from '../../src/platform/server/roster.mjs';
import { createRepository, isConflict } from '../../src/platform/server/store.mjs';

// Import old organization fields once, before the new application is deployed.
export function legacyMembership({ department, title, order }) {
  const group = typeof department === 'string' ? department.trim() : '';
  let position = typeof title === 'string' ? title.trim() : '';
  if (!group && !position) return null;
  const main = ['主席团', '主席团与统筹', '统筹与协调'].includes(group) ? '' : group;
  if (position === '学生发展中心主席 · StuDev 发起人' || position.startsWith('执行统筹 · ')) position = '执行主席 · 运营支持部';
  if (position.startsWith('分管协调 · ')) position = position.replace(/^分管协调/, '分管主席');
  const [job, responsibleDepartment] = position.split(/\s*·\s*/);
  const prefix = studentCenter.departments.find(name => job.startsWith(name));
  const role = (prefix ? job.slice(prefix.length) : job).replace(/^部门成员$/, '部员');
  return validateMemberships([{ organizationId: studentCenter.id, department: main, title: role, responsibleDepartment, order }])[0];
}

export async function migrateOrganizations(repo, { apply = false, origin, now = new Date().toISOString() } = {}) {
  const newest = new Map();
  for (const key of await repo.list('identity/users/')) {
    const match = /^(identity\/users\/[a-f0-9-]{36})\/\d{8}\.json$/.exec(key);
    if (match) newest.set(match[1], key);
  }
  const archives = new Map();
  for (const key of await repo.list('roster/')) {
    const term = /^roster\/(\d{4}-\d{4})\.json$/.exec(key)?.[1];
    if (!term || term === studentCenter.term || await repo.get(archiveKey(term))) continue;
    const existing = await repo.get(key);
    if (existing && Array.isArray(existing.groups)) archives.set(term, publicRoster({ ...existing, archivedAt: now }, origin));
  }
  const revisions = [];
  const older = new Map();
  let current = 0;
  let reserved = 0;
  let unmatched = 0;
  for (const [key, latest] of newest) {
    const account = await repo.get(latest);
    const { term, department, title, order, ...rest } = account;
    if (Array.isArray(rest.memberships) && [term, department, title, order].every(value => value === undefined)) continue;
    if (term && !rosterTerm.test(term)) { unmatched++; continue; }
    let membership;
    try { membership = legacyMembership({ department, title, order }); }
    catch { unmatched++; continue; }
    const historical = membership && term && term !== studentCenter.term;
    if (historical) {
      const list = older.get(term) ?? [];
      list.push({ ...rest, memberships: [membership] });
      older.set(term, list);
      reserved++;
    } else if (membership) current++;
    revisions.push({ key, account: { ...rest, memberships: [...(rest.memberships ?? []).filter(row => !membership || row.organizationId !== studentCenter.id),
      ...(membership && !historical ? [membership] : [])] } });
  }
  for (const [term, accounts] of older) {
    if (!archives.has(term) && !await repo.get(archiveKey(term))) {
      archives.set(term, { ...buildRosterSnapshot(accounts, term, now, origin), archivedAt: now });
    }
  }
  if (apply) {
    if (unmatched) throw new Error(`${unmatched} old accounts need their organization fields resolved first.`);
    for (const [term, snapshot] of archives) {
      try { await repo.putNew(archiveKey(term), snapshot); }
      catch (error) { if (!isConflict(error)) throw error; }
    }
    for (const { key, account } of revisions) await repo.append(key, { ...account, updatedAt: now }, account.revision);
  }
  return { accounts: newest.size, revisions: revisions.length, current, historical: reserved, archives: archives.size, unmatched, applied: apply };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { getStore } = await import('@edgeone/pages-blob');
  const token = process.env.STUDEV_MIGRATION_TOKEN;
  if (!token) throw new Error('Provide STUDEV_MIGRATION_TOKEN for this process.');
  const store = getStore({ name: 'studev-collections', projectId: 'makers-xubgsi8n79pp', token, consistency: 'strong' });
  const repo = createRepository(store, { secret: 'organization-migration-no-auth-required' });
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (apply && verify) throw new Error('Choose either --apply or --verify.');
  const result = await migrateOrganizations(repo, { apply, origin: 'https://studev.hicancan.top' });
  console.log(JSON.stringify(result));
  if (verify && (result.revisions || result.archives || result.unmatched)) {
    throw new Error('Organization cutover is incomplete; the old records must be resolved before deploying.');
  }
}
