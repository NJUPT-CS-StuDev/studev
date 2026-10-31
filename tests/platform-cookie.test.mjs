import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPlatformHandler } from '../src/server/platform-app.mjs';
import { memoryBlob, memoryGateway, testEnvironment } from './helpers/platform-fixtures.mjs';

test('web credentials survive EdgeOne header serialization as one cookie', async () => {
  const { env, password } = await testEnvironment();
  let clock = 1_800_000_000_000;
  const store = memoryBlob();
  const handle = createPlatformHandler({ getStore: () => store, getGateway: () => memoryGateway(), now: () => clock });
  let cookie = '', csrf = '';
  const deviceId = randomUUID();

  async function call(path, { method = 'GET', body } = {}) {
    if (path === '/auth/login' || path === '/auth/refresh') body = { deviceId, deviceName: 'EdgeOne serialization test', ...body };
    const request = new Request(`${env.PLATFORM_ORIGIN}/api/platform${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(method === 'POST' ? { Origin: env.PLATFORM_ORIGIN, 'X-CSRF-Token': csrf } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const original = await handle({ request, env, clientIp: 'edgeone-cookie-test' });
    const setCookies = original.headers.getSetCookie();
    assert.ok(setCookies.length <= 1, `${path} emitted ${setCookies.length} Set-Cookie headers`);
    // EdgeOne's onRequest wrapper currently reconstructs headers this way.
    const serialized = new Response(await original.arrayBuffer(), { status: original.status, headers: Object.fromEntries(original.headers) });
    assert.ok(serialized.headers.getSetCookie().length <= 1, `${path} serialized more than one Set-Cookie header`);
    for (const setCookie of serialized.headers.getSetCookie()) {
      const pair = setCookie.split(';')[0];
      const name = pair.slice(0, pair.indexOf('='));
      if (pair.endsWith('=')) cookie = cookie.split('; ').filter((value) => !value.startsWith(`${name}=`)).join('; ');
      else cookie = [...cookie.split('; ').filter(Boolean).filter((value) => !value.startsWith(`${name}=`)), pair].join('; ');
    }
    const value = await serialized.json();
    if (value.csrfToken) csrf = value.csrfToken;
    return { status: serialized.status, body: value, headers: serialized.headers };
  }

  const login = await call('/auth/login', { method: 'POST', body: { studentId: env.PLATFORM_OWNER_STUDENT_ID, password } });
  assert.equal(login.status, 200);
  assert.match(cookie, /^__Host-studev_platform=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(login.headers.getSetCookie().length, 1);
  assert.equal((await call('/auth/session')).status, 200);

  clock += 600_001;
  assert.equal((await call('/auth/session')).status, 401);
  const refreshed = await call('/auth/refresh', { method: 'POST', body: {} });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.headers.getSetCookie().length, 1);
  assert.equal((await call('/auth/session')).status, 200);

  const signedOut = await call('/auth/logout', { method: 'POST', body: {} });
  assert.equal(signedOut.status, 200);
  assert.equal(signedOut.headers.getSetCookie().length, 1);
  assert.match(signedOut.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('/auth/session')).status, 401);
});
