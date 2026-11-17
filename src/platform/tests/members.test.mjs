import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformHandler } from '../server/app.mjs';
import { createIdentity } from '../server/identity.mjs';
import { createRepository } from '../server/store.mjs';
import { profileNickname } from '../server/roster.mjs';
import { avatarBody, createMembers } from '../server/members.mjs';
import { memoryBlob, requestClient, testEnvironment } from './fixtures.mjs';

async function fixture() {
  const { env, password } = await testEnvironment();
  const store = memoryBlob(), repo = createRepository(store, { secret: env.PLATFORM_SESSION_SECRET });
  const handle = createPlatformHandler({ getStore: () => store });
  const one = requestClient(handle, env), two = requestClient(handle, env), visitor = requestClient(handle, env);
  const first = await one.call('/auth/register', { method: 'POST', body: { studentId: 'MEMBER001', realName: '测试同学', nickname: '', qq: '10000801', password } });
  const second = await two.call('/auth/register', { method: 'POST', body: { studentId: 'MEMBER002', realName: '保密姓名', nickname: '风中的树', qq: '10000802', password } });
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  await one.call('/auth/login', { method: 'POST', body: { studentId: 'MEMBER001', password } });
  await two.call('/auth/login', { method: 'POST', body: { studentId: 'MEMBER002', password } });
  return { env, password, store, repo, handle, one, two, visitor, first: first.body.user, second: second.body.user };
}

test('nickname is explicit or the final complete character, never a private identifier fallback', () => {
  assert.equal(profileNickname({ realName: '测试同学', nickname: '' }), '学');
  assert.equal(profileNickname({ realName: '测试同学', nickname: '自选昵称' }), '自选昵称');
  assert.equal(profileNickname({ realName: '测试同学', nickname: '测试同学' }), '学');
  assert.equal(profileNickname({ realName: '任𠮷' }), '𠮷');
  assert.equal(profileNickname({ studentId: 'PRIVATE001', qq: '10000801' }), '同学');
});

test('ordinary signed-in members browse only public fields while full account lookup remains privileged', async () => {
  const f = await fixture();
  assert.equal(f.first.nickname, '学');
  assert.equal((await f.visitor.call('/members')).status, 401);
  assert.equal((await f.visitor.call(`/members/${f.first.id}`)).status, 401);
  const listed = await f.one.call('/members');
  assert.equal(listed.status, 200);
  assert.ok(listed.body.items.some(member => member.id === f.second.id));
  for (const member of listed.body.items) assert.deepEqual(Object.keys(member).sort(), ['avatarUrl', 'id', 'nickname', 'signature']);
  const payload = JSON.stringify(listed.body);
  for (const privateValue of ['MEMBER001', 'MEMBER002', '保密姓名', '10000801', '10000802', '@qq.com', 'passwordHash', 'totp', 'securityVersion']) assert.equal(payload.includes(privateValue), false, privateValue);
  assert.equal((await f.one.call('/admin/users')).status, 403);
  assert.equal((await f.one.call(`/admin/users/${f.second.id}`)).status, 403);
  const detail = await f.one.call(`/members/${f.second.id}`);
  assert.deepEqual(detail.body.member, listed.body.items.find(member => member.id === f.second.id));
  assert.equal((await f.one.call('/members?query=MEMBER002')).body.total, 0);
  assert.equal((await f.one.call('/members?query=风中的树')).body.total, 1);
  assert.equal((await f.one.call('/members?limit=1&offset=1')).body.items.length, 1);
  assert.equal((await f.one.call('/members?limit=0')).status, 400);
});

test('profile changes update the public projection and blank nicknames restore the default', async () => {
  const f = await fixture();
  const current = (await f.two.call('/auth/session')).body.user;
  const updated = await f.two.call('/auth/profile', { method: 'POST', body: { revision: current.revision, nickname: '', signature: '在这里一起学习。' } });
  assert.equal(updated.status, 200); assert.equal(updated.body.user.nickname, '名');
  const detail = (await f.one.call(`/members/${f.second.id}`)).body.member;
  assert.equal(detail.nickname, '名'); assert.equal(detail.signature, '在这里一起学习。');
  const stored = await f.repo.latest(`identity/users/${f.second.id}`);
  const disabled = await f.repo.append(`identity/users/${stored.id}`, { ...stored, status: 'disabled' }, stored.revision);
  await createMembers(f.repo, f.env.PLATFORM_ORIGIN).publish(disabled, stored);
  assert.equal((await f.one.call(`/members/${stored.id}`)).status, 404);
  assert.equal((await f.one.call('/members')).body.items.some(member => member.id === stored.id), false);
});

test('public avatar URLs hide QQ and proxy only fixed image types without exposing account data', async () => {
  const f = await fixture();
  let target;
  const identity = createIdentity({ repo: f.repo, env: f.env, fetcher: async url => { target = url; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }); } });
  const route = `/api/platform/members/${f.first.id}/avatar`;
  const picture = await identity.handle({ request: new Request(f.env.PLATFORM_ORIGIN + route) }, route);
  assert.equal(picture.status, 200); assert.deepEqual([...new Uint8Array(await picture.arrayBuffer())], [1, 2, 3]);
  assert.match(target, /^https:\/\/q1\.qlogo\.cn\//);
  assert.equal(picture.headers.get('Location'), null);
  assert.equal(picture.headers.get('Content-Type'), 'image/png');
  const html = createIdentity({ repo: f.repo, env: f.env, fetcher: async () => new Response('<script>bad</script>', { headers: { 'Content-Type': 'text/html' } }) });
  await assert.rejects(html.handle({ request: new Request(f.env.PLATFORM_ORIGIN + route) }, route), error => error.code === 'AVATAR_UNAVAILABLE');
});

test('appointed pending staff use the same opaque avatar without publishing pending ordinary accounts', async () => {
  const f = await fixture(), source = await f.repo.latest(`identity/users/${f.first.id}`);
  const identity = createIdentity({ repo:f.repo, env:f.env, fetcher:async () => new Response(new Uint8Array([1]), {headers:{'Content-Type':'image/png'}}) });
  const path = `/api/platform/members/${source.id}/avatar`;
  const image = () => identity.handle({request:new Request(f.env.PLATFORM_ORIGIN+path)}, path);
  let current = await f.repo.append(`identity/users/${source.id}`, {...source, status:'pending', term:'2026-2027', role:'user'}, source.revision);
  await assert.rejects(image(), error => error.code === 'MEMBER_NOT_FOUND');
  current = await f.repo.append(`identity/users/${source.id}`, {...current, role:'admin'}, current.revision);
  assert.equal((await image()).status, 200);
  current = await f.repo.append(`identity/users/${source.id}`, {...current, term:'1900-1901'}, current.revision);
  await assert.rejects(image(), error => error.code === 'MEMBER_NOT_FOUND');
  current = await f.repo.append(`identity/users/${source.id}`, {...current, term:'2026-2027', status:'disabled'}, current.revision);
  await assert.rejects(image(), error => error.code === 'MEMBER_NOT_FOUND');
});

test('member listing reads only the public directory after authentication, and ignores delayed obsolete profiles', async () => {
  const f = await fixture();
  const readKeys = [], listKeys = [];
  const publicRepo = { ...f.repo, get: async key => { readKeys.push(key); return f.repo.get(key); }, list: async prefix => { listKeys.push(prefix); return f.repo.list(prefix); } };
  const members = createMembers(publicRepo, f.env.PLATFORM_ORIGIN);
  const current = await f.repo.latest(`identity/users/${f.first.id}`);
  assert.equal(current.nickname, '', 'an unset nickname remains unset in the account');
  const disabled = { ...current, revision: current.revision + 1, status: 'disabled' };
  await members.publish(disabled, current);
  // A slower earlier publisher cannot resurrect the person in the directory.
  await members.publish(current);
  const page = await members.list('', 0, 50);
  assert.equal(page.items.some(member => member.id === current.id), false);
  assert.deepEqual(listKeys, ['members/']);
  assert.ok(readKeys.every(key => key.startsWith('members/')));
  const changedName = { ...current, realName: '改名字', revision: disabled.revision + 1 };
  await members.publish(changedName, disabled);
  assert.equal((await members.get(current.id)).nickname, '字', 'defaults are recomputed from the corrected name');
  await assert.rejects(members.publish({ ...changedName, nickname: 'a different write at the same revision' }), error => error.status === 409);
});

test('avatar body stops reading an unknown-length stream at the actual size boundary', async () => {
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await assert.rejects(avatarBody(new Response(stream)), error => error.code === 'AVATAR_UNAVAILABLE');
  assert.equal(pulls, 3); assert.equal(cancelled, true);
});

test('a later unchanged write completes a publication lost after the private account committed', async () => {
  const f = await fixture(), members = createMembers(f.repo, f.env.PLATFORM_ORIGIN);
  const current = await f.repo.latest(`identity/users/${f.first.id}`);
  const revised = { ...current, revision: current.revision + 1, signature: '新的公开签名' };
  const lost = createMembers({ ...f.repo, putNew: async () => { throw new Error('synthetic interrupted publication'); } }, f.env.PLATFORM_ORIGIN);
  await assert.rejects(lost.publish(revised, current));
  const passwordChange = { ...revised, revision: revised.revision + 1 };
  await members.publish(passwordChange, revised);
  assert.equal((await members.get(current.id)).signature, revised.signature);
  const keys = await f.repo.list(`members/${current.id}/`);
  await members.publish({ ...passwordChange, revision: passwordChange.revision + 1 }, passwordChange);
  assert.deepEqual(await f.repo.list(`members/${current.id}/`), keys, 'unchanged public data does not create normal duplicate revisions');
});
