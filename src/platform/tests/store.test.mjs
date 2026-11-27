import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../server/store.mjs';
import { memoryBlob } from './fixtures.mjs';

test('a delayed writer cannot restore an older account security revision', async () => {
  const store = memoryBlob();
  const repo = createRepository(store, { secret: 'synthetic-revision-test-secret-only' });
  const prefix = 'identity/users/synthetic-account';
  const write = store.setJSON;
  let published, resume;
  const firstPublished = new Promise(resolve => { published = resolve; });
  const finishFirst = new Promise(resolve => { resume = resolve; });
  store.setJSON = async (key, value, options) => {
    await write(key, value, options);
    if (key === `platform-v1/${prefix}/00000001.json`) {
      published(); await finishFirst;
    }
  };
  const earlier = repo.append(prefix, { status: 'active', securityVersion: 'before-password-change' }, 0);
  try {
    await firstPublished;
    await repo.append(prefix, { status: 'disabled', securityVersion: 'after-password-change' }, 1);
  } finally { resume(); }
  await earlier;
  assert.equal((await repo.latest(prefix)).revision, 2);
  assert.equal((await repo.latest(prefix)).securityVersion, 'after-password-change');
  assert.equal((await repo.latest(prefix)).status, 'disabled');
  assert.equal(store.values.has(`platform-v1/${prefix}/current.json`), false, 'writes have no mutable security snapshot');
  await assert.rejects(repo.append(prefix, { securityVersion: 'stale-write' }, 1), error => error.status === 409);

  // An obsolete cloud snapshot can remain until storage cleanup, but it cannot
  // change the current contract or restore credentials after a security change.
  store.values.set(`platform-v1/${prefix}/current.json`, { revision: 1, status: 'active', securityVersion: 'before-password-change' });
  assert.equal((await repo.latest(prefix)).revision, 2);
  assert.equal((await repo.latest(prefix)).securityVersion, 'after-password-change');
});

test('warm immutable reads still check the strong revision list and respect changes and deletion', async () => {
  const store = memoryBlob();
  const read = store.get, list = store.list;
  const calls = [];
  store.list = async (options) => {
    assert.equal(options.consistency, 'strong');
    calls.push('list');
    const result = await list(options);
    return { blobs: result.blobs.map(({ key }) => ({ key, etag: key })) };
  };
  store.get = async (key, options) => {
    assert.equal(options.consistency, 'strong');
    calls.push('get');
    const value = await read(key, options);
    return value && options.type === 'text' ? JSON.stringify(value) : value;
  };
  const secret = 'synthetic-revision-cache-secret-only';
  const repo = createRepository(store, { secret, revisions: new Map() });
  const writer = createRepository(store, { secret });
  const prefix = 'identity/users/cache-test';
  await writer.append(prefix, { status: 'active' });
  (await repo.latest(prefix)).status = 'client mutation';
  calls.length = 0;
  assert.equal((await repo.latest(prefix)).status, 'active');
  assert.deepEqual(calls, ['list']);
  await writer.append(prefix, { status: 'disabled' }, 1);
  assert.equal((await repo.latest(prefix)).status, 'disabled');
  for (const key of await writer.list(`${prefix}/`)) await writer.remove(key);
  assert.equal(await repo.latest(prefix), null);
});

test('a known revision proves itself latest without a listing, and any newer one still wins', async () => {
  const store = memoryBlob();
  const repo = createRepository(store, { secret: 'synthetic-revision-test-secret-only' });
  const prefix = 'identity/users/known-revision';
  const list = store.list;
  let lists = 0;
  store.list = async (options) => { lists++; return list(options); };
  assert.equal(await repo.latest(prefix, 8, 0), null);
  await repo.append(prefix, { securityVersion: 'one' }, 0);
  lists = 0;
  assert.equal((await repo.latest(prefix, 8, 1)).securityVersion, 'one');
  assert.equal(lists, 0);
  await repo.append(prefix, { securityVersion: 'two' }, 1);
  await repo.append(prefix, { securityVersion: 'three' }, 2);
  lists = 0;
  for (const known of [0, 1, 2]) assert.equal((await repo.latest(prefix, 8, known)).securityVersion, 'three');
  assert.equal(lists, 3, 'a stale hint falls back to the authoritative listing');
  assert.equal((await repo.latest(prefix, 8, 7)).securityVersion, 'three', 'a hint beyond the head is never trusted');
});

test('a span of revisions read at once finds the latest before the first gap', async () => {
  const store = memoryBlob();
  const repo = createRepository(store, { secret: 'synthetic-revision-test-secret-only' });
  const prefix = 'collection/submissions/span';
  const list = store.list;
  let lists = 0;
  store.list = async (options) => { lists++; return list(options); };
  assert.equal(await repo.latest(prefix, 8, 0, 3), null);
  for (let revision = 0; revision < 3; revision++) await repo.append(prefix, { n: revision + 1 }, revision);
  lists = 0;
  assert.equal((await repo.latest(prefix, 8, 0, 3)).n, 3);
  assert.equal(lists, 1, 'three present revisions leave no gap in a span of three, so the listing decides');
  lists = 0;
  assert.equal((await repo.latest(prefix, 8, 0, 4)).n, 3);
  assert.equal(lists, 0);
});
