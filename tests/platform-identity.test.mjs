import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, normalizeRealName, normalizeStudentId } from '../src/server/platform-identity.mjs';
import { createRepository } from '../src/server/platform-store.mjs';
import { hashPassword } from '../src/server/collection-auth.mjs';
import { base32Encode, decryptTotp, encryptTotp, matchedTotpCounter, totpCode } from '../src/server/platform-totp.mjs';

const ORIGIN = 'https://studev.example.test';
const INITIAL = 'synthetic-owner-password-123';
const CHANGED = 'synthetic-owner-password-changed-123';
const MEMBER_PASSWORD = 'synthetic-member-password-123';
const INVITE = 'synthetic-invite-password-123';
const ownerHash = await hashPassword(INITIAL);
const inviteHash = await hashPassword(INVITE);

function fixture() {
  let clock = Date.UTC(2026, 9, 21, 15);
  const values = new Map();
  const store = {
    async get(key) { return structuredClone(values.get(key) ?? null); },
    async setJSON(key, value, options) { if (options?.onlyIfNew && values.has(key)) throw Object.assign(new Error('conditional write'), { code: 'PRECONDITION_FAILED' }); values.set(key, structuredClone(value)); },
    async delete(key) { values.delete(key); },
    async list({ prefix }) { return { blobs: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; },
  };
  const env = { PLATFORM_ORIGIN: ORIGIN, PLATFORM_OWNER_QQ: '10000111', PLATFORM_OWNER_NICKNAME: 'Test Owner', PLATFORM_OWNER_PASSWORD_HASH: ownerHash,
    PLATFORM_SESSION_SECRET: 'synthetic-platform-session-secret-'.repeat(2), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), PLATFORM_REGISTRATION_HASH: inviteHash };
  const now = () => clock;
  const repo = createRepository(store, { now, secret: env.PLATFORM_SESSION_SECRET });
  const identity = createIdentity({ repo, env, now });
  const request = (route, method = 'GET', body, auth, extra = {}) => new Request(`${ORIGIN}/api/platform${route}`, { method, headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: ORIGIN } : {}), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  async function call(route, method = 'GET', body, auth, extra = {}) {
    if (route === '/auth/register') body = { studentId: `STU${body.qq}`, realName: '合成测试成员', ...body };
    const result = await identity.handle({ request: request(route, method, body, auth, extra) }, `/api/platform${route}`);
    const data = await result.json();
    return { ...data, status: result.status, cookie: result.headers.get('Set-Cookie')?.split(';')[0], headers: result.headers };
  }
  const factor = (secret) => totpCode(secret, Math.floor(clock / 30_000));
  const advance = (ms = 30000) => { clock += ms; };
  async function owner() {
    let auth = await call('/auth/legacy-profile-login', 'POST', { qq: env.PLATFORM_OWNER_QQ, password: INITIAL });
    await call('/auth/password', 'POST', { currentPassword: INITIAL, newPassword: CHANGED }, auth);
    auth = await call('/auth/legacy-profile-login', 'POST', { qq: env.PLATFORM_OWNER_QQ, password: CHANGED });
    const setup = await call('/auth/totp/setup', 'POST', { password: CHANGED }, auth);
    const confirmed = await call('/auth/totp/confirm', 'POST', { code: factor(setup.secret) }, auth);
    const current = await call('/auth/session', 'GET', undefined, auth);
    await call('/auth/profile', 'POST', { studentId: 'TESTOWNER01', realName: '合成测试所有者', revision: current.user.revision }, auth);
    return { ...auth, ...(await call('/auth/session', 'GET', undefined, auth)), secret: setup.secret, recoveryCodes: confirmed.recoveryCodes, cookie: auth.cookie };
  }
  async function member(qq = '10000222') {
    const { user } = await call('/auth/register', 'POST', { qq, nickname: 'Synthetic member', password: MEMBER_PASSWORD, inviteCode: INVITE, role: 'owner' });
    return { ...(await call('/auth/login', 'POST', { studentId: user.studentId, password: MEMBER_PASSWORD })), user };
  }
  return { identity, env, repo, store, values, call, request, factor, advance, owner, member };
}

const rejects = (promise, code, status) => assert.rejects(promise, (error) => error.code === code && (!status || error.status === status));

async function legacyMember(f, qq = '10004001') {
  const member = await f.member(qq);
  const current = await f.repo.latest(`identity/users/${member.user.id}`);
  const { studentId, realName, identityVerified, ...old } = current;
  await f.repo.append(`identity/users/${current.id}`, old, current.revision);
  f.values.set(`platform-v1/identity/qq/${current.qq}.json`, { id: current.id });
  f.values.delete(`platform-v1/identity/student/${studentId}.json`);
  return f.call('/auth/legacy-profile-login', 'POST', { qq, password: MEMBER_PASSWORD });
}

test('TOTP follows RFC 6238 SHA-1 vectors and rejects drift outside the window', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(totpCode(secret, Math.floor(seconds / 30), 8), expected);
  }
  const code = totpCode(secret, 100);
  assert.equal(matchedTotpCounter(secret, code, 101 * 30000), 100);
  assert.equal(matchedTotpCounter(secret, code, 103 * 30000), null);
  assert.equal(matchedTotpCounter(secret, '123', 100 * 30000), null);
});

test('TOTP encryption binds both ciphertext integrity and immutable user ID', () => {
  const key = Buffer.alloc(32, 8).toString('base64');
  const encrypted = encryptTotp('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', key, 'user-1');
  assert.equal(decryptTotp(encrypted, key, 'user-1'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
  assert.throws(() => decryptTotp(encrypted, key, 'user-2'));
  assert.throws(() => decryptTotp({ ...encrypted, data: Buffer.alloc(32).toString('base64') }, key, 'user-1'));
});

test('bootstrap is one-time, password change and staff enrollment restrict business access', async () => {
  const f = fixture();
  const login = await f.call('/auth/legacy-profile-login', 'POST', { qq: f.env.PLATFORM_OWNER_QQ, password: INITIAL });
  assert.equal(login.passwordChangeRequired, true); assert.equal(login.enrollmentRequired, true);
  assert.match(login.headers.get('Set-Cookie'), /HttpOnly; SameSite=Strict/); assert.match(login.headers.get('Set-Cookie'), /; Secure/);
  await rejects(f.identity.authenticate(f.request('/forms', 'GET', undefined, login), { required: true }), 'AUTH_SETUP_REQUIRED', 403);
  await rejects(f.call('/admin/users', 'GET', undefined, login), 'AUTH_SETUP_REQUIRED', 403);
  await f.call('/auth/password', 'POST', { currentPassword: INITIAL, newPassword: CHANGED }, login);
  await rejects(f.call('/auth/session', 'GET', undefined, login), 'AUTH_REQUIRED', 401);
  const freshService = createIdentity({ repo: f.repo, env: f.env });
  await freshService.handle({ request: f.request('/auth/config') }, '/api/platform/auth/config');
  await rejects(f.call('/auth/legacy-profile-login', 'POST', { qq: f.env.PLATFORM_OWNER_QQ, password: INITIAL }), 'LOGIN_FAILED', 401);
  const newLogin = await f.call('/auth/legacy-profile-login', 'POST', { qq: f.env.PLATFORM_OWNER_QQ, password: CHANGED });
  assert.equal(newLogin.user.id, login.user.id); assert.equal(newLogin.passwordChangeRequired, false); assert.equal(newLogin.enrollmentRequired, true);
});

test('owner enrollment stores no plaintext secret, raises only the current session, and prevents TOTP replay', async () => {
  const f = fixture(), owner = await f.owner();
  assert.equal(owner.mfaVerified, true); assert.equal(owner.user.totpEnabled, true);
  assert.equal(owner.recoveryCodes.length, 10);
  const persisted = JSON.stringify([...f.values.values()]);
  assert.ok(!persisted.includes(owner.secret));
  for (const code of owner.recoveryCodes) assert.ok(!persisted.includes(code));
  const list = await f.call('/admin/users', 'GET', undefined, owner);
  assert.equal(list.items.length, 1); assert.equal(list.items[0].role, 'owner'); assert.ok(!JSON.stringify(list).includes('passwordHash'));
  await rejects(f.call('/auth/login', 'POST', { studentId: 'TESTOWNER01', password: CHANGED, totp: f.factor(owner.secret) }), 'MFA_REPLAYED', 401);
  f.advance();
  const fresh = await f.call('/auth/login', 'POST', { studentId: 'TESTOWNER01', password: CHANGED, totp: f.factor(owner.secret) });
  assert.equal(fresh.mfaVerified, true);
  const limited = await f.call('/auth/login', 'POST', { studentId: 'TESTOWNER01', password: CHANGED });
  assert.equal(limited.mfaRequired, true);
  await rejects(f.identity.authenticate(f.request('/forms', 'GET', undefined, limited)), 'AUTH_SETUP_REQUIRED', 403);
});

test('recovery codes are atomic single-use even when two logins race', async () => {
  const f = fixture(), owner = await f.owner();
  const attempts = await Promise.allSettled([1, 2].map(() => f.call('/auth/login', 'POST', { studentId: 'TESTOWNER01', password: CHANGED, totp: owner.recoveryCodes[0] })));
  assert.equal(attempts.filter((value) => value.status === 'fulfilled').length, 1);
  assert.equal(attempts.find((value) => value.status === 'rejected').reason.code, 'MFA_REPLAYED');
});

test('invited registration always creates member with unverified derived QQ contact email', async () => {
  const f = fixture();
  await rejects(f.call('/auth/register', 'POST', { qq: '10000222', nickname: 'Member', password: MEMBER_PASSWORD, inviteCode: 'bad' }), 'INVITE_INVALID', 403);
  const member = await f.member();
  assert.equal(member.user.role, 'member'); assert.equal(member.user.email, '10000222@qq.com'); assert.equal(member.user.emailVerified, false);
  assert.ok(member.user.id !== member.user.qq);
  assert.equal((await f.identity.authenticate(f.request('/forms', 'GET', undefined, member), { required: true })).user.id, member.user.id);
  await rejects(f.call('/admin/users', 'GET', undefined, member), 'OWNER_REQUIRED', 403);
  await rejects(f.call('/auth/register', 'POST', { qq: '10000222', nickname: 'Other', password: MEMBER_PASSWORD, inviteCode: INVITE }), 'QQ_ALREADY_REGISTERED', 409);
});

test('password bounds and QQ validation reject malformed input before registration', async () => {
  const f = fixture();
  for (const password of ['short', 'a'.repeat(257)]) await rejects(f.call('/auth/register', 'POST', { qq: '10000333', nickname: 'Member', password, inviteCode: INVITE }), 'PASSWORD_POLICY', 400);
  await rejects(f.call('/auth/register', 'POST', { qq: '1234@qq.com', nickname: 'Member', password: MEMBER_PASSWORD, inviteCode: INVITE }), 'INVALID_QQ', 400);
});

test('all identity mutations require exact Origin and authenticated mutations also require CSRF', async () => {
  const f = fixture(), member = await f.member();
  await rejects(f.call('/auth/login', 'POST', { studentId: 'STU10000222', password: MEMBER_PASSWORD }, undefined, { Origin: 'https://evil.invalid' }), 'ORIGIN_REJECTED', 403);
  await rejects(f.call('/auth/profile', 'POST', { nickname: 'Changed', revision: member.user.revision }, member, { 'X-CSRF-Token': 'incorrect' }), 'CSRF_REJECTED', 403);
  await rejects(f.call('/auth/logout', 'POST', {}, member, { Origin: 'https://evil.invalid' }), 'ORIGIN_REJECTED', 403);
  await rejects(f.call('/auth/totp/setup', 'POST', { password: MEMBER_PASSWORD }, member, { 'X-CSRF-Token': 'incorrect' }), 'CSRF_REJECTED', 403);
});

test('profile updates are versioned and cannot mutate QQ, user ID, role or email ownership', async () => {
  const f = fixture(), member = await f.member();
  const updated = await f.call('/auth/profile', 'POST', { nickname: 'New name', revision: member.user.revision, qq: '99999999', role: 'owner', emailVerified: true }, member);
  assert.equal(updated.user.nickname, 'New name'); assert.equal(updated.user.qq, member.user.qq); assert.equal(updated.user.id, member.user.id);
  assert.equal(updated.user.role, 'member'); assert.equal(updated.user.emailVerified, false);
  await rejects(f.call('/auth/profile', 'POST', { nickname: 'Stale', revision: member.user.revision }, member), 'REVISION_CONFLICT', 409);
});

test('promotion revokes sessions; admin authority works without mandatory TOTP while optional TOTP is enforced when enabled', async () => {
  const f = fixture(), owner = await f.owner(), member = await f.member();
  const promoted = await f.call(`/admin/users/${member.user.id}`, 'POST', { revision: member.user.revision, role: 'admin' }, owner);
  assert.equal(promoted.user.role, 'admin');
  await rejects(f.call('/auth/session', 'GET', undefined, member), 'AUTH_REQUIRED', 401);
  const directAdmin = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD });
  assert.equal(directAdmin.enrollmentRequired, false);
  assert.equal((await f.identity.authenticate(f.request('/admin/forms', 'GET', undefined, directAdmin), { staff: true })).user.role, 'admin');
  await rejects(f.call('/admin/users', 'GET', undefined, directAdmin), 'OWNER_REQUIRED', 403);
  const setup = await f.call('/auth/totp/setup', 'POST', { password: MEMBER_PASSWORD }, directAdmin);
  await f.call('/auth/totp/confirm', 'POST', { code: f.factor(setup.secret) }, directAdmin);
  const mfaAdmin = { ...directAdmin, ...(await f.call('/auth/session', 'GET', undefined, directAdmin)), cookie: directAdmin.cookie };
  assert.equal((await f.identity.authenticate(f.request('/admin/forms', 'GET', undefined, mfaAdmin), { staff: true })).user.role, 'admin');
  const unverifiedAdmin = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD });
  assert.equal(unverifiedAdmin.mfaRequired, true);
  await rejects(f.identity.authenticate(f.request('/admin/forms', 'GET', undefined, unverifiedAdmin), { staff: true }), 'AUTH_SETUP_REQUIRED', 403);
  f.advance();
  const disableCode = f.factor(setup.secret);
  await f.call('/auth/totp/disable', 'POST', { password: MEMBER_PASSWORD, code: disableCode }, mfaAdmin);
  const afterDisable = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD });
  assert.equal(afterDisable.user.totpEnabled, false);
  await f.call(`/admin/users/${member.user.id}`, 'POST', { revision: afterDisable.user.revision, status: 'disabled' }, owner);
  await rejects(f.call('/auth/session', 'GET', undefined, afterDisable), 'AUTH_REQUIRED', 401);
  await rejects(f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD }), 'LOGIN_FAILED', 401);
});

test('shared campus client can register multiple accounts and spoofed IP headers do not bypass account limits', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) {
    const created = await f.call('/auth/register', 'POST', { qq: String(10001000 + i), nickname: 'Campus member', password: MEMBER_PASSWORD, inviteCode: INVITE });
    assert.equal(created.status, 201);
  }
  for (let i = 0; i < 3; i++) {
    await rejects(f.call('/auth/register', 'POST', { qq: '10002000', nickname: 'Member', password: MEMBER_PASSWORD, inviteCode: 'wrong' }, undefined, { 'X-Forwarded-For': `192.0.2.${i}`, 'CF-Connecting-IP': `192.0.2.${i}` }), 'INVITE_INVALID', 403);
  }
  await rejects(f.call('/auth/register', 'POST', { qq: '10002000', nickname: 'Member', password: MEMBER_PASSWORD, inviteCode: INVITE }, undefined, { 'X-Forwarded-For': '192.0.2.99' }), 'RATE_LIMITED', 429);
  for (let i = 0; i < 10; i++) {
    await rejects(f.call('/auth/login', 'POST', { studentId: 'STU10001000', password: 'wrong' }, undefined, { 'X-Real-IP': `192.0.2.${i}` }), 'LOGIN_FAILED', 401);
  }
  await rejects(f.call('/auth/login', 'POST', { studentId: 'STU10001000', password: MEMBER_PASSWORD }, undefined, { 'X-Real-IP': '192.0.2.200' }), 'RATE_LIMITED', 429);
});

test('last owner cannot be disabled, downgraded, or created through role editing', async () => {
  const f = fixture(), owner = await f.owner(), member = await f.member();
  await rejects(f.call(`/admin/users/${owner.user.id}`, 'POST', { revision: owner.user.revision, role: 'member' }, owner), 'LAST_OWNER_PROTECTED', 403);
  await rejects(f.call(`/admin/users/${owner.user.id}`, 'POST', { revision: owner.user.revision, status: 'disabled' }, owner), 'LAST_OWNER_PROTECTED', 403);
  await rejects(f.call(`/admin/users/${member.user.id}`, 'POST', { revision: member.user.revision, role: 'owner' }, owner), 'OWNER_PROVISIONING_REQUIRED', 403);
});

test('controlled password reset revokes sessions and forces change before user business access', async () => {
  const f = fixture(), owner = await f.owner(), member = await f.member();
  const temporary = 'synthetic-reset-password-123';
  await f.call(`/admin/users/${member.user.id}/reset-password`, 'POST', { password: temporary }, owner);
  await rejects(f.call('/auth/session', 'GET', undefined, member), 'AUTH_REQUIRED', 401);
  const limited = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: temporary });
  assert.equal(limited.passwordChangeRequired, true);
  await rejects(f.identity.authenticate(f.request('/forms', 'GET', undefined, limited)), 'AUTH_SETUP_REQUIRED', 403);
  await f.call('/auth/password', 'POST', { currentPassword: temporary, newPassword: MEMBER_PASSWORD }, limited);
  const changed = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD });
  assert.equal(changed.passwordChangeRequired, false);
});

test('TOTP reset revokes sessions; admin can log in without TOTP while owner cannot disable TOTP', async () => {
  const f = fixture(), owner = await f.owner(), member = await f.member();
  await rejects(f.call('/auth/totp/disable', 'POST', { password: CHANGED, code: '000000' }, owner), 'STAFF_TOTP_REQUIRED', 403);
  const setup = await f.call('/auth/totp/setup', 'POST', { password: MEMBER_PASSWORD }, member);
  await f.call('/auth/totp/confirm', 'POST', { code: f.factor(setup.secret) }, member);
  const refreshed = await f.call('/auth/session', 'GET', undefined, member);
  await f.call(`/admin/users/${member.user.id}`, 'POST', { revision: refreshed.user.revision, role: 'admin' }, owner);
  await f.call(`/admin/users/${member.user.id}/reset-totp`, 'POST', {}, owner);
  const resetAdmin = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD });
  assert.equal(resetAdmin.enrollmentRequired, false);
  assert.equal((await f.identity.authenticate(f.request('/admin/forms', 'GET', undefined, resetAdmin), { staff: true })).user.role, 'admin');
  const audit = await f.call('/admin/audit', 'GET', undefined, owner);
  assert.ok(audit.items.some((item) => item.action === 'identity.totp.reset'));
  assert.ok(!JSON.stringify(audit).includes(setup.secret)); assert.ok(!JSON.stringify(audit).includes(MEMBER_PASSWORD));
});

test('logout revokes server-side session and expired or forged sessions cannot authenticate', async () => {
  const f = fixture(), member = await f.member();
  await f.call('/auth/logout', 'POST', {}, member);
  await rejects(f.call('/auth/session', 'GET', undefined, member), 'AUTH_REQUIRED', 401);
  const relogin = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD });
  const forged = { ...relogin, cookie: relogin.cookie.slice(0, -1) + (relogin.cookie.endsWith('a') ? 'b' : 'a') };
  await rejects(f.call('/auth/session', 'GET', undefined, forged), 'AUTH_REQUIRED', 401);
  f.advance(7200001);
  await rejects(f.call('/auth/session', 'GET', undefined, relogin), 'AUTH_REQUIRED', 401);
});

test('expired enrollment cannot confirm and missing registration hash closes registration', async () => {
  const f = fixture(), member = await f.member();
  const setup = await f.call('/auth/totp/setup', 'POST', { password: MEMBER_PASSWORD }, member);
  f.advance(600001);
  await rejects(f.call('/auth/totp/confirm', 'POST', { code: f.factor(setup.secret) }, member), 'TOTP_SETUP_EXPIRED', 400);
  f.env.PLATFORM_REGISTRATION_HASH = '';
  const config = await f.call('/auth/config'); assert.equal(config.registrationEnabled, false); assert.equal(config.emailDeliveryEnabled, false);
  await rejects(f.call('/auth/register', 'POST', { qq: '10000444', nickname: 'Member', password: MEMBER_PASSWORD, inviteCode: INVITE }), 'REGISTRATION_CLOSED', 403);
});

test('student IDs normalize NFKC, trim and case while real names allow duplicates but reject controls', () => {
  assert.equal(normalizeStudentId('  ａｂ１２３４  '), 'AB1234');
  assert.equal(normalizeStudentId('ABCDEFGHIJ1234567890'), 'ABCDEFGHIJ1234567890');
  for (const value of ['abc12', 'A'.repeat(21), '12 3456', '123456@qq.com', undefined]) assert.throws(() => normalizeStudentId(value), (error) => error.code === 'INVALID_STUDENT_ID');
  assert.equal(normalizeRealName('  合成测试甲  '), '合成测试甲');
  for (const value of ['', ' ', 'a'.repeat(41), '测试\n甲', '测试\t甲', '\u200b姓名', '甲\u2028乙', undefined]) assert.throws(() => normalizeRealName(value), (error) => error.code === 'INVALID_REAL_NAME');
});

test('registration requires student ID and real name, uses real name as optional nickname default, and ignores verification claims', async () => {
  const f = fixture();
  await rejects(f.call('/auth/register', 'POST', { qq: '10003001', password: MEMBER_PASSWORD, inviteCode: INVITE, studentId: undefined }), 'INVALID_STUDENT_ID', 400);
  await rejects(f.call('/auth/register', 'POST', { qq: '10003002', password: MEMBER_PASSWORD, inviteCode: INVITE, realName: undefined }), 'INVALID_REAL_NAME', 400);
  const registered = await f.call('/auth/register', 'POST', { qq: '10003003', password: MEMBER_PASSWORD, inviteCode: INVITE, studentId: '  ａｂ１２３４  ', realName: '合成测试甲', identityVerified: true, role: 'owner' });
  assert.equal(registered.user.studentId, 'AB1234'); assert.equal(registered.user.realName, '合成测试甲');
  assert.equal(registered.user.nickname, '合成测试甲'); assert.equal(registered.user.profileComplete, true);
  assert.equal(registered.user.identityVerified, false); assert.equal(registered.user.role, 'member');
});

test('student ID is unique across case and Unicode aliases while same names and separate QQ accounts are allowed', async () => {
  const f = fixture();
  const first = await f.call('/auth/register', 'POST', { qq: '10003101', studentId: 'ab123456', realName: '同名合成成员', password: MEMBER_PASSWORD, inviteCode: INVITE });
  await rejects(f.call('/auth/register', 'POST', { qq: '10003102', studentId: 'ＡＢ１２３４５６', realName: '另一合成成员', password: MEMBER_PASSWORD, inviteCode: INVITE }), 'STUDENT_ID_ALREADY_REGISTERED', 409);
  const second = await f.call('/auth/register', 'POST', { qq: '10003103', studentId: 'ab654321', realName: '同名合成成员', password: MEMBER_PASSWORD, inviteCode: INVITE });
  assert.equal(first.user.realName, second.user.realName); assert.notEqual(first.user.id, second.user.id);
  await rejects(f.call('/auth/register', 'POST', { qq: '10003101', studentId: 'AB999999', realName: '同名合成成员', password: MEMBER_PASSWORD, inviteCode: INVITE }), 'QQ_ALREADY_REGISTERED', 409);
});

test('concurrent accounts racing for one normalized student ID create only one usable account', async () => {
  const f = fixture();
  const attempts = await Promise.allSettled(['10003201', '10003202'].map((qq, i) => f.call('/auth/register', 'POST', { qq, studentId: i ? 'race1234' : 'RACE1234', realName: '并发合成成员', password: MEMBER_PASSWORD, inviteCode: INVITE })));
  const accepted = attempts.filter((result) => result.status === 'fulfilled');
  assert.equal(accepted.length, 1);
  assert.equal(attempts.find((result) => result.status === 'rejected').reason.code, 'STUDENT_ID_ALREADY_REGISTERED');
  const claim = await f.repo.get('identity/student/RACE1234.json'); assert.equal(claim.id, accepted[0].value.user.id);
  const users = [...f.values.entries()].filter(([key]) => /identity\/users\/.+\/00000001\.json$/.test(key)).map(([, user]) => user);
  assert.equal(users.filter((user) => user.studentId === 'RACE1234').length, 1);
});

test('ambiguous registration index writes preserve claims and same credentials can resume safely', async () => {
  for (const target of ['identity/qq/10003301.json', 'identity/student/RESUME01.json']) {
    const f = fixture(), original = f.store.setJSON;
    let injected = false;
    f.store.setJSON = async (key, value, options) => {
      await original(key, value, options);
      if (!injected && key.endsWith(target)) { injected = true; throw new Error('Synthetic transport loss after committed write'); }
    };
    const body = { qq: '10003301', studentId: 'RESUME01', realName: '恢复合成成员', password: MEMBER_PASSWORD, inviteCode: INVITE };
    await assert.rejects(f.call('/auth/register', 'POST', body), /Synthetic transport loss/);
    const reserved = await f.repo.get('identity/qq/10003301.json'); assert.ok(reserved?.id);
    const recovered = await f.call('/auth/register', 'POST', body);
    assert.equal(recovered.user.id, reserved.id); assert.equal(recovered.user.studentId, 'RESUME01');
    assert.equal((await f.repo.get('identity/student/RESUME01.json')).id, reserved.id);
  }
});

test('an abandoned registration cannot be resumed by a different password or different identity', async () => {
  const f = fixture(), original = f.store.setJSON;
  let injected = false;
  f.store.setJSON = async (key, value, options) => {
    await original(key, value, options);
    if (!injected && key.endsWith('identity/qq/10003401.json')) { injected = true; throw new Error('Synthetic loss'); }
  };
  const body = { qq: '10003401', studentId: 'RESUME02', realName: '恢复合成成员', password: MEMBER_PASSWORD, inviteCode: INVITE };
  await assert.rejects(f.call('/auth/register', 'POST', body), /Synthetic loss/);
  await rejects(f.call('/auth/register', 'POST', { ...body, password: 'different-synthetic-password-123' }), 'REGISTRATION_PENDING', 409);
  await rejects(f.call('/auth/register', 'POST', { ...body, studentId: 'RESUME03' }), 'REGISTRATION_PENDING', 409);
  assert.equal(await f.repo.get('identity/student/RESUME03.json'), null);
});

test('legacy accounts can log in and complete profile without changing immutable UID or credentials', async () => {
  const f = fixture(), member = await f.member();
  const current = await f.repo.latest(`identity/users/${member.user.id}`);
  const { studentId, realName, identityVerified, ...legacy } = current;
  const migrated = await f.repo.append(`identity/users/${current.id}`, legacy, current.revision);
  f.values.set(`platform-v1/identity/qq/${current.qq}.json`, { id: current.id });
  const login = await f.call('/auth/legacy-profile-login', 'POST', { qq: current.qq, password: MEMBER_PASSWORD });
  assert.equal(login.profileRequired, true); assert.equal(login.user.profileComplete, false);
  await rejects(f.identity.authenticate(f.request('/forms', 'GET', undefined, login), { required: true }), 'AUTH_SETUP_REQUIRED', 403);
  const completed = await f.call('/auth/profile', 'POST', { studentId: 'LEGACY001', realName: '旧账号合成成员', nickname: '旧成员昵称', revision: migrated.revision, identityVerified: true, role: 'owner' }, login);
  assert.equal(completed.user.id, current.id); assert.equal(completed.user.profileComplete, true); assert.equal(completed.user.identityVerified, false);
  assert.equal(completed.user.role, 'member'); assert.equal((await f.repo.latest(`identity/users/${current.id}`)).passwordHash, current.passwordHash);
  assert.equal((await f.identity.authenticate(f.request('/forms', 'GET', undefined, login), { required: true })).user.id, current.id);
});

test('profile completion preserves legacy staff password and MFA requirements', async () => {
  const f = fixture();
  let login = await f.call('/auth/legacy-profile-login', 'POST', { qq: f.env.PLATFORM_OWNER_QQ, password: INITIAL });
  await rejects(f.call('/auth/profile', 'POST', { studentId: 'OLDOWNER01', realName: '旧合成所有者', revision: login.user.revision }, login), 'AUTH_SETUP_REQUIRED', 403);
  await f.call('/auth/password', 'POST', { currentPassword: INITIAL, newPassword: CHANGED }, login);
  login = await f.call('/auth/legacy-profile-login', 'POST', { qq: f.env.PLATFORM_OWNER_QQ, password: CHANGED });
  await rejects(f.call('/auth/profile', 'POST', { studentId: 'OLDOWNER01', realName: '旧合成所有者', revision: login.user.revision }, login), 'AUTH_SETUP_REQUIRED', 403);
  const setup = await f.call('/auth/totp/setup', 'POST', { password: CHANGED }, login);
  await f.call('/auth/totp/confirm', 'POST', { code: f.factor(setup.secret) }, login);
  const ready = await f.call('/auth/session', 'GET', undefined, login);
  assert.equal(ready.profileRequired, true); assert.equal(ready.mfaVerified, true);
  const completed = await f.call('/auth/profile', 'POST', { studentId: 'OLDOWNER01', realName: '旧合成所有者', revision: ready.user.revision }, login);
  const before = await f.repo.latest(`identity/users/${completed.user.id}`);
  const reloaded = createIdentity({ repo: f.repo, env: { ...f.env, PLATFORM_OWNER_PASSWORD_HASH: ownerHash }, now: () => Date.UTC(2026, 9, 21, 15) });
  await reloaded.handle({ request: f.request('/auth/config') }, '/api/platform/auth/config');
  const after = await f.repo.latest(`identity/users/${completed.user.id}`);
  assert.equal(after.id, before.id); assert.equal(after.passwordHash, before.passwordHash); assert.deepEqual(after.totp, before.totp);
  assert.equal(after.studentId, 'OLDOWNER01'); assert.equal(after.role, 'owner');
});

test('bound identities cannot be self-edited or self-verified while nickname remains editable', async () => {
  const f = fixture(), member = await f.member();
  await rejects(f.call('/auth/profile', 'POST', { studentId: 'OTHER123', revision: member.user.revision }, member), 'IDENTITY_LOCKED', 403);
  await rejects(f.call('/auth/profile', 'POST', { realName: '更改合成姓名', revision: member.user.revision }, member), 'IDENTITY_LOCKED', 403);
  const updated = await f.call('/auth/profile', 'POST', { nickname: '新的合成昵称', identityVerified: true, revision: member.user.revision }, member);
  assert.equal(updated.user.nickname, '新的合成昵称'); assert.equal(updated.user.realName, member.user.realName);
  assert.equal(updated.user.identityVerified, false);
});

test('only MFA-verified owner verifies identity; name corrections revoke it and student ID stays locked', async () => {
  const f = fixture(), owner = await f.owner(), member = await f.member();
  await rejects(f.call(`/admin/users/${member.user.id}`, 'POST', { identityVerified: true, revision: member.user.revision }, member), 'OWNER_REQUIRED', 403);
  const limitedOwner = await f.call('/auth/login', 'POST', { studentId: 'TESTOWNER01', password: CHANGED });
  await rejects(f.call(`/admin/users/${member.user.id}`, 'POST', { identityVerified: true, revision: member.user.revision }, limitedOwner), 'AUTH_SETUP_REQUIRED', 403);
  const verified = await f.call(`/admin/users/${member.user.id}`, 'POST', { identityVerified: true, revision: member.user.revision }, owner);
  assert.equal(verified.user.identityVerified, true); assert.equal(verified.user.role, 'member');
  const corrected = await f.call(`/admin/users/${member.user.id}`, 'POST', { realName: '更正合成姓名', identityVerified: true, revision: verified.user.revision }, owner);
  assert.equal(corrected.user.realName, '更正合成姓名'); assert.equal(corrected.user.identityVerified, false);
  await rejects(f.call(`/admin/users/${member.user.id}`, 'POST', { studentId: 'OTHER456', revision: corrected.user.revision }, owner), 'STUDENT_ID_LOCKED', 403);
  const reverified = await f.call(`/admin/users/${member.user.id}`, 'POST', { identityVerified: true, revision: corrected.user.revision }, owner);
  assert.equal(reverified.user.identityVerified, true);
  const audit = await f.call('/admin/audit', 'GET', undefined, owner);
  assert.ok(audit.items.some((entry) => entry.action === 'identity.profile.corrected' && entry.details.identityVerified === false));
  assert.ok(!JSON.stringify(audit).includes('更正合成姓名')); assert.ok(!JSON.stringify(audit).includes(member.user.studentId));
});

test('normal login accepts only normalized student ID and independently checks the index against the stored account', async () => {
  const f = fixture(), member = await f.member();
  const login = await f.call('/auth/login', 'POST', { studentId: `  ${member.user.studentId.toLowerCase()}  `, password: MEMBER_PASSWORD });
  assert.equal(login.user.id, member.user.id); assert.equal(login.profileRequired, false);
  await rejects(f.call('/auth/login', 'POST', { qq: member.user.qq, password: MEMBER_PASSWORD }), 'STUDENT_LOGIN_REQUIRED', 400);
  await rejects(f.call('/auth/login', 'POST', { studentId: member.user.studentId, qq: member.user.qq, password: MEMBER_PASSWORD }), 'STUDENT_LOGIN_REQUIRED', 400);
  f.values.set('platform-v1/identity/student/OTHERID01.json', { id: member.user.id });
  await rejects(f.call('/auth/login', 'POST', { studentId: 'OTHERID01', password: MEMBER_PASSWORD }), 'LOGIN_FAILED', 401);
});

test('legacy migration refuses complete accounts, disabled users and pending new-registration metadata', async () => {
  const f = fixture(), member = await f.member();
  await rejects(f.call('/auth/legacy-profile-login', 'POST', { qq: member.user.qq, password: MEMBER_PASSWORD }), 'LOGIN_FAILED', 401);
  const current = await f.repo.latest(`identity/users/${member.user.id}`);
  const { studentId, realName, identityVerified, ...old } = current;
  const incomplete = await f.repo.append(`identity/users/${current.id}`, old, current.revision);
  await rejects(f.call('/auth/legacy-profile-login', 'POST', { qq: member.user.qq, password: MEMBER_PASSWORD }), 'LOGIN_FAILED', 401);
  f.values.set(`platform-v1/identity/qq/${current.qq}.json`, { id: current.id });
  await f.repo.append(`identity/users/${current.id}`, { ...incomplete, status: 'disabled' }, incomplete.revision);
  await rejects(f.call('/auth/legacy-profile-login', 'POST', { qq: member.user.qq, password: MEMBER_PASSWORD }), 'LOGIN_FAILED', 401);
  await rejects(f.call('/auth/legacy-profile-login', 'POST', { qq: '10009999', password: MEMBER_PASSWORD }), 'LOGIN_FAILED', 401);
});

test('owner migration permanently closes old QQ login and preserves the same UID, password and authenticator', async () => {
  const f = fixture(), owner = await f.owner();
  const current = await f.repo.latest(`identity/users/${owner.user.id}`);
  await rejects(f.call('/auth/legacy-profile-login', 'POST', { qq: f.env.PLATFORM_OWNER_QQ, password: CHANGED }), 'LOGIN_FAILED', 401);
  f.advance();
  const login = await f.call('/auth/login', 'POST', { studentId: 'testowner01', password: CHANGED, totp: f.factor(owner.secret) });
  assert.equal(login.user.id, owner.user.id); assert.equal(login.mfaVerified, true);
  const unchanged = await f.repo.latest(`identity/users/${owner.user.id}`);
  assert.equal(unchanged.passwordHash, current.passwordHash); assert.deepEqual(unchanged.totp, current.totp);
});

test('MFA owner can initially bind a legacy account but cannot move an already bound student ID', async () => {
  const f = fixture(), owner = await f.owner(), member = await f.member();
  const current = await f.repo.latest(`identity/users/${member.user.id}`);
  const { studentId, realName, identityVerified, ...old } = current;
  const incomplete = await f.repo.append(`identity/users/${current.id}`, old, current.revision);
  f.values.set(`platform-v1/identity/qq/${current.qq}.json`, { id: current.id });
  const bound = await f.call(`/admin/users/${current.id}`, 'POST', { studentId: 'MANAGED01', realName: '核对合成成员', identityVerified: true, revision: incomplete.revision }, owner);
  assert.equal(bound.user.studentId, 'MANAGED01'); assert.equal(bound.user.profileComplete, true); assert.equal(bound.user.identityVerified, false);
  assert.equal((await f.repo.get('identity/student/MANAGED01.json')).id, current.id);
  const login = await f.call('/auth/login', 'POST', { studentId: 'MANAGED01', password: MEMBER_PASSWORD });
  assert.equal(login.user.id, current.id);
  await rejects(f.call(`/admin/users/${current.id}`, 'POST', { studentId: 'MANAGED02', realName: '核对合成成员', revision: bound.user.revision }, owner), 'STUDENT_ID_LOCKED', 403);
});

test('concurrent self profile binding reserves only one student ID for a legacy account', async () => {
  const f = fixture(), member = await legacyMember(f);
  const attempts = await Promise.allSettled(['SELFA001', 'SELFB001'].map((studentId) => f.call('/auth/profile', 'POST', { studentId, realName: '合成并发成员', revision: member.user.revision }, member)));
  const accepted = attempts.filter((value) => value.status === 'fulfilled');
  assert.equal(accepted.length, 1);
  const rejected = attempts.find((value) => value.status === 'rejected');
  assert.ok(['PROFILE_BINDING_PENDING', 'REVISION_CONFLICT', 'IDENTITY_LOCKED'].includes(rejected.reason.code));
  const claims = await Promise.all(['SELFA001', 'SELFB001'].map((studentId) => f.repo.get(`identity/student/${studentId}.json`)));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await f.repo.get(`identity/binding/${member.user.id}.json`)).studentId, accepted[0].value.user.studentId);
  assert.equal((await f.repo.latest(`identity/users/${member.user.id}`)).studentId, accepted[0].value.user.studentId);
});

test('owner and self racing to first-bind a legacy account share one binding intent', async () => {
  const f = fixture(), owner = await f.owner(), member = await legacyMember(f);
  const attempts = await Promise.allSettled([
    f.call('/auth/profile', 'POST', { studentId: 'SELFOWN1', realName: '合成并发成员', revision: member.user.revision }, member),
    f.call(`/admin/users/${member.user.id}`, 'POST', { studentId: 'OWNER001', realName: '合成并发成员', revision: member.user.revision }, owner),
  ]);
  assert.equal(attempts.filter((value) => value.status === 'fulfilled').length, 1);
  const claims = await Promise.all(['SELFOWN1', 'OWNER001'].map((studentId) => f.repo.get(`identity/student/${studentId}.json`)));
  assert.equal(claims.filter(Boolean).length, 1);
  const current = await f.repo.latest(`identity/users/${member.user.id}`);
  assert.equal((await f.repo.get(`identity/student/${current.studentId}.json`)).id, member.user.id);
});

test('ambiguous first-binding writes preserve the chosen target and same-target self or owner retries recover', async () => {
  for (const actor of ['self', 'owner']) for (const stage of ['intent', 'student']) {
    const f = fixture(), owner = actor === 'owner' ? await f.owner() : null, member = await legacyMember(f);
    const target = stage === 'intent' ? `identity/binding/${member.user.id}.json` : 'identity/student/RESUMEB1.json';
    const original = f.store.setJSON; let injected = false;
    f.store.setJSON = async (key, value, options) => {
      await original(key, value, options);
      if (!injected && key.endsWith(target)) { injected = true; throw new Error('Synthetic transport loss after binding write'); }
    };
    const route = actor === 'self' ? '/auth/profile' : `/admin/users/${member.user.id}`;
    const auth = owner || member;
    const body = { studentId: 'RESUMEB1', realName: '合成恢复成员', revision: member.user.revision };
    await assert.rejects(f.call(route, 'POST', body, auth), /Synthetic transport loss/);
    assert.equal((await f.repo.get(`identity/binding/${member.user.id}.json`)).studentId, body.studentId);
    await rejects(f.call(route, 'POST', { ...body, studentId: 'RESUMEB2' }, auth), 'PROFILE_BINDING_PENDING', 409);
    assert.equal(await f.repo.get('identity/student/RESUMEB2.json'), null);
    const recovered = await f.call(route, 'POST', body, auth);
    assert.equal(recovered.user.studentId, body.studentId);
    assert.equal((await f.repo.get(`identity/student/${body.studentId}.json`)).id, member.user.id);
    const renamed = await f.call(route, 'POST', actor === 'self'
      ? { nickname: '合成新昵称', revision: recovered.user.revision }
      : { realName: '合成更正姓名', revision: recovered.user.revision }, auth);
    assert.equal(renamed.user.studentId, body.studentId);
    assert.equal(actor === 'self' ? renamed.user.nickname : renamed.user.realName, actor === 'self' ? '合成新昵称' : '合成更正姓名');
  }
});

test('invalid binding fields and already-occupied student IDs leave no new intent or claim', async () => {
  const f = fixture(), owner = await f.owner(), member = await legacyMember(f), occupied = await f.member('10004002');
  const base = { studentId: 'INVALID1', realName: '合成成员', revision: member.user.revision };
  await rejects(f.call('/auth/profile', 'POST', { ...base, nickname: 'x'.repeat(41) }, member), 'INVALID_FIELD', 400);
  await rejects(f.call(`/admin/users/${member.user.id}`, 'POST', { ...base, identityVerified: 'true' }, owner), 'INVALID_FIELD', 400);
  await rejects(f.call(`/admin/users/${member.user.id}`, 'POST', { ...base, nickname: 'x'.repeat(41) }, owner), 'INVALID_FIELD', 400);
  assert.equal(await f.repo.get(`identity/binding/${member.user.id}.json`), null);
  assert.equal(await f.repo.get('identity/student/INVALID1.json'), null);
  for (const actor of ['self', 'owner']) {
    await rejects(f.call(actor === 'self' ? '/auth/profile' : `/admin/users/${member.user.id}`, 'POST', { ...base, studentId: occupied.user.studentId }, actor === 'self' ? member : owner), 'STUDENT_ID_ALREADY_REGISTERED', 409);
    assert.equal(await f.repo.get(`identity/binding/${member.user.id}.json`), null);
  }
  const recovered = await f.call('/auth/profile', 'POST', base, member);
  assert.equal(recovered.user.studentId, base.studentId);
});

test('unified roster SSOT seeds pending members, claims pending records on registration, and updates public projection on profile signature edit', async () => {
  const f = fixture(), owner = await f.owner();
  await rejects(f.call('/public/roster?term=2099-2100', 'GET'), 'ROSTER_NOT_FOUND', 404);
  assert.equal(await f.repo.get('roster/2099-2100.json'), null);
  const roster = await f.call('/public/roster?term=2026-2027', 'GET');
  assert.equal(roster.term, '2026-2027');
  assert.equal(roster.totalCount, 17);
  assert.equal(roster.groups.length, 5);
  assert.ok(!JSON.stringify(roster).includes('B24041902'));

  // Pending member 李雅婷 (B24041902) cannot log in before registering
  await rejects(f.call('/auth/login', 'POST', { studentId: 'B24041902', password: MEMBER_PASSWORD }), 'LOGIN_FAILED', 401);

  // Registering with B24041902 claims and activates the pre-seeded pending record while preserving department and title
  const claimed = await f.call('/auth/register', 'POST', {
    qq: '1775706379',
    studentId: 'B24041902',
    realName: '李雅婷',
    password: MEMBER_PASSWORD,
    inviteCode: INVITE,
  });
  assert.equal(claimed.status, 201);
  assert.equal(claimed.user.status, 'active');
  assert.equal(claimed.user.department, '主席团与统筹');
  assert.equal(claimed.user.title, '分管协调 · 媒体宣传部');
  assert.equal(claimed.user.term, '2026-2027');

  // Login and update personal signature via /auth/profile -> immediately updates public roster SSOT
  const login = await f.call('/auth/login', 'POST', { studentId: 'B24041902', password: MEMBER_PASSWORD });
  const updatedProfile = await f.call('/auth/profile', 'POST', {
    nickname: '李雅婷',
    signature: '追光而遇，沐光而行',
    revision: login.user.revision,
  }, login);
  assert.equal(updatedProfile.user.signature, '追光而遇，沐光而行');

  const updatedRoster = await f.call('/public/roster?term=2026-2027', 'GET');
  const presGroup = updatedRoster.groups.find((g) => g.name === '主席团与统筹');
  const yating = presGroup.people.find((p) => p.name === '李雅婷');
  assert.equal(yating.signature, '追光而遇，沐光而行');
  assert.equal(yating.role, '分管协调 · 媒体宣传部');
  assert.ok(yating.avatarUrl.includes('1775706379'));

  // Owner can also edit department/title/signature in /admin/users/:id
  const ownerEdited = await f.call(`/admin/users/${login.user.id}`, 'POST', {
    revision: updatedProfile.user.revision,
    role: 'admin',
    title: '分管主席 · 媒体宣传部',
  }, owner);
  assert.equal(ownerEdited.user.role, 'admin');
  assert.equal(ownerEdited.user.title, '分管主席 · 媒体宣传部');
  const afterOwnerEdit = await f.call('/public/roster?term=2026-2027', 'GET');
  assert.equal(afterOwnerEdit.groups[0].people.find((p) => p.name === '李雅婷').role, '分管主席 · 媒体宣传部');
});
