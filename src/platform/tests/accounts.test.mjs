import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformHandler } from '../server/app.mjs';
import { createRepository } from '../server/store.mjs';
import { buildRosterSnapshot, ROSTER_SCHEMA } from '../server/roster.mjs';
import { migrateOrganizations } from '../../../scripts/server/migrate-organizations.mjs';
import { memoryBlob, memoryGateway, requestClient, testEnvironment } from './fixtures.mjs';

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
  assert.equal(cookies.split('; ').length, 1);
  const cookieToken = cookies.split('; ').find(c => c.startsWith('__Host-studev_platform=')).split('=')[1];
  assert.match(cookieToken, /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
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

test('public roster lists everyone holding a position, by real name, never with student ID or QQ; admin alone is not a position', async () => {
  const f = await fixture(), source = await f.repo.latest(`identity/users/${f.user.id}`);
  const ordinary = { ...source, memberships: [{ organizationId: 'student-development', title: '主席', order: 0 }], signature: '保密签名' };
  await f.repo.append(`identity/users/${f.user.id}`, ordinary, source.revision);
  const snapshot = buildRosterSnapshot([
    ordinary,
    { ...ordinary, id: '00000000-0000-0000-0000-000000000002', role: 'admin', realName: '公开管理员', nickname: '管理员', signature: '公开签名', qq: '10000903', studentId: 'ADMIN00002' },
    { ...ordinary, id: '00000000-0000-0000-0000-000000000099', role: 'admin', memberships: [], realName: '未分配管理员', nickname: '未分配', qq: '10000909', studentId: 'ADMIN00009' },
  ], '2026-2027', new Date().toISOString(), f.env.PLATFORM_ORIGIN);
  assert.equal(snapshot.totalCount, 2);
  assert.deepEqual(snapshot.groups[0].people.map(person => person.name).sort(), [ordinary.realName, '公开管理员'].sort());
  assert.deepEqual(Object.keys(snapshot.groups[0].people[0]).sort(), ['avatarUrl', 'featured', 'id', 'name', 'nickname', 'role', 'signature']);
  for (const value of ['未分配管理员', '10000903', 'ADMIN00002', '10000909', ordinary.studentId, ordinary.qq]) assert.equal(JSON.stringify(snapshot).includes(value), false);
  await f.repo.put('roster/2026-2027.json', snapshot);
  const result = await f.app('/public/roster');
  assert.ok(JSON.stringify(result.body).includes(ordinary.realName));
  for (const value of [ordinary.studentId, ordinary.qq]) assert.ok(!JSON.stringify(result.body).includes(value));
  const selfEdit = await f.browser.call('/auth/profile', { method: 'POST', body: { revision: source.revision + 1, nickname: '', role: 'admin' } });
  assert.equal(selfEdit.status, 200);
  assert.equal(selfEdit.body.user.role, 'user');
  assert.equal(selfEdit.body.user.nickname, '名');
});

test('old roster snapshots rebuild from existing private identities, never initialize or reseed accounts', async () => {
  const f = await fixture(), source = await f.repo.latest('identity/users/' + f.user.id);
  const id = '00000000-0000-0000-0000-000000000003';
  const staff = { ...source, id, role: 'admin', status: 'pending', studentId: 'PRIVATESTAFF', realName: '内部真姓名', qq: '10000904', nickname: '',
    memberships: [{ organizationId: 'student-development/media', title: '部长' }], signature: '一起成长' };
  await f.repo.append('identity/users/' + id, staff);
  await f.repo.putNew('identity/qq/' + staff.qq + '.json', { id });
  await f.repo.put('roster/2026-2027.json', { schema: 5, groups: [{name:'媒体宣传部', people:[{name:staff.realName, studentId:staff.studentId, avatarUrl:'https://q1.qlogo.cn/g?nk=' + staff.qq}]}] });
  const existingUsers = await f.repo.list('identity/users/');
  const result = await f.app('/public/roster');
  assert.equal(result.status, 200); assert.equal(result.body.schema, ROSTER_SCHEMA);
  assert.equal(result.body.totalCount, 1); assert.equal(result.body.activeCount, 0);
  const person = result.body.groups[0].people[0];
  assert.equal(person.id, id); assert.equal(person.name, staff.realName); assert.equal(person.nickname, '名'); assert.equal(person.role, '部长'); assert.equal(person.signature, '一起成长');
  assert.equal(person.avatarUrl, f.env.PLATFORM_ORIGIN + '/api/platform/members/' + id + '/avatar');
  for (const value of [staff.studentId, staff.qq, 'passwordHash', 'securityVersion']) assert.equal(JSON.stringify(result.body).includes(value), false);
  assert.deepEqual(await f.repo.list('identity/users/'), existingUsers, 'reading a roster never creates or changes accounts');
  const read = f.store.get, keys = [];
  f.store.get = async (key, ...args) => { keys.push(key); return read(key, ...args); };
  const again = await f.app('/public/roster'); assert.deepEqual(again.body, result.body);
  assert.deepEqual(keys, ['platform-v1/roster/archives/2026-2027.json', 'platform-v1/roster/2026-2027.json']);
});

test('organization migration seals old appointments and reruns without another account revision', async () => {
  const f = await fixture();
  const key = 'identity/users/' + f.user.id;
  const source = await f.repo.latest(key);
  const { memberships, ...previous } = source;
  const legacy = await f.repo.append(key, { ...previous, term: '2025-2026', department: '易班建设部', title: '易班建设部部长', order: 3 }, source.revision);
  const options = { origin: f.env.PLATFORM_ORIGIN, now: '2026-11-17T00:00:00.000Z' };
  const report = await migrateOrganizations(f.repo, options);
  assert.equal(report.historical, 1);
  assert.equal((await f.repo.latest(key)).revision, legacy.revision);
  const applied = await migrateOrganizations(f.repo, { ...options, apply: true });
  assert.equal(applied.archives, 1);
  const latest = await f.repo.latest(key);
  assert.deepEqual(latest.memberships, []);
  assert.equal(latest.term, undefined);
  assert.equal(latest.department, undefined);
  assert.equal(latest.role, legacy.role);
  const older = await f.app('/public/roster?term=2025-2026');
  assert.equal(older.status, 200);
  assert.equal(older.body.archivedAt, options.now);
  assert.equal(older.body.groups[0].people[0].role, '部长');
  assert.equal((await f.app('/public/roster')).body.totalCount, 0);
  assert.equal((await migrateOrganizations(f.repo, { ...options, apply: true })).revisions, 0);
});

test('even current roster snapshots expose only the public field projection and reconstruct opaque images', async () => {
  const f = await fixture(); const id = '00000000-0000-0000-0000-000000000004';
  const contaminated = { schema: ROSTER_SCHEMA, term: '2026-2027', updatedAt: '2026-11-17T00:00:00.000Z', totalCount: 1, activeCount: 1,
    name: '内部真姓名', studentId: 'PRIVATESTAFF', qq: '10000905',
    groups: [{ name: '媒体宣传部', realName: '内部真姓名', people: [{ id, nickname: '名', role: '部长', signature: '', featured: false,
      name: '内部真姓名', realName: '内部真姓名', studentId: 'PRIVATESTAFF', qq: '10000905', avatarUrl: 'https://q1.qlogo.cn/g?nk=10000905' }] }] };
  await f.repo.put('roster/2026-2027.json', contaminated);
  const result = await f.app('/public/roster'); assert.equal(result.status, 200);
  for (const value of ['PRIVATESTAFF', '10000905', 'qlogo']) assert.equal(JSON.stringify(result.body).includes(value), false);
  assert.equal(result.body.name, undefined); assert.equal(result.body.groups[0].realName, undefined);
  assert.deepEqual(Object.keys(result.body.groups[0].people[0]).sort(), ['avatarUrl', 'featured', 'id', 'name', 'nickname', 'role', 'signature']);
});

test('organization migration preserves oversight separately from a child appointment', async () => {
  const f = await fixture();
  const key = 'identity/users/' + f.user.id;
  const source = await f.repo.latest(key);
  await f.repo.append(key, { ...source, memberships: [
    { organizationId: 'student-development', department: '', title: '执行主席', responsibleDepartment: '运营支持部', order: 1 },
    { organizationId: 'class:B240402', department: '', title: '班长', responsibleDepartment: '', order: 2 },
  ] }, source.revision);
  const options = { origin: f.env.PLATFORM_ORIGIN, apply: true };
  assert.equal((await migrateOrganizations(f.repo, options)).revisions, 1);
  const latest = await f.repo.latest(key);
  assert.equal(latest.role, source.role);
  assert.deepEqual(latest.memberships, [
    { organizationId: 'student-development', title: '执行主席', overseesOrganizationId: 'student-development/operations', order: 1 },
    { organizationId: 'class:B240402', title: '班长', overseesOrganizationId: '', order: 2 },
  ]);
  assert.equal((await migrateOrganizations(f.repo, options)).revisions, 0);
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
