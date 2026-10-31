// Run before deploying the accounts contract. Default is a read-only inventory.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@edgeone/pages-blob';
import { createRepository } from '../../src/server/platform-store.mjs';
import { normalizeStudentId, normalizeRealName } from '../../src/server/platform-identity.mjs';
import { buildRosterSnapshot, SUPPORTED_ROSTER_TERMS } from '../../src/server/platform-roster.mjs';

export async function migrateAccounts(repo, { apply = false, ownerProfile } = {}) {
  const keys = await repo.list('identity/users/');
  const ids = [...new Set(keys.map(key => /^identity\/users\/([a-f0-9-]{36})\//.exec(key)?.[1]).filter(Boolean))];
  const users = (await Promise.all(ids.map(id => repo.latest(`identity/users/${id}`)))).filter(Boolean);
  const plans = users.map(user => {
    const profile = user.role === 'owner' && ownerProfile ? ownerProfile : user;
    let studentId = user.studentId, realName = user.realName, validProfile = false;
    try { studentId = normalizeStudentId(studentId || profile.studentId); realName = normalizeRealName(realName || profile.realName); validProfile = true; } catch { /* reported below, never fabricate identity */ }
    const role = user.role === 'member' ? 'admin' : user.role;
    return { user, role, studentId, realName, validProfile };
  });
  const incomplete = plans.filter(p => p.user.status === 'active' && !p.validProfile);
  const invalidRoles = plans.filter(p => !['owner', 'admin', 'user'].includes(p.role));
  // Validate all proposed student claims before the first write.
  const students = new Map(); let conflictingClaims = 0;
  for (const p of plans) if (p.studentId) {
    const claim = await repo.get(`identity/student/${p.studentId}.json`);
    if ((students.has(p.studentId) && students.get(p.studentId) !== p.user.id) || (claim && claim.id !== p.user.id)) conflictingClaims++;
    students.set(p.studentId, p.user.id);
  }
  const oldSessions = [...await repo.list('identity/sessions/'), ...await repo.list('identity/native/')];
  const report = { users: users.length, memberToAdmin: users.filter(u => u.role === 'member').length,
    ownerProfilesToBind: plans.filter(p => p.studentId !== p.user.studentId || p.realName !== p.user.realName).length,
    incompleteActiveProfiles: incomplete.length, invalidRoles: invalidRoles.length, conflictingClaims,
    obsoleteSessionKeys: oldSessions.length, applied: false };
  if (!apply) return report;
  if (incomplete.length || invalidRoles.length || conflictingClaims) throw new Error('Resolve incomplete profiles, roles and student claims before applying the migration. No writes performed.');
  const current = [];
  for (const p of plans) {
    let user = p.user;
    if (p.role !== user.role || p.studentId !== user.studentId || p.realName !== user.realName) {
      if (p.studentId) {
        const key = `identity/student/${p.studentId}.json`;
        if (!await repo.get(key)) await repo.putNew(key, { id: user.id });
      }
      user = await repo.append(`identity/users/${user.id}`, { ...user, role: p.role, studentId: p.studentId || '', realName: p.realName || '',
        securityVersion: randomBytes(32).toString('base64url'), updatedAt: new Date().toISOString() }, user.revision);
    }
    current.push(user);
  }
  for (const term of SUPPORTED_ROSTER_TERMS) await repo.put(`roster/${term}.json`, buildRosterSnapshot(current, term));
  // Old cookies and native credentials deliberately require sign-in again. Never
  // retain an old reader or copy bearer tickets into the new session namespace.
  for (const key of oldSessions) await repo.remove(key);
  return { ...report, applied: true };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    if (!process.env.ACCOUNTS_PROJECT_ID || !process.env.ACCOUNTS_BLOB_TOKEN) throw new Error('Supply ACCOUNTS_PROJECT_ID and ACCOUNTS_BLOB_TOKEN only to this process.');
    const store = getStore({ name: 'studev-collections', consistency: 'strong', projectId: process.env.ACCOUNTS_PROJECT_ID, token: process.env.ACCOUNTS_BLOB_TOKEN });
    const repo = createRepository(store, { secret: randomBytes(32).toString('hex') });
    let ownerProfile;
    if (process.env.STUDEV_PRIVATE_DIR) {
      try { ownerProfile = JSON.parse(await readFile(resolve(process.env.STUDEV_PRIVATE_DIR, '.env.platform-owner-profile.local.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    console.log(JSON.stringify(await migrateAccounts(repo, { apply: process.argv.includes('--apply'), ownerProfile })));
  } catch (error) {
    // Storage errors can contain private keys/URLs; never print their messages.
    console.error(JSON.stringify({ status: 'migration_failed', name: error.name })); process.exitCode = 1;
  }
}
