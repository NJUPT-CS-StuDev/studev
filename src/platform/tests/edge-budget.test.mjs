import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformHandler } from '../server/app.mjs';
import { EDGE_ROUTES, edgeRoute } from '../server/routes.mjs';
import { memoryBlob, memoryGateway, requestClient, testEnvironment } from './fixtures.mjs';

// An edge function may send about 50 subrequests per request. A request answered at the edge stays well under that
// however much the account and the platform hold, so it never fails halfway through its Blob work.
const BUDGET = 25;
const config = await testEnvironment();

test('edge routes are exactly the bounded reads and the rest go to Node', () => {
  assert.ok(edgeRoute('GET', '/api/platform/auth/session/'));
  for (const [method, path] of [['POST', '/api/platform/auth/login'], ['GET', '/api/platform/admin/audit'], ['GET', '/api/platform/collections/mine'],
    ['GET', '/api/platform/members'], ['POST', '/api/platform/auth/logout'], ['GET', '/api/platform/auth/devices']]) assert.equal(edgeRoute(method, path), false, path);
  assert.deepEqual([...EDGE_ROUTES].sort(), ['GET /api/platform/auth/config', 'GET /api/platform/auth/session', 'POST /api/platform/ai', 'POST /api/platform/auth/refresh', 'POST /api/platform/sync']);
});

test('every edge request stays within its subrequest budget on a well-used account', async () => {
  const store = memoryBlob();
  const handle = createPlatformHandler({ getStore: () => store, getGateway: memoryGateway });
  const client = requestClient(handle, config.env);
  assert.equal((await client.call('/auth/register', { method: 'POST', body: { qq: '100002', studentId: 'TEST100002', realName: '测试成员', nickname: '测试', password: config.password } })).status, 201);
  assert.equal((await client.call('/auth/login', { method: 'POST', body: { studentId: 'TEST100002', password: config.password } })).status, 200);
  // A long history: many task and settings revisions, many devices' worth of audit and other people's records.
  for (let i = 0; i < 40; i++) await client.call('/sync', { method: 'POST', body: { tasks: [{ id: `t${i}`, title: `任务 ${i}`, modified: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }] } });
  for (let i = 0; i < 300; i++) store.values.set(`platform-v1/audit/${String(i).padStart(13, '0')}.json`, { id: i });
  let operations = 0;
  for (const name of ['get', 'setJSON', 'delete', 'list']) {
    const original = store[name].bind(store);
    store[name] = (...args) => { operations++; return original(...args); };
  }
  const measured = async (path, init) => { operations = 0; const result = await client.call(path, init); return { status: result.status, operations }; };
  for (const [path, init] of [['/auth/config'], ['/auth/session'], ['/sync', { method: 'POST', body: { tasks: [] } }], ['/auth/refresh', { method: 'POST', body: {} }], ['/auth/session']]) {
    const { status, operations: used } = await measured(path, init);
    assert.equal(status, 200, path);
    assert.ok(used <= BUDGET, `${path} used ${used} Blob operations`);
  }
});
