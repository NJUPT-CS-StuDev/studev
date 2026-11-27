import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformHandler } from '../server/app.mjs';
import { createRepository } from '../server/store.mjs';
import { publishRosterPerson } from '../server/roster.mjs';
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
  assert.match(cookieToken, /^[A-Za-z0-9_-]{120,400}\.[A-Za-z0-9_-]{43}$/);
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

test('current and historical rosters query the same dated appointments without revealing private account data', async () => {
  const f = await fixture();
  const source = await f.repo.latest('identity/users/' + f.user.id);
  const memberships = [
    { organizationId: 'student-development/media', title: '副部长', order: 0, startsOn: '2025-09-01', endsBefore: '2026-07-01' },
    { organizationId: 'student-development/media', title: '部员', order: 1, startsOn: '2026-08-31', endsBefore: '2026-10-31' },
    { organizationId: 'student-development/media', title: '部长', order: 2, startsOn: '2026-10-31', endsBefore: '2027-07-05' },
    { organizationId: 'student-development/operations', title: '部员', order: 3, startsOn: '2026-11-01', endsBefore: '2027-07-05' },
    { organizationId: 'student-development/operations', title: '部长', order: 4, startsOn: '2027-08-30', endsBefore: '2028-07-03' },
    { organizationId: 'class:B240402', title: '班长' },
  ];
  const current = await f.repo.append('identity/users/' + source.id, { ...source, memberships }, source.revision);
  await publishRosterPerson(f.repo, current, source);
  const reads = [];
  const read = f.store.get;
  f.store.get = (key, ...args) => { reads.push(key); return read(key, ...args); };
  const today = (await f.app('/public/roster')).body;
  assert.equal(today.view, 'today');
  assert.equal(today.today, '2026-10-31');
  assert.equal(today.year, '2026-2027');
  assert.deepEqual(today.years, ['2026-2027', '2025-2026']);
  assert.equal(today.totalCount, 1);
  assert.deepEqual(today.groups.map(group => [group.name, group.people.map(person => person.role)]), [['媒体宣传部', ['部长']]]);
  const person = today.groups[0].people[0];
  assert.equal(person.name, source.realName);
  assert.equal(person.avatarUrl, f.env.PLATFORM_ORIGIN + '/api/platform/members/' + source.id + '/avatar');
  assert.deepEqual(Object.keys(person).sort(), ['avatarUrl', 'endsBefore', 'featured', 'id', 'name', 'nickname', 'role', 'signature', 'startsOn']);
  const thisYear = (await f.app('/public/roster?year=2026-2027')).body;
  assert.equal(thisYear.view, 'year');
  assert.equal(thisYear.totalCount, 1, 'one person can hold several distinct appointments');
  assert.deepEqual(thisYear.groups.map(group => [group.name, group.people.map(person => person.role)]), [
    ['媒体宣传部', ['部员', '部长']],
  ]);
  const future = (await f.app('/public/roster?year=2027-2028')).body;
  assert.deepEqual(future.groups, []);
  assert.deepEqual(future.years, ['2026-2027', '2025-2026']);
  const past = (await f.app('/public/roster?year=2025-2026')).body;
  assert.equal(past.groups[0].people[0].role, '副部长');
  assert.deepEqual(past.groups[0].people[0].startsOn, '2025-09-01');
  for (const value of [source.studentId, source.qq, 'passwordHash', 'securityVersion']) {
    assert.ok(!JSON.stringify([today, thisYear, past]).includes(value));
  }
  assert.ok(reads.length > 0 && reads.every(key => /^platform-v1\/(roster\/people|organizations\/tree)/.test(key)), 'public roster only reads public projections and the organization tree');
  assert.equal((await f.app('/public/roster?year=2026-2029')).status, 400);
  assert.deepEqual((await f.browser.call('/auth/session')).body.user.memberships.map(row => row.title), ['部长', '班长']);
  f.advance(24 * 3600000);
  const tomorrow = (await f.app('/public/roster')).body;
  assert.equal(tomorrow.today, '2026-11-01');
  assert.equal(tomorrow.groups.length, 2, 'crossing midnight requires no write or snapshot regeneration');
  const yearAfterStart = (await f.app('/public/roster?year=2026-2027')).body;
  assert.deepEqual(yearAfterStart.groups[0].people.map(person => person.role), ['部员']);
});

test('the public projection includes pending appointments, removes disabled users and ignores delayed earlier writes', async () => {
  const f = await fixture();
  const source = await f.repo.latest('identity/users/' + f.user.id);
  const former = { ...source, status: 'pending', memberships: [
    { organizationId: 'student-development/yiban', title: '部长', startsOn: '2026-08-31', endsBefore: '2027-07-05' },
  ] };
  const staff = await f.repo.append('identity/users/' + source.id, former, source.revision);
  await publishRosterPerson(f.repo, staff, source);
  const before = (await f.app('/public/roster')).body;
  assert.equal(before.totalCount, 1);
  assert.equal(before.activeCount, 0);
  const disabled = await f.repo.append('identity/users/' + source.id, { ...staff, status: 'disabled' }, staff.revision);
  await publishRosterPerson(f.repo, disabled, staff);
  await publishRosterPerson(f.repo, staff, source);
  const after = (await f.app('/public/roster')).body;
  assert.equal(after.totalCount, 0);
  assert.deepEqual((await f.app('/public/roster?year=2026-2027')).body.groups, []);
});

test('published appointment correction can recover from an interrupted projection write without making duplicates', async () => {
  const f = await fixture();
  const source = await f.repo.latest('identity/users/' + f.user.id);
  const revision = { ...source, revision: source.revision + 1, memberships: [
    { organizationId: 'student-development/media', title: '部长', startsOn: '2026-08-31', endsBefore: '2027-07-05' },
  ] };
  await assert.rejects(publishRosterPerson({
    ...f.repo, putNew: async () => { throw Error('Simulated interruption'); },
  }, revision, source), /interruption/);
  await publishRosterPerson(f.repo, { ...revision, revision: revision.revision + 1 }, revision);
  assert.equal((await f.app('/public/roster')).body.totalCount, 1);
  await publishRosterPerson(f.repo, { ...revision, revision: revision.revision + 2 }, revision);
  assert.equal((await f.repo.list('roster/people/')).length, 1);
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
