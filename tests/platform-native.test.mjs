import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformHandler } from '../src/server/platform-app.mjs';
import { createRepository } from '../src/server/platform-store.mjs';
import { encryptTotp, totpCode } from '../src/server/platform-totp.mjs';
import { digest } from '../src/server/collection-auth.mjs';
import { memoryBlob, memoryGateway, requestClient, testEnvironment } from './helpers/platform-fixtures.mjs';

const config = await testEnvironment();
const deviceId = 'synthetic-device-000001';
async function fixture() {
  let clock = Date.UTC(2026, 9, 30);
  const store = memoryBlob(), gateway = memoryGateway(), env = config.env;
  const now = () => clock;
  const repo = createRepository(store, { now, secret: env.PLATFORM_SESSION_SECRET });
  const handle = createPlatformHandler({ getStore: () => store, getGateway: () => gateway, now, loadPlaces: async () => [{ id: '教3' }] });
  const browser = requestClient(handle, env);
  const registered = await browser.call('/auth/register', { method: 'POST', body: { qq: '100002', studentId: 'TEST100002', realName: '测试成员', password: config.password, inviteCode: config.inviteCode } });
  assert.equal(registered.status, 201);
  await browser.call('/auth/login', { method: 'POST', body: { studentId: 'TEST100002', password: config.password } });
  async function call(path, body, token, headers = {}, method = body === undefined ? 'GET' : 'POST') {
    const response = await handle({ request: new Request('https://studev.test/api/platform' + path, { method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, clientIp: 'native-test' });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  const login = (extra = {}) => call('/auth/token', { studentId: 'TEST100002', password: config.password, deviceId, deviceName: '测试手机', ...extra });
  const activity = (extra = {}) => ({ title: '校园散步', startsAt: new Date(clock + 3600000).toISOString(), endsAt: new Date(clock + 7200000).toISOString(), description: '图书馆门口集合', visibility: 'public', place: { kind: 'campus', id: '教3' }, ...extra });
  return { ...config, store, repo, browser, call, login, activity, user: registered.body.user, advance: (ms) => { clock += ms; }, now };
}

test('native tokens are opaque, hashed, device-bound, short-lived; cookie login stays cookie-only', async () => {
  const f = await fixture(), login = await f.login();
  assert.equal(login.status, 200); assert.equal(login.headers.get('set-cookie'), null);
  assert.equal(login.body.expiresIn, 600);
  const { accessToken, refreshToken } = login.body;
  const persisted = JSON.stringify([...f.store.values.entries()]);
  assert.ok(!persisted.includes(accessToken)); assert.ok(!persisted.includes(refreshToken)); assert.ok(!persisted.includes(deviceId));
  assert.equal((await f.call('/auth/session', undefined, accessToken)).body.user.id, f.user.id);
  assert.equal((await f.call('/auth/token/refresh', { refreshToken, deviceId: 'different-device-000001' })).status, 401);
  f.advance(600000);
  assert.equal((await f.call('/auth/session', undefined, accessToken)).status, 401);
  const refreshed = await f.call('/auth/token/refresh', { refreshToken, deviceId });
  assert.equal(refreshed.status, 200); assert.notEqual(refreshed.body.refreshToken, refreshToken);
  assert.equal((await f.browser.call('/auth/session')).status, 200);
  assert.equal((await f.call('/auth/token/refresh', { refreshToken, deviceId })).body.error.code, 'REFRESH_REPLAYED');
  assert.equal((await f.call('/auth/session', undefined, refreshed.body.accessToken)).status, 401);
});

test('racing refresh claims one immutable ticket and replay revokes the whole device', async () => {
  const f = await fixture(), { body } = await f.login();
  const results = await Promise.all([1, 2].map(() => f.call('/auth/token/refresh', { refreshToken: body.refreshToken, deviceId })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  assert.equal((await f.call('/auth/session', undefined, results.find((r) => r.status === 200).body.accessToken)).status, 401);
});

test('web device list exposes only safe metadata and revocation is owner-only and CSRF protected', async () => {
  const f = await fixture(), { body } = await f.login();
  const devices = await f.browser.call('/auth/devices');
  assert.deepEqual(Object.keys(devices.body.items[0]).sort(), ['createdAt', 'deviceName', 'expiresAt', 'id']);
  assert.equal(devices.body.items[0].id, body.deviceSessionId);
  const path = `/auth/devices/${body.deviceSessionId}/revoke`;
  assert.equal((await f.browser.call(path, { method: 'POST', body: {}, headers: { 'X-CSRF-Token': '' } })).status, 403);
  const other = await f.repo.append('identity/users/00000000-0000-0000-0000-000000000001', { ...f.user, id: '00000000-0000-0000-0000-000000000001', securityVersion: 'other', status: 'active' });
  const nativeKey = `platform-v1/identity/native/sessions/${body.deviceSessionId}.json`;
  const session = f.store.values.get(nativeKey);
  f.store.values.set(nativeKey, { ...session, userId: other.id });
  assert.equal((await f.browser.call(path, { method: 'POST', body: {} })).status, 404);
  f.store.values.set(nativeKey, session);
  assert.equal((await f.browser.call(path, { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.call('/auth/session', undefined, body.accessToken)).status, 401);
  assert.equal((await f.call('/auth/token/refresh', { deviceId, refreshToken: body.refreshToken })).status, 401);
});

test('TOTP and recovery verification, setup restrictions and account security invalidation apply to native login', async () => {
  const f = await fixture(), userKey = `identity/users/${f.user.id}`;
  const user = await f.repo.latest(userKey), secret = 'JBSWY3DPEHPK3PXP';
  await f.repo.append(userKey, { ...user, totp: { encrypted: encryptTotp(secret, f.env.PLATFORM_ENCRYPTION_KEY, user.id), epoch: 'synthetic-epoch', recoveryHashes: [] } }, user.revision);
  assert.equal((await f.login()).body.error.code, 'MFA_REQUIRED');
  assert.equal((await f.login({ totp: 'invalid' })).status, 401);
  const factor = totpCode(secret, Math.floor(f.now() / 30000));
  const login = await f.login({ totp: factor }); assert.equal(login.status, 200);
  assert.equal((await f.login({ totp: factor })).body.error.code, 'MFA_REPLAYED');
  const latest = await f.repo.latest(userKey);
  await f.repo.append(userKey, { ...latest, securityVersion: 'changed-by-password-reset' }, latest.revision);
  assert.equal((await f.call('/auth/session', undefined, login.body.accessToken)).status, 401);
  assert.equal((await f.call('/auth/token/refresh', { deviceId, refreshToken: login.body.refreshToken })).status, 401);
});

test('browser and native password attempts share account rate limits', async () => {
  const f = await fixture();
  for (let i = 0; i < 9; i++) assert.equal((await f.login({ password: 'wrong' })).status, 401);
  assert.equal((await f.browser.call('/auth/login', { method: 'POST', body: { studentId: 'TEST100002', password: f.password } })).status, 429);
});

test('every existing mutating endpoint still rejects cross-origin cookies, including spoofed bearer and native bootstrap', async () => {
  const f = await fixture(), id = '00000000-0000-0000-0000-000000000001';
  const paths = ['/auth/register', '/auth/login', '/auth/legacy-profile-login', '/auth/logout', '/auth/profile', '/auth/password', '/auth/totp/setup', '/auth/totp/confirm', '/auth/totp/disable', '/admin/roster/sync', '/admin/users', `/members/${id}/profile`, `/admin/users/${id}`, `/admin/users/${id}/reset-password`, `/admin/users/${id}/reset-totp`, `/admin/users/${id}/delete`, '/admin/forms', `/admin/forms/${id}`, `/admin/forms/${id}/delete`, `/admin/forms/${id}/duplicate`, `/forms/${id}/submissions`, `/submissions/${id}/complete`, `/submissions/${id}/edit`, `/submissions/${id}/review`, `/submissions/${id}/files/${id}/download`, `/admin/legacy/submissions/1234567890123-${id}/download`, '/auth/token', '/auth/token/refresh', `/auth/devices/${id}/revoke`, '/activities', `/activities/${id}`, `/activities/${id}/delete`];
  for (const path of paths) {
    for (const headers of [{ Origin: 'https://evil.invalid' }, { Origin: '' }, { Origin: 'https://studev.test', 'Sec-Fetch-Site': 'cross-site' }]) {
      const result = await f.browser.call(path, { method: 'POST', body: {}, headers });
      assert.equal(result.status, 403, path); assert.equal(result.body.error.code, 'ORIGIN_REJECTED', path);
    }
    const spoof = await f.browser.call(path, { method: 'POST', body: {}, headers: { Origin: 'https://evil.invalid', Authorization: 'Bearer invalid' } });
    assert.equal(spoof.status, 401, path);
  }
  for (const path of [`/admin/forms/${id}`, `/admin/users/${id}`, `/activities/${id}`]) {
    assert.equal((await f.browser.call(path, { method: 'DELETE', body: {}, headers: { Origin: 'https://evil.invalid' } })).status, 403);
  }
});

test('bearer requests keep role and identity checks while skipping Origin and CSRF for form and activity mutations', async () => {
  const f = await fixture(), { body } = await f.login(), token = body.accessToken;
  assert.equal((await f.call('/admin/forms', { title: 'forbidden' }, token)).status, 403);
  const created = await f.call('/activities', f.activity(), token);
  assert.equal(created.status, 201);
  assert.equal((await f.call('/auth/logout', {}, token)).status, 200);
  assert.equal((await f.call('/activities', f.activity(), token)).status, 401);
});

test('activities support public read, unlisted links, owner revisions, deletion and upcoming list', async () => {
  const f = await fixture(), { body } = await f.login(), token = body.accessToken;
  const created = await f.call('/activities', f.activity({ organiser: { id: 'forged' } }), token);
  assert.equal(created.status, 201); const activity = created.body.activity;
  assert.equal(activity.organiser.id, f.user.id);
  assert.equal((await f.call(`/activities/${activity.id}`)).body.activity.title, '校园散步');
  assert.equal((await f.call('/activities')).body.items.length, 1);
  assert.equal((await f.call('/me/activities', undefined, token)).body.items.length, 1);
  const changed = await f.call(`/activities/${activity.id}`, { ...f.activity({ visibility: 'unlisted', place: { kind: 'point', name: '集合点', position: [118.926, 32.114] } }), revision: activity.revision }, token);
  assert.equal(changed.status, 200); assert.equal((await f.call('/activities')).body.items.length, 0);
  assert.equal((await f.call(`/activities/${activity.id}`)).status, 200);
  assert.equal((await f.call(`/activities/${activity.id}`, { ...f.activity(), revision: 1 }, token)).status, 409);
  assert.equal((await f.call(`/activities/${activity.id}/delete`, { revision: changed.body.activity.revision }, token)).status, 200);
  assert.equal((await f.call(`/activities/${activity.id}`)).status, 404);
  assert.equal((await f.call('/me/activities', undefined, token)).body.items.length, 0);
});

test('activity validation rejects unknown places, malformed dates, excessive text and bodies; cookie writes require CSRF', async () => {
  const f = await fixture(), { body } = await f.login(), token = body.accessToken;
  for (const changes of [{ title: '' }, { title: 'a'.repeat(81) }, { description: 'a'.repeat(2001) }, { startsAt: '2026-01-01' }, { endsAt: '2020-01-01T00:00:00Z' }, { visibility: 'private' }, { place: { kind: 'campus', id: 'imaginary' } }, { place: { kind: 'point', name: 'x', position: [181, 0] } }, { place: { kind: 'point', name: '', position: [118, 32] } }]) {
    assert.equal((await f.call('/activities', f.activity(changes), token)).status, 400, JSON.stringify(changes).slice(0, 100));
  }
  assert.equal((await f.call('/activities', f.activity({ description: 'a'.repeat(13000) }), token)).status, 413);
  assert.equal((await f.browser.call('/activities', { method: 'POST', body: f.activity(), headers: { 'X-CSRF-Token': '' } })).status, 403);
});

test('bearer form authorization, submission and downloads use the unchanged form service', async () => {
  const f = await fixture(), key = `identity/users/${f.user.id}`, user = await f.repo.latest(key);
  await f.repo.append(key, { ...user, role: 'admin', securityVersion: 'promoted' }, user.revision);
  const { body: auth } = await f.login();
  const form = await f.call('/admin/forms', { title: 'App 填写', status: 'published', access: 'members', fields: [{ id: 'note', type: 'text', label: '说明', required: true }] }, auth.accessToken);
  assert.equal(form.status, 201);
  const submitted = await f.call(`/forms/${form.body.form.id}/submissions`, { answers: { note: '原生客户端提交' }, files: [] }, auth.accessToken);
  assert.equal(submitted.status, 201);
  const completed = await f.call(`/submissions/${submitted.body.submission.id}/complete`, { receiptToken: submitted.body.receiptToken }, auth.accessToken);
  assert.equal(completed.status, 200);
  assert.equal((await f.call('/me/submissions', undefined, auth.accessToken)).body.items.length, 1);
  assert.equal((await f.call(`/admin/forms/${form.body.form.id}/delete`, {}, auth.accessToken)).status, 403);
});

test('activity writes isolate owners and reject concurrent stale revisions; expired activities disappear', async () => {
  const f = await fixture(), { body: auth } = await f.login();
  const activity = (await f.call('/activities', f.activity(), auth.accessToken)).body.activity;
  const registered = await f.call('/auth/register', { qq: '100003', studentId: 'TEST100003', realName: '其他成员', password: f.password, inviteCode: f.inviteCode }, undefined, { Origin: f.env.PLATFORM_ORIGIN });
  assert.equal(registered.status, 201);
  const other = await f.login({ studentId: 'TEST100003', deviceId: 'other-device-00000001' });
  for (const path of [`/activities/${activity.id}`, `/activities/${activity.id}/delete`]) assert.equal((await f.call(path, { ...f.activity(), revision: activity.revision }, other.body.accessToken)).status, 404);
  const attempts = await Promise.all([1, 2].map(i => f.call(`/activities/${activity.id}`, { ...f.activity({ title: `活动 ${i}` }), revision: activity.revision }, auth.accessToken)));
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
  f.advance(7200001);
  assert.equal((await f.call('/activities')).body.items.length, 0);
  assert.equal((await f.call(`/activities/${activity.id}`)).status, 200);
});

test('native recovery codes remain single-use, setup gates mint no credentials, and device re-login replaces its old family', async () => {
  const f = await fixture(), key = `identity/users/${f.user.id}`, user = await f.repo.latest(key);
  const old = await f.login(), fresh = await f.login();
  assert.equal((await f.call('/auth/session', undefined, old.body.accessToken)).status, 401);
  assert.equal((await f.browser.call('/auth/devices')).body.items.length, 1);
  const secret = 'JBSWY3DPEHPK3PXP', recovery = 'TEST-RECOVERY-CODE';
  const totp = { encrypted: encryptTotp(secret, f.env.PLATFORM_ENCRYPTION_KEY, user.id), epoch: 'recovery-test', recoveryHashes: [digest(`${user.id}:${recovery}`)] };
  const secured = await f.repo.append(key, { ...user, totp }, user.revision);
  assert.equal((await f.login({ totp: recovery })).status, 200);
  assert.equal((await f.login({ totp: recovery })).body.error.code, 'MFA_REPLAYED');
  await f.repo.append(key, { ...secured, totp: null, mustChangePassword: true }, secured.revision);
  const limited = await f.login(); assert.equal(limited.status, 403); assert.equal(limited.body.error.code, 'AUTH_SETUP_REQUIRED'); assert.equal(limited.body.accessToken, undefined);
  f.advance(31 * 86400000);
  assert.equal((await f.call('/auth/token/refresh', { deviceId, refreshToken: fresh.body.refreshToken })).status, 401);
});

test('refresh endpoint rate limit ignores spoofed forwarding headers', async () => {
  const f = await fixture();
  for (let i = 0; i < 60; i++) assert.equal((await f.call('/auth/token/refresh', {}, undefined, { 'X-Forwarded-For': `192.0.2.${i}` })).status, 400);
  assert.equal((await f.call('/auth/token/refresh', {}, undefined, { 'X-Forwarded-For': '192.0.2.99' })).status, 429);
});

test('overlapping logins from one installation cannot leave two usable device families', async () => {
  const f = await fixture();
  // Both login requests observe the same device list before either publishes.
  const list = f.store.list;
  let arrivals = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  f.store.list = async (options) => {
    const result = await list(options);
    if (options.prefix === `platform-v1/identity/native/by-user/${f.user.id}/`) {
      if (++arrivals === 2) release();
      await ready;
    }
    return result;
  };
  const attempts = await Promise.all([f.login(), f.login()]);
  f.store.list = list;
  const issued = attempts.filter(r => r.status === 200);
  assert.ok(issued.length >= 1);
  const usable = await Promise.all(issued.map(r => f.call('/auth/session', undefined, r.body.accessToken)));
  assert.equal(usable.filter(r => r.status === 200).length, 1);
  assert.equal((await f.browser.call('/auth/devices')).body.items.length, 1);
  for (let i = 0; i < issued.length; i++) {
    if (usable[i].status !== 200) assert.equal((await f.call('/auth/token/refresh', { deviceId, refreshToken: issued[i].body.refreshToken })).status, 401);
  }
});

test('native TOTP enrollment preserves only its own family and subsequent security changes invalidate it', async () => {
  const f = await fixture(), { body: auth } = await f.login();
  const other = await f.login({ deviceId: 'other-installation-000001' });
  const setup = await f.call('/auth/totp/setup', { password: f.password }, auth.accessToken);
  assert.equal(setup.status, 200);
  const confirmed = await f.call('/auth/totp/confirm', { code: totpCode(setup.body.secret, Math.floor(f.now() / 30000)) }, auth.accessToken);
  assert.equal(confirmed.status, 200);
  const current = await f.call('/auth/session', undefined, auth.accessToken);
  assert.equal(current.status, 200);
  assert.equal(current.body.mfaVerified, true);
  assert.equal((await f.call('/auth/session', undefined, other.body.accessToken)).status, 401);
  assert.equal((await f.call('/auth/token/refresh', { deviceId, refreshToken: auth.refreshToken })).status, 200);
  const key = `identity/users/${f.user.id}`, user = await f.repo.latest(key);
  await f.repo.append(key, { ...user, securityVersion: 'later-password-reset' }, user.revision);
  assert.equal((await f.call('/auth/session', undefined, auth.accessToken)).status, 401);
});

test('concurrent logins cannot bypass the per-account active-device ceiling', async () => {
  const f = await fixture();
  for (let i = 0; i < 19; i++) {
    if (i % 8 === 0) f.advance(61000);
    assert.equal((await f.login({ deviceId: `installation-number-${String(i).padStart(4, '0')}` })).status, 200);
  }
  const list = f.store.list;
  let arrivals = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  f.store.list = async (options) => {
    const result = await list(options);
    if (options.prefix === `platform-v1/identity/native/by-user/${f.user.id}/`) {
      if (++arrivals === 2) release();
      await ready;
    }
    return result;
  };
  await Promise.all([f.login({ deviceId: 'installation-number-0020' }), f.login({ deviceId: 'installation-number-0021' })]);
  f.store.list = list;
  assert.equal((await f.browser.call('/auth/devices')).body.items.length, 20);
});

test('a published login head retains its device during delayed token issuance on another installation', async () => {
  const f = await fixture(), write = f.store.setJSON;
  let entered, release;
  const paused = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  let delayed = false;
  f.store.setJSON = async (key, ...args) => {
    if (!delayed && key.startsWith('platform-v1/identity/native/access/')) {
      delayed = true; entered(); await resume;
    }
    return write(key, ...args);
  };
  const first = f.login();
  await paused;
  const second = await f.login({ deviceId: 'another-installation-000001' });
  release();
  const original = await first;
  assert.equal(original.status, 200); assert.equal(second.status, 200);
  for (const r of [original, second]) assert.equal((await f.call('/auth/session', undefined, r.body.accessToken)).status, 200);
});

test('empty, malformed, combined and mixed-case authorization never authenticates the cookie user', async () => {
  const f = await fixture();
  for (const value of ['', 'Bearer', 'Bearer ', 'Bearer invalid', 'Basic anything', 'Bearer ' + 'A'.repeat(43), `Bearer ${'A'.repeat(43)}, Bearer ${'B'.repeat(43)}`]) {
    for (const name of ['Authorization', 'authorization', 'aUtHoRiZaTiOn']) {
      assert.equal((await f.browser.call('/auth/session', { headers: { [name]: value } })).status, 401);
      assert.equal((await f.browser.call('/activities', { method: 'POST', body: f.activity(), headers: { Origin: 'https://evil.invalid', [name]: value } })).status, 401);
    }
  }
  const own = await f.login();
  const key = `identity/users/${f.user.id}`, user = await f.repo.latest(key);
  await f.repo.append(key, { ...user, status: 'disabled' }, user.revision);
  assert.equal((await f.call('/auth/session', undefined, own.body.accessToken)).status, 401);
  assert.equal((await f.call('/auth/token/refresh', { deviceId, refreshToken: own.body.refreshToken })).status, 401);
});
