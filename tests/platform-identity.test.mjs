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
const ownerHash = await hashPassword(INITIAL);

function fixture() {
  let clock = Date.UTC(2026, 9, 21, 15);
  const values = new Map();
  const store = {
    async get(key) { return structuredClone(values.get(key) ?? null); },
    async setJSON(key, value, options) { if (options?.onlyIfNew && values.has(key)) throw Object.assign(new Error('conditional write'), { code: 'PRECONDITION_FAILED' }); values.set(key, structuredClone(value)); },
    async delete(key) { values.delete(key); },
    async list({ prefix }) { return { blobs: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; },
  };
  const env = { PLATFORM_ORIGIN: ORIGIN, PLATFORM_OWNER_STUDENT_ID: 'TESTOWNER01', PLATFORM_OWNER_REAL_NAME: '合成测试所有者', PLATFORM_OWNER_QQ: '10000111', PLATFORM_OWNER_NICKNAME: 'Test Owner', PLATFORM_OWNER_PASSWORD_HASH: ownerHash,
    PLATFORM_SESSION_SECRET: 'synthetic-platform-session-secret-'.repeat(2), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
  const now = () => clock;
  const repo = createRepository(store, { now, secret: env.PLATFORM_SESSION_SECRET });
  const identity = createIdentity({ repo, env, now });
  const request = (route, method = 'GET', body, auth, extra = {}) => new Request(`${ORIGIN}/api/platform${route}`, { method, headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: ORIGIN } : {}), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  async function call(route, method = 'GET', body, auth, extra = {}) {
    if (route === '/auth/login') body = { deviceId: crypto.randomUUID(), deviceName: '测试浏览器', ...body };
    if (route === '/auth/register') body = { nickname: '测试昵称', studentId: `STU${body.qq}`, realName: '合成测试成员', ...body };
    const result = await identity.handle({ request: request(route, method, body, auth, extra) }, `/api/platform${route}`);
    const data = await result.json();
    return { ...data, status: result.status, cookie: result.headers.get('Set-Cookie')?.split(';')[0], headers: result.headers };
  }
  const factor = (secret) => totpCode(secret, Math.floor(clock / 30_000));
  const advance = (ms = 30000) => { clock += ms; };
  async function owner() {
    let auth = await call('/auth/login', 'POST', { studentId: env.PLATFORM_OWNER_STUDENT_ID, password: INITIAL });
    await call('/auth/password', 'POST', { currentPassword: INITIAL, newPassword: CHANGED }, auth);
    auth = await call('/auth/login', 'POST', { studentId: env.PLATFORM_OWNER_STUDENT_ID, password: CHANGED });
    const setup = await call('/auth/totp/setup', 'POST', { password: CHANGED }, auth);
    const confirmed = await call('/auth/totp/confirm', 'POST', { code: factor(setup.secret) }, auth);
    const current = await call('/auth/session', 'GET', undefined, auth);
    await call('/auth/profile', 'POST', { studentId: 'TESTOWNER01', realName: '合成测试所有者', revision: current.user.revision }, auth);
    return { ...auth, ...(await call('/auth/session', 'GET', undefined, auth)), secret: setup.secret, recoveryCodes: confirmed.recoveryCodes, cookie: auth.cookie };
  }
  async function member(qq = '10000222') {
    const { user } = await call('/auth/register', 'POST', { qq, nickname: 'Synthetic member', password: MEMBER_PASSWORD, role: 'owner' });
    return { ...(await call('/auth/login', 'POST', { studentId: user.studentId, password: MEMBER_PASSWORD })), user };
  }
  return { identity, env, repo, store, values, call, request, factor, advance, owner, member };
}

const rejects = (promise, code, status) => assert.rejects(promise, (error) => error.code === code && (!status || error.status === status));

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
  const login = await f.call('/auth/login', 'POST', { studentId: f.env.PLATFORM_OWNER_STUDENT_ID, password: INITIAL });
  assert.equal(login.passwordChangeRequired, true); assert.equal(login.enrollmentRequired, true);
  assert.match(login.headers.get('Set-Cookie'), /HttpOnly; SameSite=Strict/); assert.match(login.headers.get('Set-Cookie'), /; Secure/);
  await rejects(f.identity.authenticate(f.request('/forms', 'GET', undefined, login), { required: true }), 'AUTH_SETUP_REQUIRED', 403);
  await rejects(f.call('/admin/users', 'GET', undefined, login), 'AUTH_SETUP_REQUIRED', 403);
  await f.call('/auth/password', 'POST', { currentPassword: INITIAL, newPassword: CHANGED }, login);
  await rejects(f.call('/auth/session', 'GET', undefined, login), 'TOKEN_INVALID', 401);
  const freshService = createIdentity({ repo: f.repo, env: f.env });
  await freshService.handle({ request: f.request('/auth/config') }, '/api/platform/auth/config');
  await rejects(f.call('/auth/login', 'POST', { studentId: f.env.PLATFORM_OWNER_STUDENT_ID, password: INITIAL }), 'LOGIN_FAILED', 401);
  const newLogin = await f.call('/auth/login', 'POST', { studentId: f.env.PLATFORM_OWNER_STUDENT_ID, password: CHANGED });
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
  await rejects(f.call('/auth/login', 'POST', { studentId: 'TESTOWNER01', password: CHANGED }), 'MFA_REQUIRED', 401);
});

test('recovery codes are atomic single-use even when two logins race', async () => {
  const f = fixture(), owner = await f.owner();
  const attempts = await Promise.allSettled([1, 2].map(() => f.call('/auth/login', 'POST', { studentId: 'TESTOWNER01', password: CHANGED, totp: owner.recoveryCodes[0] })));
  assert.equal(attempts.filter((value) => value.status === 'fulfilled').length, 1);
  assert.equal(attempts.find((value) => value.status === 'rejected').reason.code, 'MFA_REPLAYED');
});

test('open registration creates ordinary users with unverified derived contact email', async () => {
  const f = fixture();
  const member = await f.member();
  assert.equal(member.user.role, 'user'); assert.equal(member.user.email, '10000222@qq.com'); assert.equal(member.user.emailVerified, false);
  assert.ok(member.user.id !== member.user.qq);
  assert.equal((await f.identity.authenticate(f.request('/forms', 'GET', undefined, member), { required: true })).user.id, member.user.id);
  await rejects(f.call('/admin/users', 'GET', undefined, member), 'STAFF_REQUIRED', 403);
  await rejects(f.call('/auth/register', 'POST', { qq: '10000222', nickname: 'Other', password: MEMBER_PASSWORD }), 'QQ_ALREADY_REGISTERED', 409);
});

test('password bounds and QQ validation reject malformed input before registration', async () => {
  const f = fixture();
  for (const password of ['short', 'a'.repeat(257)]) await rejects(f.call('/auth/register', 'POST', { qq: '10000333', nickname: 'Member', password }), 'PASSWORD_POLICY', 400);
  await rejects(f.call('/auth/register', 'POST', { qq: '1234@qq.com', nickname: 'Member', password: MEMBER_PASSWORD }), 'INVALID_QQ', 400);
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
  assert.equal(updated.user.role, 'user'); assert.equal(updated.user.emailVerified, false);
  await rejects(f.call('/auth/profile', 'POST', { nickname: 'Stale', revision: member.user.revision }, member), 'REVISION_CONFLICT', 409);
});

test('promotion revokes sessions; admin authority works without mandatory TOTP while optional TOTP is enforced when enabled', async () => {
  const f = fixture(), owner = await f.owner(), member = await f.member();
  const promoted = await f.call(`/admin/users/${member.user.id}`, 'POST', { revision: member.user.revision, role: 'admin' }, owner);
  assert.equal(promoted.user.role, 'admin');
  await rejects(f.call('/auth/session', 'GET', undefined, member), 'TOKEN_INVALID', 401);
  const directAdmin = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD });
  assert.equal(directAdmin.enrollmentRequired, false);
  assert.equal((await f.identity.authenticate(f.request('/admin/forms', 'GET', undefined, directAdmin), { staff: true })).user.role, 'admin');
  assert.ok((await f.call('/admin/users', 'GET', undefined, directAdmin)).items);
  const setup = await f.call('/auth/totp/setup', 'POST', { password: MEMBER_PASSWORD }, directAdmin);
  await f.call('/auth/totp/confirm', 'POST', { code: f.factor(setup.secret) }, directAdmin);
  const mfaAdmin = { ...directAdmin, ...(await f.call('/auth/session', 'GET', undefined, directAdmin)), cookie: directAdmin.cookie };
  assert.equal((await f.identity.authenticate(f.request('/admin/forms', 'GET', undefined, mfaAdmin), { staff: true })).user.role, 'admin');
  await rejects(f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD }), 'MFA_REQUIRED', 401);
  f.advance();
  const disableCode = f.factor(setup.secret);
  await f.call('/auth/totp/disable', 'POST', { password: MEMBER_PASSWORD, code: disableCode }, mfaAdmin);
  const afterDisable = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD });
  assert.equal(afterDisable.user.totpEnabled, false);
  await f.call(`/admin/users/${member.user.id}`, 'POST', { revision: afterDisable.user.revision, status: 'disabled' }, owner);
  await rejects(f.call('/auth/session', 'GET', undefined, afterDisable), 'TOKEN_INVALID', 401);
  await rejects(f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD }), 'LOGIN_FAILED', 401);
});

test('shared campus client can register multiple accounts and spoofed IP headers do not bypass account limits', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) {
    const created = await f.call('/auth/register', 'POST', { qq: String(10001000 + i), nickname: 'Campus member', password: MEMBER_PASSWORD });
    assert.equal(created.status, 201);
  }
  await f.call('/auth/register', 'POST', { qq: '10002000', nickname: '同学', password: MEMBER_PASSWORD });
  for (let i = 0; i < 2; i++) {
    await rejects(f.call('/auth/register', 'POST', { qq: '10002000', nickname: 'Member', password: 'incorrect-password-123' }, undefined, { 'X-Forwarded-For': `192.0.2.${i}`, 'CF-Connecting-IP': `192.0.2.${i}` }), 'QQ_ALREADY_REGISTERED', 409);
  }
  await rejects(f.call('/auth/register', 'POST', { qq: '10002000', nickname: 'Member', password: MEMBER_PASSWORD }, undefined, { 'X-Forwarded-For': '192.0.2.99' }), 'RATE_LIMITED', 429);
  for (let i = 0; i < 10; i++) {
    await rejects(f.call('/auth/login', 'POST', { studentId: 'STU10001000', password: 'wrong' }, undefined, { 'X-Real-IP': `192.0.2.${i}` }), 'LOGIN_FAILED', 401);
  }
  await rejects(f.call('/auth/login', 'POST', { studentId: 'STU10001000', password: MEMBER_PASSWORD }, undefined, { 'X-Real-IP': '192.0.2.200' }), 'RATE_LIMITED', 429);
});

test('last owner cannot be disabled, downgraded, or created through role editing', async () => {
  const f = fixture(), owner = await f.owner(), member = await f.member();
  await rejects(f.call(`/admin/users/${owner.user.id}`, 'POST', { revision: owner.user.revision, role: 'user' }, owner), 'LAST_OWNER_PROTECTED', 403);
  await rejects(f.call(`/admin/users/${owner.user.id}`, 'POST', { revision: owner.user.revision, status: 'disabled' }, owner), 'LAST_OWNER_PROTECTED', 403);
  await rejects(f.call(`/admin/users/${member.user.id}`, 'POST', { revision: member.user.revision, role: 'owner' }, owner), 'OWNER_PROVISIONING_REQUIRED', 403);
});

test('controlled password reset revokes sessions and forces change before user business access', async () => {
  const f = fixture(), owner = await f.owner(), member = await f.member();
  const temporary = 'synthetic-reset-password-123';
  await f.call(`/admin/users/${member.user.id}/reset-password`, 'POST', { password: temporary }, owner);
  await rejects(f.call('/auth/session', 'GET', undefined, member), 'TOKEN_INVALID', 401);
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
  await rejects(f.call('/auth/session', 'GET', undefined, member), 'TOKEN_INVALID', 401);
  const relogin = await f.call('/auth/login', 'POST', { studentId: member.user.studentId, password: MEMBER_PASSWORD });
  const forged = { ...relogin, cookie: relogin.cookie.slice(0, -1) + (relogin.cookie.endsWith('a') ? 'b' : 'a') };
  await rejects(f.call('/auth/session', 'GET', undefined, forged), 'TOKEN_INVALID', 401);
  f.advance(7200001);
  await rejects(f.call('/auth/session', 'GET', undefined, relogin), 'TOKEN_INVALID', 401);
});

test('registration remains open without a registration hash', async () => {
  const f = fixture(); f.env.PLATFORM_REGISTRATION_HASH = '';
  assert.equal((await f.call('/auth/config')).registrationEnabled, true);
  assert.equal((await f.member()).user.role, 'user');
});

test('student IDs normalize NFKC, trim and case while real names allow duplicates but reject controls', () => {
  assert.equal(normalizeStudentId('  ａｂ１２３４  '), 'AB1234');
  assert.equal(normalizeStudentId('ABCDEFGHIJ1234567890'), 'ABCDEFGHIJ1234567890');
  for (const value of ['abc12', 'A'.repeat(21), '12 3456', '123456@qq.com', undefined]) assert.throws(() => normalizeStudentId(value), (error) => error.code === 'INVALID_STUDENT_ID');
  assert.equal(normalizeRealName('  合成测试甲  '), '合成测试甲');
  for (const value of ['', ' ', 'a'.repeat(41), '测试\n甲', '测试\t甲', '\u200b姓名', '甲\u2028乙', undefined]) assert.throws(() => normalizeRealName(value), (error) => error.code === 'INVALID_REAL_NAME');
});

test('registration requires student ID and real name, requires an explicit nickname, and ignores verification claims', async () => {
  const f = fixture();
  await rejects(f.call('/auth/register', 'POST', { qq: '10003001', password: MEMBER_PASSWORD, studentId: undefined }), 'INVALID_STUDENT_ID', 400);
  await rejects(f.call('/auth/register', 'POST', { qq: '10003002', password: MEMBER_PASSWORD, realName: undefined }), 'INVALID_REAL_NAME', 400);
  const registered = await f.call('/auth/register', 'POST', { qq: '10003003', password: MEMBER_PASSWORD, studentId: '  ａｂ１２３４  ', realName: '合成测试甲', identityVerified: true, role: 'owner' });
  assert.equal(registered.user.studentId, 'AB1234'); assert.equal(registered.user.realName, '合成测试甲');
  assert.equal(registered.user.nickname, '测试昵称'); assert.equal(registered.user.profileComplete, true);
  assert.equal(registered.user.identityVerified, false); assert.equal(registered.user.role, 'user');
});

test('student ID is unique across case and Unicode aliases while same names and separate QQ accounts are allowed', async () => {
  const f = fixture();
  const first = await f.call('/auth/register', 'POST', { qq: '10003101', studentId: 'ab123456', realName: '同名合成成员', password: MEMBER_PASSWORD });
  await rejects(f.call('/auth/register', 'POST', { qq: '10003102', studentId: 'ＡＢ１２３４５６', realName: '另一合成成员', password: MEMBER_PASSWORD }), 'STUDENT_ID_ALREADY_REGISTERED', 409);
  const second = await f.call('/auth/register', 'POST', { qq: '10003103', studentId: 'ab654321', realName: '同名合成成员', password: MEMBER_PASSWORD });
  assert.equal(first.user.realName, second.user.realName); assert.notEqual(first.user.id, second.user.id);
  await rejects(f.call('/auth/register', 'POST', { qq: '10003101', studentId: 'AB999999', realName: '同名合成成员', password: MEMBER_PASSWORD }), 'QQ_ALREADY_REGISTERED', 409);
});

test('concurrent accounts racing for one normalized student ID create only one usable account', async () => {
  const f = fixture();
  const attempts = await Promise.allSettled(['10003201', '10003202'].map((qq, i) => f.call('/auth/register', 'POST', { qq, studentId: i ? 'race1234' : 'RACE1234', realName: '并发合成成员', password: MEMBER_PASSWORD })));
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
    const body = { qq: '10003301', studentId: 'RESUME01', realName: '恢复合成成员', password: MEMBER_PASSWORD };
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
  const body = { qq: '10003401', studentId: 'RESUME02', realName: '恢复合成成员', password: MEMBER_PASSWORD };
  await assert.rejects(f.call('/auth/register', 'POST', body), /Synthetic loss/);
  await rejects(f.call('/auth/register', 'POST', { ...body, password: 'different-synthetic-password-123' }), 'REGISTRATION_PENDING', 409);
  await rejects(f.call('/auth/register', 'POST', { ...body, studentId: 'RESUME03' }), 'REGISTRATION_PENDING', 409);
  assert.equal(await f.repo.get('identity/student/RESUME03.json'), null);
});

test('bound identities cannot be self-edited or self-verified while nickname remains editable', async () => {
  const f = fixture(), member = await f.member();
  await rejects(f.call('/auth/profile', 'POST', { studentId: 'OTHER123', revision: member.user.revision }, member), 'IDENTITY_LOCKED', 403);
  await rejects(f.call('/auth/profile', 'POST', { realName: '更改合成姓名', revision: member.user.revision }, member), 'IDENTITY_LOCKED', 403);
  const updated = await f.call('/auth/profile', 'POST', { nickname: '新的合成昵称', identityVerified: true, revision: member.user.revision }, member);
  assert.equal(updated.user.nickname, '新的合成昵称'); assert.equal(updated.user.realName, member.user.realName);
  assert.equal(updated.user.identityVerified, false);
});

test('normal login accepts only normalized student ID and independently checks the index against the stored account', async () => {
  const f = fixture(), member = await f.member();
  const login = await f.call('/auth/login', 'POST', { studentId: `  ${member.user.studentId.toLowerCase()}  `, password: MEMBER_PASSWORD });
  assert.equal(login.user.id, member.user.id); assert.equal(login.profileRequired, false);
  await rejects(f.call('/auth/login', 'POST', { qq: member.user.qq, password: MEMBER_PASSWORD }), 'INVALID_STUDENT_ID', 400);
  await rejects(f.call('/auth/login', 'POST', { studentId: member.user.studentId, qq: member.user.qq, password: MEMBER_PASSWORD }), 'INVALID_STUDENT_ID', 400);
  f.values.set('platform-v1/identity/student/OTHERID01.json', { id: member.user.id });
  await rejects(f.call('/auth/login', 'POST', { studentId: 'OTHERID01', password: MEMBER_PASSWORD }), 'LOGIN_FAILED', 401);
});

test('pre-recorded staff use managed password and status operations to activate, then must change the temporary password', async () => {
  const f = fixture(), owner = await f.owner();
  const seeded = await f.call('/admin/users', 'POST', { studentId: 'STAFF00001', realName: '预录管理员', qq: '10009999', role: 'admin' }, owner);
  assert.equal(seeded.user.status, 'pending');
  await rejects(f.call('/auth/register', 'POST', { studentId: 'STAFF00001', realName: '预录管理员', qq: '10009999', nickname: '有人', password: MEMBER_PASSWORD }), 'ACCOUNT_PENDING_REVIEW', 409);
  await f.call(`/admin/users/${seeded.user.id}/reset-password`, 'POST', { password: MEMBER_PASSWORD }, owner);
  const latest = await f.call(`/admin/users/${seeded.user.id}`, 'GET', undefined, owner);
  await f.call(`/admin/users/${seeded.user.id}`, 'POST', { revision: latest.user.revision, status: 'active' }, owner);
  const login = await f.call('/auth/login', 'POST', { studentId: 'STAFF00001', password: MEMBER_PASSWORD });
  assert.equal(login.user.role, 'admin'); assert.equal(login.passwordChangeRequired, true);
  await rejects(f.identity.authenticate(f.request('/admin/forms', 'GET', undefined, login), { staff: true }), 'AUTH_SETUP_REQUIRED', 403);
});
