import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson, requireOrigin, safeLog } from '../server/common.mjs';
import { createRepository } from '../server/store.mjs';

function memoryStore() {
  const values = new Map();
  return {
    values,
    async get(key) { return structuredClone(values.get(key) ?? null); },
    async setJSON(key, value, options) { if (options?.onlyIfNew && values.has(key)) throw Object.assign(new Error('conditional write'), { code: 'PRECONDITION_FAILED' }); values.set(key, structuredClone(value)); },
    async delete(key) { values.delete(key); },
    async list({ prefix }) { return { blobs: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}
test('a JSON body is read whole and bounded by the endpoint limit', async () => {
  const post = (body) => new Request('https://example.org/api/platform/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.deepEqual(await readJson(post('{"safe":"学号"}')), { safe: '学号' });
  const chunks = new ReadableStream({ start(controller) { for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(30000).fill(32)); controller.close(); } });
  await assert.rejects(readJson(new Request('https://example.org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: chunks, duplex: 'half' })), (e) => e.status === 413);
  await assert.rejects(readJson(post('[1]')), (e) => e.status === 400);
});
test('mutations require exact valid origin and reject cross-site fetches', () => {
  const env = { PLATFORM_ORIGIN: 'https://example.org' };
  requireOrigin(new Request('https://example.org', { headers: { Origin: 'https://example.org' } }), env);
  assert.throws(() => requireOrigin(new Request('https://example.org', { headers: { Origin: 'https://evil.invalid' } }), env), (e) => e.status === 403);
  assert.throws(() => requireOrigin(new Request('https://example.org', { headers: { Origin: 'https://example.org', 'Sec-Fetch-Site': 'cross-site' } }), env), (e) => e.status === 403);
});
test('atomic immutable revisions reject a concurrent stale writer and isolate platform namespace', async () => {
  const store = memoryStore(), repo = createRepository(store, { secret: 'x'.repeat(48) });
  await repo.append('collection/definitions/example', { title: 'one', revision: 99 });
  const writes = await Promise.allSettled([repo.append('collection/definitions/example', { title: 'two' }, 1), repo.append('collection/definitions/example', { title: 'three' }, 1)]);
  assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await repo.latest('collection/definitions/example')).revision, 2);
  assert.ok([...store.values.keys()].every((key) => key.startsWith('platform-v1/')));
  await assert.rejects(repo.list('../collections/'), /Invalid internal/);
});
test('shared rate tickets enforce caps and audit strips unapproved secrets', async () => {
  const store = memoryStore(); let clock = 1_800_000_000_000;
  const repo = createRepository(store, { secret: 'x'.repeat(48), now: () => clock });
  await repo.throttle('login', 'client', 2); await repo.throttle('login', 'client', 2);
  await assert.rejects(repo.throttle('login', 'client', 2), (e) => e.status === 429);
  clock += 180000; await repo.throttle('login', 'client', 2);
  const record = await repo.audit({ id: 'user1', qq: 'private' }, 'role.updated', 'user2', { role: 'admin', password: 'secret', totp: 'sensitive', identityVerified: true, profileComplete: 'private student information', studentId: 'PRIVATE123', realName: 'private person' });
  assert.deepEqual(record.details, { role: 'admin', identityVerified: true });
  assert.equal(record.actorId, 'user1'); assert.ok(!JSON.stringify(record).includes('sensitive'));
  await assert.rejects(repo.list('../collections/'), /Invalid internal/);
});
test('safe diagnostic logger does not emit storage messages, stacks or signed URLs', () => {
  const previous = console.error; const seen = [];
  try { console.error = (...args) => seen.push(args); safeLog({ name: 'Error', code: 'bad secret value', message: 'https://secret.invalid?token=private', stack: 'secret stack' }); }
  finally { console.error = previous; }
  const output = JSON.stringify(seen); assert.ok(!output.includes('private')); assert.ok(!output.includes('secret')); assert.ok(output.includes('UNKNOWN'));
});

test('shared NAT rate checks skip occupied tickets and concurrent claims cannot exceed the cap', async () => {
  const store = memoryStore(), repo = createRepository(store, { secret: 'x'.repeat(48), now: () => 1_800_000_000_000 });
  for (let i = 0; i < 59; i++) await repo.throttle('busy-login', 'campus-nat', 60);
  let writes = 0;
  const write = store.setJSON;
  store.setJSON = async (...args) => { writes++; return write(...args); };
  await repo.throttle('busy-login', 'campus-nat', 60);
  assert.equal(writes, 1, 'a nearly full window needs only the final free-slot write');
  await assert.rejects(repo.throttle('busy-login', 'campus-nat', 60), (e) => e.status === 429);
  assert.equal(writes, 1, 'a full window is rejected without probing occupied slots');
  const claims = await Promise.allSettled(Array.from({ length: 30 }, () => repo.throttle('burst', 'shared', 12)));
  assert.equal(claims.filter(result => result.status === 'fulfilled').length, 12);
  assert.ok(claims.filter(result => result.status === 'rejected').every(result => result.reason.status === 429));
});
