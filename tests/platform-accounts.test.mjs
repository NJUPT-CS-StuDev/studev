import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformHandler } from '../src/server/platform-app.mjs';
import { createRepository } from '../src/server/platform-store.mjs';
import { buildRosterSnapshot } from '../src/server/platform-roster.mjs';
import { migrateAccounts } from '../scripts/platform/migrate-accounts.mjs';
import { memoryBlob, memoryGateway, requestClient, testEnvironment } from './helpers/platform-fixtures.mjs';

const config = await testEnvironment();
async function fixture() {
  let clock = Date.UTC(2026, 9, 31);
  const store = memoryBlob(), repo = createRepository(store, { secret: config.env.PLATFORM_SESSION_SECRET, now: () => clock });
  const handle = createPlatformHandler({ getStore: () => store, getGateway: memoryGateway, now: () => clock });
  const browser = requestClient(handle, config.env);
  const registration = { studentId: 'STUDENT001', realName: '保密姓名', nickname: '风中的树', qq: '10000901', password: config.password };
  const registered = await browser.call('/auth/register', { method: 'POST', body: registration });
  assert.equal(registered.status, 201);
  const login = await browser.call('/auth/login', { method: 'POST', body: registrationCredentials() });
  assert.equal(login.status, 200);
  function registrationCredentials() { return { studentId: registration.studentId, password: registration.password }; }
  async function app(path, body, token) {
    const result = await handle({ env: config.env, clientIp: 'accounts-test', request: new Request(config.env.PLATFORM_ORIGIN + '/api/platform' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) });
    return { status: result.status, body: await result.json(), headers: result.headers };
  }
  const appLogin = (extra = {}) => app('/auth/login', { ...registrationCredentials(), deviceId: 'accounts-emulator-00001', deviceName: '测试 Android', ...extra });
  return { ...config, repo, store, browser, app, appLogin, registration, user: registered.body.user, login, advance: ms => clock += ms };
}

test('both carriers use one protocol, expiry, device list and revocation in both directions', async () => {
  const f = await fixture(), native = await f.appLogin();
  assert.equal(native.status, 200); assert.equal(native.headers.getSetCookie().length, 0);
  assert.equal(f.login.body.accessToken, undefined); assert.equal(f.login.body.refreshToken, undefined);
  const cookies = f.browser.cookie;
  assert.equal(cookies.split('; ').length, 2);
  const cookieToken = cookies.split('; ').find(c => c.startsWith('__Host-studev_platform=')).split('=')[1];
  assert.equal((await f.app('/auth/session', undefined, cookieToken)).status, 401);
  assert.equal((await f.browser.call('/auth/session', { headers: { Cookie: `__Host-studev_platform=${native.body.accessToken}` } })).status, 401);
  const webDevices = await f.browser.call('/auth/devices');
  const appDevices = await f.app('/auth/devices', undefined, native.body.accessToken);
  assert.equal(webDevices.body.items.length, 2); assert.equal(appDevices.body.items.length, 2);
  const web = webDevices.body.items.find(d => d.kind === 'cookie');
  assert.equal(web.current, true); assert.equal(appDevices.body.items.find(d => d.id === web.id).current, false);
  assert.equal((await f.app(`/auth/devices/${web.id}/revoke`, {}, native.body.accessToken)).status, 200);
  assert.equal((await f.browser.call('/auth/session')).status, 401);
  assert.equal((await f.browser.call('/auth/refresh', { method: 'POST', body: {} })).status, 401);
  await f.browser.call('/auth/login', { method: 'POST', body: { studentId: f.registration.studentId, password: f.password } });
  assert.equal((await f.browser.call(`/auth/devices/${native.body.deviceSessionId}/revoke`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.app('/auth/session', undefined, native.body.accessToken)).status, 401);
  assert.equal((await f.app('/auth/refresh', { deviceId: 'accounts-emulator-00001', refreshToken: native.body.refreshToken })).status, 401);
});

test('cookie refresh rotates once, shares absolute expiry, rejects replay and never exposes credentials to JavaScript', async () => {
  const f = await fixture();
  const native = await f.appLogin();
  const oldCookies = f.browser.cookie;
  f.advance(600_001);
  const expiredWeb = await f.browser.call('/auth/session'), expiredApp = await f.app('/auth/session', undefined, native.body.accessToken);
  assert.equal(expiredWeb.status, 401); assert.deepEqual(expiredWeb.body, expiredApp.body);
  const refreshed = await f.browser.call('/auth/refresh', { method: 'POST', body: {} });
  assert.equal(refreshed.status, 200); assert.equal(refreshed.body.accessToken, undefined); assert.equal(refreshed.body.refreshToken, undefined);
  assert.equal((await f.browser.call('/auth/session')).status, 200);
  assert.notEqual(oldCookies, f.browser.cookie);
  const replay = await f.browser.call('/auth/refresh', { method: 'POST', body: {}, headers: { Cookie: oldCookies } });
  assert.equal(replay.body.error.code, 'REFRESH_REPLAYED');
  assert.equal((await f.browser.call('/auth/session')).status, 401);
});

test('ordinary students cannot list, search, look up, change, reset or delete any account with either carrier', async () => {
  const f = await fixture(), native = await f.appLogin();
  for (const id of [f.user.id, '00000000-0000-0000-0000-000000000000']) {
    for (const [path, body] of [
      ['/admin/users'], ['/admin/users?studentId=STUDENT001'], [`/admin/users/${id}`],
      [`/admin/users/${id}`, { revision: f.user.revision, role: 'owner' }],
      [`/admin/users/${id}/reset-password`, { password: f.password }], [`/admin/users/${id}/reset-totp`, {}], [`/admin/users/${id}/delete`, {}],
      ['/admin/users', { studentId: 'NEWUSER01', realName: '测试', qq: '10000999' }], ['/admin/audit'],
    ]) {
      const web = await f.browser.call(path, { ...(body ? { method: 'POST', body } : {}) });
      const app = await f.app(path, body, native.body.accessToken);
      assert.equal(web.status, 403, path); assert.equal(app.status, 403, path);
      for (const response of [web, app]) {
        const serialized = JSON.stringify(response.body);
        for (const value of [f.registration.studentId, f.registration.realName, f.registration.qq, f.user.id]) assert.ok(!serialized.includes(value), path);
      }
    }
  }
});

test('admins may look up students and resolve identity disputes; roles and other admins remain owner-managed', async () => {
  const f = await fixture();
  const adminId = '00000000-0000-0000-0000-000000000001';
  const source = await f.repo.latest(`identity/users/${f.user.id}`);
  await f.repo.append(`identity/users/${adminId}`, { ...source, id: adminId, studentId: 'ADMIN00001', qq: '10000902', role: 'admin' });
  await f.repo.putNew('identity/student/ADMIN00001.json', { id: adminId });
  await f.repo.putNew('identity/qq/10000902.json', { id: adminId });
  const native = await f.appLogin({ studentId: 'ADMIN00001', deviceId: 'admin-emulator-00001' });
  assert.equal((await f.app('/admin/users', undefined, native.body.accessToken)).status, 200);
  assert.equal((await f.app(`/admin/users/${f.user.id}`, undefined, native.body.accessToken)).body.user.realName, f.registration.realName);
  const corrected = await f.app(`/admin/users/${f.user.id}`, { revision: f.user.revision, studentId: 'CORRECT001' }, native.body.accessToken);
  assert.equal(corrected.status, 200);
  assert.equal(await f.repo.get('identity/student/STUDENT001.json'), null);
  assert.equal((await f.repo.get('identity/student/CORRECT001.json')).id, f.user.id);
  assert.equal((await f.browser.call('/auth/session')).status, 401);
  assert.equal((await f.app(`/admin/users/${f.user.id}`, { revision: corrected.body.user.revision, role: 'admin' }, native.body.accessToken)).status, 403);
  assert.equal((await f.app(`/admin/users/${adminId}/reset-password`, { password: f.password }, native.body.accessToken)).status, 403);
});

test('public roster derives exclusively from admin/owner roles; forged roster fields on an ordinary user never publish their identity', async () => {
  const f = await fixture(), source = await f.repo.latest(`identity/users/${f.user.id}`);
  const ordinary = { ...source, term: '2026-2027', department: '主席团', title: '主席', signature: '保密签名', order: 0 };
  await f.repo.append(`identity/users/${f.user.id}`, ordinary, source.revision);
  const snapshot = buildRosterSnapshot([ordinary, { ...ordinary, id: 'staff', role: 'admin', realName: '公开管理员', nickname: '管理员', signature: '公开签名', qq: '10000903', studentId: 'ADMIN00002' }]);
  assert.equal(snapshot.totalCount, 1); assert.equal(snapshot.groups[0].people[0].name, '公开管理员');
  await f.repo.put('roster/2026-2027.json', snapshot);
  const result = await f.app('/public/roster');
  for (const value of [ordinary.realName, ordinary.studentId, ordinary.qq, ordinary.nickname, ordinary.signature]) assert.ok(!JSON.stringify(result.body).includes(value));
  const selfEdit = await f.browser.call('/auth/profile', { method: 'POST', body: { revision: source.revision + 1, nickname: '', role: 'admin' } });
  assert.equal(selfEdit.status, 400);
});

test('registration and login errors match for web/app; registering cannot claim a pre-recorded administrator', async () => {
  const f = await fixture();
  for (const input of [{ studentId: 'bad', password: f.password }, { studentId: 'UNKNOWN001', password: f.password }]) {
    const web = await f.browser.call('/auth/login', { method: 'POST', body: input });
    const app = await f.appLogin(input);
    assert.equal(web.status, app.status); assert.deepEqual(web.body, app.body);
  }
  const user = await f.repo.latest(`identity/users/${f.user.id}`);
  await f.repo.append(`identity/users/${user.id}`, { ...user, role: 'admin', status: 'pending' }, user.revision);
  for (const send of [body => f.browser.call('/auth/register', { method: 'POST', body }), body => f.app('/auth/register', body)]) {
    const result = await send(f.registration);
    assert.equal(result.status, 409); assert.equal(result.body.error.code, 'ACCOUNT_PENDING_REVIEW');
  }
  for (const path of ['/auth/token', '/auth/token/refresh', '/auth/legacy-profile-login', '/members', '/admin/legacy/submissions', '/admin/legacy/submissions/1793400000000-00000000-0000-4000-a000-000000000004/download']) {
    assert.equal((await f.app(path)).status, 404);
    assert.equal((await f.browser.call(path, { method: 'POST', body: {} })).status, 404);
  }
});

test('deployment migration is read-only by default, promotes every stored member, preserves identity and credentials, and is resumable', async () => {
  const f = await fixture(), source = await f.repo.latest(`identity/users/${f.user.id}`);
  await f.repo.append(`identity/users/${source.id}`, { ...source, role: 'member', term: '2026-2027', department: '运营支持部' }, source.revision);
  await f.repo.put('identity/sessions/old/current.json', { userId: source.id });
  await f.repo.put('identity/native/sessions/old.json', { userId: source.id });
  const before = [...f.store.values.entries()];
  assert.equal((await migrateAccounts(f.repo)).memberToAdmin, 1);
  assert.deepEqual([...f.store.values.entries()], before);
  const report = await migrateAccounts(f.repo, { apply: true }); assert.equal(report.applied, true);
  const current = await f.repo.latest(`identity/users/${source.id}`);
  for (const key of ['id', 'studentId', 'realName', 'qq', 'passwordHash', 'totp']) assert.deepEqual(current[key], source[key]);
  assert.equal(current.role, 'admin'); assert.equal((await f.repo.list('identity/native/')).length, 0); assert.equal((await f.repo.list('identity/sessions/')).length, 0);
  assert.equal((await f.repo.get('roster/2026-2027.json')).totalCount, 1);
  assert.equal((await migrateAccounts(f.repo, { apply: true })).memberToAdmin, 0);
  assert.equal((await f.repo.latest(`identity/users/${source.id}`)).revision, current.revision);
});

test('racing staff corrections reserve only one student identity for an account revision', async () => {
  const f = await fixture(), source = await f.repo.latest(`identity/users/${f.user.id}`);
  await f.repo.append(`identity/users/${source.id}`, { ...source, role: 'admin' }, source.revision);
  const auth = await f.appLogin();
  const created = await f.app('/auth/register', { ...f.registration, qq: '10000999', studentId: 'CORRECTOLD' });
  const target = created.body.user;
  const results = await Promise.all(['CORRECTA01', 'CORRECTB01'].map(studentId => f.app(`/admin/users/${target.id}`, { revision: target.revision, studentId }, auth.body.accessToken)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const user = await f.repo.latest(`identity/users/${target.id}`);
  const claims = [];
  for (const key of await f.repo.list('identity/student/')) if ((await f.repo.get(key)).id === target.id) claims.push(key);
  assert.deepEqual(claims, [`identity/student/${user.studentId}.json`]);
});
