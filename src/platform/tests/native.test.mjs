import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformHandler } from '../server/app.mjs';
import { createRepository } from '../server/store.mjs';
import { encryptTotp, totpCode } from '../server/totp.mjs';
import { digest } from '../server/crypto.mjs';
import { memoryBlob, memoryGateway, requestClient, testEnvironment } from './fixtures.mjs';

const config = await testEnvironment();
const deviceId = 'synthetic-device-000001';
const day = 86_400_000;
async function fixture() {
  let clock = Date.UTC(2026, 9, 30);
  const store = memoryBlob(), gateway = memoryGateway(), env = config.env;
  const now = () => clock;
  const repo = createRepository(store, { now, secret: env.PLATFORM_SESSION_SECRET });
  const handle = createPlatformHandler({ getStore: () => store, getGateway: () => gateway, now });
  const browser = requestClient(handle, env);
  const registered = await browser.call('/auth/register', { method: 'POST', body: { qq: '100002', studentId: 'TEST100002', realName: '测试成员', nickname: '测试昵称', password: config.password } });
  assert.equal(registered.status, 201);
  await browser.call('/auth/login', { method: 'POST', body: { studentId: 'TEST100002', password: config.password } });
  async function call(path, body, token, headers = {}, method = body === undefined ? 'GET' : 'POST') {
    const response = await handle({ request: new Request('https://studev.test/api/platform' + path, { method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, clientIp: 'native-test' });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  const login = (extra = {}) => call('/auth/login', { studentId: 'TEST100002', password: config.password, deviceId, deviceName: '测试手机', ...extra });
  return { ...config, store, repo, browser, call, login, user: registered.body.user, advance: (ms) => { clock += ms; }, now };
}

test('native tokens are opaque, hashed, device-bound, short-lived; cookie login stays cookie-only', async () => {
  const f = await fixture(), login = await f.login();
  assert.equal(login.status, 200); assert.equal(login.headers.get('set-cookie'), null);
  assert.equal(login.body.expiresIn, 600);
  const { accessToken, refreshToken } = login.body;
  const persisted = JSON.stringify([...f.store.values.entries()]);
  assert.ok(!persisted.includes(accessToken)); assert.ok(!persisted.includes(refreshToken)); assert.ok(!persisted.includes(deviceId));
  assert.equal((await f.call('/auth/session', undefined, accessToken)).body.user.id, f.user.id);
  assert.equal((await f.call('/auth/refresh', { refreshToken, deviceId: 'different-device-000001' })).status, 401);
  f.advance(600000);
  assert.equal((await f.call('/auth/session', undefined, accessToken)).status, 401);
  const refreshed = await f.call('/auth/refresh', { refreshToken, deviceId });
  assert.equal(refreshed.status, 200); assert.notEqual(refreshed.body.refreshToken, refreshToken);
  assert.equal((await f.browser.call('/auth/session')).status, 200, 'the web credential lasts its idle window');
  assert.equal((await f.browser.call('/auth/refresh', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.browser.call('/auth/session')).status, 200);
  assert.equal((await f.call('/auth/refresh', { refreshToken, deviceId })).body.error.code, 'REFRESH_REPLAYED');
  assert.equal((await f.call('/auth/session', undefined, refreshed.body.accessToken)).status, 401);
});

test('racing refresh claims one immutable ticket and replay revokes the whole device', async () => {
  const f = await fixture(), { body } = await f.login();
  const results = await Promise.all([1, 2].map(() => f.call('/auth/refresh', { refreshToken: body.refreshToken, deviceId })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  assert.equal((await f.call('/auth/session', undefined, results.find((r) => r.status === 200).body.accessToken)).status, 401);
});

test('foreground traffic renews the 30-day device deadline; background traffic only rotates credentials', async () => {
  const f = await fixture();
  const started = f.now();
  const foreground = await f.login();
  const backgroundDevice = 'synthetic-background-0001';
  const background = await f.login({ deviceId: backgroundDevice });
  assert.equal(foreground.body.refreshExpiresAt, started + 30 * day);
  f.advance(29 * day);
  const quiet = await f.call('/auth/refresh', { refreshToken: background.body.refreshToken, deviceId: backgroundDevice, foreground: false });
  assert.equal(quiet.status, 200);
  assert.equal(quiet.body.refreshExpiresAt, started + 30 * day);
  const active = await f.call('/auth/refresh', { refreshToken: foreground.body.refreshToken, deviceId, foreground: true });
  assert.equal(active.status, 200);
  assert.equal(active.body.refreshExpiresAt, started + 59 * day);
  assert.equal(active.body.deviceSessionId, foreground.body.deviceSessionId);
  const inventory = await f.call('/auth/devices', undefined, active.body.accessToken);
  assert.equal(inventory.body.items.find(item => item.id === active.body.deviceSessionId).expiresAt, active.body.refreshExpiresAt);

  f.advance(day);
  assert.equal((await f.call('/auth/refresh', { refreshToken: quiet.body.refreshToken, deviceId: backgroundDevice })).status, 401);
  const quietAgain = await f.call('/auth/refresh', { refreshToken: active.body.refreshToken, deviceId });
  assert.equal(quietAgain.status, 200);
  assert.equal(quietAgain.body.refreshExpiresAt, active.body.refreshExpiresAt);
  const continued = await f.call('/auth/refresh', { refreshToken: quietAgain.body.refreshToken, deviceId, foreground: true });
  assert.equal(continued.status, 200);
  assert.equal(continued.body.refreshExpiresAt, started + 60 * day);
  const current = await f.call('/auth/devices', undefined, continued.body.accessToken);
  assert.deepEqual(current.body.items.map(device => device.id), [continued.body.deviceSessionId]);
});

for (const [role, maximumDays] of [['user', 180], ['admin', 90], ['owner', 90]]) {
  test(`a continuously used ${role} session stops at its ${maximumDays}-day limit`, async () => {
    const f = await fixture();
    if (role !== 'user') {
      const key = `identity/users/${f.user.id}`;
      const account = await f.repo.latest(key);
      await f.repo.append(key, { ...account, role, securityVersion: `${role}-renewal-test` }, account.revision);
    }
    const started = f.now();
    let auth = (await f.login()).body;
    const absoluteExpiry = started + maximumDays * day;
    for (let elapsed = 28; elapsed < maximumDays; elapsed += 28) {
      f.advance(28 * day);
      const refreshed = await f.call('/auth/refresh', { refreshToken: auth.refreshToken, deviceId, foreground: true });
      assert.equal(refreshed.status, 200);
      auth = refreshed.body;
      assert.equal(auth.refreshExpiresAt, Math.min(f.now() + 30 * day, absoluteExpiry));
    }
    f.advance(absoluteExpiry - 60_000 - f.now());
    const lastRefresh = await f.call('/auth/refresh', { refreshToken: auth.refreshToken, deviceId, foreground: true });
    assert.equal(lastRefresh.status, 200);
    assert.equal(lastRefresh.body.expiresIn, 60);
    assert.equal(lastRefresh.body.refreshExpiresAt, absoluteExpiry);
    f.advance(60_000);
    assert.equal((await f.call('/auth/session', undefined, lastRefresh.body.accessToken)).status, 401);
    assert.equal((await f.call('/auth/refresh', { refreshToken: lastRefresh.body.refreshToken, deviceId })).status, 401);
  });
}

test('an existing fixed-expiry browser session rolls only after foreground renewal without a new login', async () => {
  const f = await fixture();
  const started = f.now();
  const original = (await f.browser.call('/auth/devices')).body.items[0];

  f.advance(29 * day);
  assert.equal((await f.browser.call('/auth/refresh', { method: 'POST', body: { foreground: false } })).status, 200);
  assert.equal((await f.browser.call('/auth/devices')).body.items[0].expiresAt, started + 30 * day);
  assert.equal((await f.browser.call('/auth/refresh', { method: 'POST', body: { foreground: true } })).status, 200);
  const devices = (await f.browser.call('/auth/devices')).body.items;
  assert.equal(devices[0].id, original.id);
  assert.equal(devices[0].expiresAt, started + 59 * day);
  assert.equal((await f.browser.call('/auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.browser.call('/auth/refresh', { method: 'POST', body: { foreground: true } })).status, 401);
});

test('web device list exposes only safe metadata and revocation is owner-only and CSRF protected', async () => {
  const f = await fixture(), { body } = await f.login();
  const devices = await f.browser.call('/auth/devices');
  assert.deepEqual(Object.keys(devices.body.items[0]).sort(), ['createdAt', 'current', 'deviceName', 'expiresAt', 'id', 'kind']);
  assert.equal(devices.body.items.find(d => d.kind === 'bearer').id, body.deviceSessionId);
  const path = `/auth/devices/${body.deviceSessionId}/revoke`;
  assert.equal((await f.browser.call(path, { method: 'POST', body: {}, headers: { 'X-CSRF-Token': '' } })).status, 403);
  const other = await f.repo.append('identity/users/00000000-0000-0000-0000-000000000001', { ...f.user, id: '00000000-0000-0000-0000-000000000001', securityVersion: 'other', status: 'active' });
  const nativeKey = `platform-v1/identity/devices/sessions/${body.deviceSessionId}.json`;
  const session = f.store.values.get(nativeKey);
  f.store.values.set(nativeKey, { ...session, userId: other.id });
  assert.equal((await f.browser.call(path, { method: 'POST', body: {} })).status, 404);
  f.store.values.set(nativeKey, session);
  assert.equal((await f.browser.call(path, { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.call('/auth/session', undefined, body.accessToken)).status, 401);
  assert.equal((await f.call('/auth/refresh', { deviceId, refreshToken: body.refreshToken })).status, 401);
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
  assert.equal((await f.call('/auth/refresh', { deviceId, refreshToken: login.body.refreshToken })).status, 401);
});

test('browser and native password attempts share account rate limits', async () => {
  const f = await fixture();
  for (let i = 0; i < 9; i++) assert.equal((await f.login({ password: 'wrong' })).status, 401);
  assert.equal((await f.browser.call('/auth/login', { method: 'POST', body: { studentId: 'TEST100002', password: f.password } })).status, 429);
});

test('every existing mutating endpoint still rejects cross-origin cookies, including spoofed bearer and native bootstrap', async () => {
  const f = await fixture(), id = '00000000-0000-0000-0000-000000000001';
  const paths = ['/auth/register', '/auth/login', '/auth/logout', '/auth/profile', '/auth/password', '/auth/totp/setup', '/auth/totp/confirm', '/auth/totp/disable', '/admin/users', `/admin/users/${id}`, `/admin/users/${id}/reset-password`, `/admin/users/${id}/reset-totp`, `/admin/users/${id}/delete`, '/collections/items', `/collections/items/${id}`, `/collections/items/${id}/duplicate`, `/collections/items/${id}/rounds`, `/collections/items/${id}/rounds/main`, `/collections/items/${id}/rounds/main/submissions`, `/collections/submissions/${id}/complete`, `/collections/submissions/${id}/edit`, `/collections/submissions/${id}/review`, `/collections/submissions/${id}/files/${id}/download`, '/auth/login', '/auth/refresh', `/auth/devices/${id}/revoke`];
  for (const path of paths) {
    for (const headers of [{ Origin: 'https://evil.invalid' }, { Origin: '' }, { Origin: 'https://studev.test', 'Sec-Fetch-Site': 'cross-site' }]) {
      const result = await f.browser.call(path, { method: 'POST', body: {}, headers });
      assert.equal(result.status, 403, path); assert.equal(result.body.error.code, 'ORIGIN_REJECTED', path);
    }
    const spoof = await f.browser.call(path, { method: 'POST', body: {}, headers: { Origin: 'https://evil.invalid', Authorization: 'Bearer invalid' } });
    assert.equal(spoof.status, 401, path);
  }
  assert.equal((await f.browser.call(`/admin/users/${id}`, { method: 'DELETE', body: {}, headers: { Origin: 'https://evil.invalid' } })).status, 403);
});

test('native accounts share identity with browser collections without elevating their role', async () => {
  const f = await fixture(), { body: auth } = await f.login();
  assert.equal((await f.call('/collections', undefined, auth.accessToken)).body.viewer.id, f.user.id);
  assert.equal((await f.call('/collections/mine', undefined, auth.accessToken)).status, 200);
  assert.equal((await f.call('/collections?view=owner', undefined, auth.accessToken)).body.viewer.role, 'user');
  assert.equal((await f.call('/collections/items', {}, auth.accessToken)).status, 403);
});

test('native recovery codes remain single-use, setup gates mint no credentials, and device re-login replaces its old family', async () => {
  const f = await fixture(), key = `identity/users/${f.user.id}`, user = await f.repo.latest(key);
  const old = await f.login(), fresh = await f.login();
  assert.equal((await f.call('/auth/session', undefined, old.body.accessToken)).status, 401);
  assert.equal((await f.browser.call('/auth/devices')).body.items.length, 2);
  const secret = 'JBSWY3DPEHPK3PXP', recovery = 'TEST-RECOVERY-CODE';
  const totp = { encrypted: encryptTotp(secret, f.env.PLATFORM_ENCRYPTION_KEY, user.id), epoch: 'recovery-test', recoveryHashes: [digest(`${user.id}:${recovery}`)] };
  const secured = await f.repo.append(key, { ...user, totp }, user.revision);
  assert.equal((await f.login({ totp: recovery })).status, 200);
  assert.equal((await f.login({ totp: recovery })).body.error.code, 'MFA_REPLAYED');
  await f.repo.append(key, { ...secured, totp: null, mustChangePassword: true }, secured.revision);
  const limited = await f.login(); assert.equal(limited.status, 200); assert.equal(limited.body.passwordChangeRequired, true); assert.ok(limited.body.accessToken);
  f.advance(31 * 86400000);
  assert.equal((await f.call('/auth/refresh', { deviceId, refreshToken: fresh.body.refreshToken })).status, 401);
});

test('login and device reads stay bounded by current families, not obsolete device history', async () => {
  const f = await fixture();
  const first = await f.login();
  // Retired installations remain in storage, but must not add a remote read to
  // every future login or appear as a live device.
  for (let i = 0; i < 200; i++) f.store.values.set(`platform-v1/identity/devices/by-user/${f.user.id}/retired-${i}.json`, { id: `retired-${i}` });
  const read = f.store.get, list = f.store.list, reads = [], lists = [];
  f.store.get = async (key, ...args) => { reads.push(key); return read(key, ...args); };
  f.store.list = async (options) => {
    lists.push(options.prefix);
    assert.ok(!options.prefix.includes('/by-user/'), 'historical installations are not the current-family index');
    return list(options);
  };
  const second = await f.login({ deviceId: 'another-current-installation-0001' });
  assert.equal(second.status, 200);
  assert.ok(!reads.some(key => key.includes('retired-')));
  reads.length = 0; lists.length = 0;
  const devices = await f.call('/auth/devices', undefined, second.body.accessToken);
  assert.equal(devices.status, 200);
  assert.equal(devices.body.items.length, 3);
  assert.ok(!lists.some(key => key.includes('/devices/logins/')), 'the credential names its revisions, and device checks share its login head');
  assert.ok(lists.every(key => key.includes('/devices/state/')), 'only the other devices’ own state is listed');
  assert.equal(reads.filter(key => key.startsWith(`platform-v1/identity/users/${f.user.id}/`) && /\/\d{8}\.json$/.test(key)).length, 2, 'one account revision and its absent successor, shared by all device checks');
  assert.ok(!reads.some(key => key.startsWith('platform-v1/identity/qq/')), 'existing credentials do not reinitialize the owner');
  assert.ok(!reads.some(key => key.includes('retired-')));
  assert.equal((await f.call(`/auth/devices/${first.body.deviceSessionId}/revoke`, {}, second.body.accessToken)).status, 200);
  const after = await f.call('/auth/devices', undefined, second.body.accessToken);
  assert.equal(after.body.items.length, 2);
  assert.equal((await f.call('/auth/session', undefined, first.body.accessToken)).status, 401, 'bounded reads still enforce live revocation');
});

test('refresh endpoint rate limit ignores spoofed forwarding headers', async () => {
  const f = await fixture();
  for (let i = 0; i < 60; i++) assert.equal((await f.call('/auth/refresh', {}, undefined, { 'X-Forwarded-For': `192.0.2.${i}` })).status, 400);
  assert.equal((await f.call('/auth/refresh', {}, undefined, { 'X-Forwarded-For': '192.0.2.99' })).status, 429);
});

test('overlapping logins from one installation cannot leave two usable device families', async () => {
  const f = await fixture();
  // Both login requests observe the same device list before either publishes.
  const list = f.store.list;
  let arrivals = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  f.store.list = async (options) => {
    const result = await list(options);
    if (options.prefix === `platform-v1/identity/devices/logins/${f.user.id}/`) {
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
  assert.equal((await f.browser.call('/auth/devices')).body.items.length, 2);
  for (let i = 0; i < issued.length; i++) {
    if (usable[i].status !== 200) assert.equal((await f.call('/auth/refresh', { deviceId, refreshToken: issued[i].body.refreshToken })).status, 401);
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
  assert.equal((await f.call('/auth/refresh', { deviceId, refreshToken: auth.refreshToken })).status, 200);
  const key = `identity/users/${f.user.id}`, user = await f.repo.latest(key);
  await f.repo.append(key, { ...user, securityVersion: 'later-password-reset' }, user.revision);
  assert.equal((await f.call('/auth/session', undefined, auth.accessToken)).status, 401);
});

test('concurrent logins cannot bypass the per-account active-device ceiling', async () => {
  const f = await fixture();
  for (let i = 0; i < 18; i++) {
    if (i % 8 === 0) f.advance(61000);
    assert.equal((await f.login({ deviceId: `installation-number-${String(i).padStart(4, '0')}` })).status, 200);
  }
  const list = f.store.list;
  let arrivals = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  f.store.list = async (options) => {
    const result = await list(options);
    if (options.prefix === `platform-v1/identity/devices/logins/${f.user.id}/`) {
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
    if (!delayed && key.startsWith('platform-v1/identity/devices/refresh/')) {
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
      assert.equal((await f.browser.call('/auth/logout', { method: 'POST', body: {}, headers: { Origin: 'https://evil.invalid', [name]: value } })).status, 401);
    }
  }
  const own = await f.login();
  const key = `identity/users/${f.user.id}`, user = await f.repo.latest(key);
  await f.repo.append(key, { ...user, status: 'disabled' }, user.revision);
  assert.equal((await f.call('/auth/session', undefined, own.body.accessToken)).status, 401);
  assert.equal((await f.call('/auth/refresh', { deviceId, refreshToken: own.body.refreshToken })).status, 401);
});
