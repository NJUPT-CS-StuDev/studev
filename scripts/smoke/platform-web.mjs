// Isolated browser transport gates exercise the normal platform client while independent reads are pending.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pinnedCollections } from '../../src/platform/collections.mjs';
import { createPlatformHandler } from '../../src/platform/server/app.mjs';
import { collectionKeys } from '../../src/platform/server/collections/records.mjs';
import { createRepository } from '../../src/platform/server/store.mjs';
import { totpCode } from '../../src/platform/server/totp.mjs';
import { memoryBlob, memoryGateway, requestClient, testEnvironment } from '../../src/platform/tests/fixtures.mjs';
const origin = process.env.STUDEV_WEB_URL || 'http://127.0.0.1:4322';
const output = process.env.STUDEV_WEB_SMOKE_DIR || 'D:/Temp/codex/studev-web-experience';
await mkdir(output, {recursive:true});
const gate = () => { let release; const ready = new Promise(resolve => {release=resolve;}); return {ready,release}; };
const user = { id:'browser-test', studentId:'B240000', realName:'验收用户', nickname:'验收用户', qq:'', email:'', role:'admin', status:'active', profileComplete:true, identityVerified:true, revision:1, totpEnabled:false, mustChangePassword:false, signature:'' };
const current = {user,csrfToken:'browser-transport-test',mfaVerified:true};
const device = {id:'test-device',deviceName:'验收浏览器',createdAt:'2026-11-16T00:00:00Z',expiresAt:Date.parse('2026-12-16T00:00:00Z'),kind:'cookie',current:true};
const browser = await chromium.launch({channel:'msedge',headless:true});
const passed=[];
const record=value=>{passed.push(value);console.log(`ok  ${value}`);};
async function newPage(viewport) {
  const context=await browser.newContext({viewport,colorScheme:'dark',locale:'zh-CN',serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(15_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  return {context,page,errors};
}
async function shot(page,name){await page.screenshot({path:join(output,name+'.png'),animations:'disabled'});}

async function releasedCourses() {
  if (!process.argv.includes('--course')) return [];
  const release = JSON.parse(await readFile(new URL('../../src/data/campus-release.json', import.meta.url), 'utf8'));
  const file = new URL('../../public' + release.base + '/entities/information.json', import.meta.url);
  const { items } = JSON.parse(await readFile(file, 'utf8'));
  const facts = items.filter(item => item.subtype === 'information:course-plan' && /^[A-Z0-9]{6,16}$/.test(item.id.split('/').at(-1)) && item.names.length).slice(0, 2);
  assert.equal(facts.length, 2, 'the released campus facts contain two courses');
  return facts.map(({ id, names }) => ({ id, code: id.split('/').at(-1), name: names[0] }));
}

async function pickReleasedCourse(dialog, course) {
  const input = dialog.getByRole('searchbox', { name: /课程/ });
  const option = dialog.getByRole('button', { name: course.name + ' ' + course.code, exact: true });
  const started = performance.now();
  await input.fill(course.code);
  await option.waitFor({ timeout: 60_000 });
  const elapsed = Math.round(performance.now() - started);
  await option.click();
  await dialog.getByText(course.name + ' · ' + course.code, { exact: true }).waitFor();
  return elapsed;
}

const title = '统一收集验收';
const privateTitle = '仅指定成员的收集';
const expiredTitle = '已过截止的收集';
const stoppedTitle = '未设截止但已停止的收集';
const timedTitle = '即将截止的收集';
const pinnedTitles = ['地点拍照', '意见反馈', '补充校园数据'];
const memberName = '合成成员';
const peerSecret = '另一账号的私有答案';
const round = {
  id: 'round-one', label: '问卷填写', deadline: '', policy: 'strict', submissionMode: 'replace',
  fields: [{ id: 'answer', type: 'text', label: '填写内容', required: true }],
};
const roundPath = item => '/collections/items/' + item.id + '/rounds/' + round.id;

async function collectionFixture() {
  const { env, password } = await testEnvironment();
  const store = memoryBlob(), gateway = memoryGateway(), clock = Date.UTC(2026, 10, 22, 12);
  const handle = createPlatformHandler({ getStore: () => store, getGateway: () => gateway, now: () => clock });
  const client = () => requestClient(handle, env);
  const owner = client(), guest = client();
  const post = async (actor, path, body, status = 200) => {
    const result = await actor.call(path, { method: 'POST', body });
    assert.equal(result.status, status, path + ' ' + JSON.stringify(result.body.error || {}));
    return result.body;
  };
  const studentId = env.PLATFORM_OWNER_STUDENT_ID;
  const ownerPassword = password + '-new';
  await post(owner, '/auth/login', { studentId, password });
  await post(owner, '/auth/password', { currentPassword: password, newPassword: ownerPassword });
  await post(owner, '/auth/login', { studentId, password: ownerPassword });
  const setup = await post(owner, '/auth/totp/setup', { password: ownerPassword });
  await post(owner, '/auth/totp/confirm', { code: totpCode(setup.secret, Math.floor(clock / 30_000)) });
  const ownerState = await owner.call('/auth/session');
  await post(owner, '/auth/profile', { studentId, realName: env.PLATFORM_OWNER_REAL_NAME, revision: ownerState.body.user.revision });

  async function register(qq, name) {
    const actor = client(), sid = 'TEST' + qq;
    await post(actor, '/auth/register', { qq, nickname: name, studentId: sid, realName: name, password }, 201);
    await post(actor, '/auth/login', { studentId: sid, password });
    return { actor, sid };
  }
  const [member, peer] = await Promise.all([register('100002', memberName), register('100003', '合成同行成员')]);
  const catalog = await owner.call('/collections');
  assert.equal(catalog.status, 200);
  const { organizationId, title: issuerTitle } = catalog.body.issuerOptions[0];
  const common = { status: 'published', issuerOrganizationId: organizationId, issuerTitle, rounds: [round], tags: ['问卷验收'], term: '2026-2027-1' };
  const { item } = await post(owner, '/collections/items', { ...common, name: title, visibility: 'public' }, 201);
  await post(owner, '/collections/items', {
    ...common, name: '上学期课程收集', term: '2025-2026-2', visibility: 'public',
    course: { id: 'information/course-plan/CSX10001', code: 'CSX10001', name: '课程标签示例' },
    rounds: [round, { ...round, id: 'round-two', label: '第二批' }],
  }, 201);
  const { item: privateItem } = await post(owner, '/collections/items', {
    ...common, name: privateTitle, visibility: 'members', targetMode: 'selected', recipients: [{ studentId: member.sid, name: memberName }],
  }, 201);
  const deadline = new Date(clock - 60_000).toISOString();
  const { item: expired } = await post(owner, '/collections/items', { ...common, name: expiredTitle, visibility: 'public', rounds: [{ ...round, deadline, requireReview: true }] }, 201);
  const { item: stopped } = await post(owner, '/collections/items', { ...common, name: stoppedTitle, visibility: 'public', rounds: [{ ...round, policy: 'closed' }] }, 201);
  await post(owner, '/collections/items', { ...common, name: timedTitle, visibility: 'public', rounds: [{ ...round, deadline: new Date(clock + 4_000).toISOString() }] }, 201);
  const repo = createRepository(store, { secret: env.PLATFORM_SESSION_SECRET });
  const definition = await repo.latest(collectionKeys.definition(item.id));
  for (const [index, id] of pinnedCollections.entries()) {
    await repo.append(collectionKeys.definition(id), { ...definition, id, name: pinnedTitles[index], tags: [] });
  }
  const prior = await post(peer.actor, roundPath(item) + '/submissions', { answers: { answer: peerSecret }, files: [] }, 201);
  return { handle, env, owner, guest, member: member.actor, item, privateItem, expired, stopped, deadline, peerSubmission: prior.submission.id };
}

async function collections(page, fixture, actor, { identity, reads = [] } = {}) {
  await page.route('**/api/platform/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    reads.push({ path: url.pathname, method: request.method(), query: url.search });
    const path = url.pathname.slice('/api/platform'.length);
    if (path === '/auth/session' && identity) await identity.ready;
    const headers = new Headers(request.headers());
    headers.set('Origin', fixture.env.PLATFORM_ORIGIN);
    if (actor.cookie) headers.set('Cookie', actor.cookie);
    const result = await fixture.handle({
      request: new Request(fixture.env.PLATFORM_ORIGIN + url.pathname + url.search, {
        method: request.method(), headers, body: request.postDataBuffer() || undefined,
      }),
      env: fixture.env, clientIp: 'isolated-browser',
    });
    await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
  });
}

async function checkCollection(viewport, name) {
  const fixture = await collectionFixture();
  const { item, privateItem } = fixture;
  const guest = await newPage(viewport);
  const guestReads = [];
  await guest.page.addInitScript(() => { Date.now = () => Date.UTC(2040, 0, 1); });
  await collections(guest.page, fixture, fixture.guest, { reads: guestReads });
  await guest.page.goto(origin+'/search/');
  const nav = name === 'phone' ? guest.page.locator('.phone-tabs') : guest.page.locator('.site-nav');
  await nav.getByRole('link', { name: '收集', exact: true }).click();
  await guest.page.waitForURL(url => url.pathname === '/forms/');
  const parts = guest.page.locator('.cw-workspace');
  await parts.getByRole('heading', { name: '2026–2027 学年第一学期', exact: true }).waitFor();
  const elapsedRow = parts.getByRole('link', { name: new RegExp(expiredTitle) });
  const stoppedRow = parts.getByRole('link', { name: new RegExp(stoppedTitle) });
  const timedRow = parts.getByRole('link', { name: new RegExp(timedTitle) });
  await elapsedRow.getByText('已截止', { exact: true }).waitFor();
  await stoppedRow.getByText('已停止', { exact: true }).waitFor();
  await timedRow.getByText('收集中', { exact: true }).waitFor();
  const catalogReads = guestReads.filter(read => read.path === '/api/platform/collections').length;
  await timedRow.getByText('已截止', { exact: true }).waitFor();
  assert.equal(guestReads.filter(read => read.path === '/api/platform/collections').length, catalogReads, 'cutoff updates locally without polling or trusting the client wall clock');
  const pinned = parts.getByRole('region', { name: '常用收集' });
  await pinned.getByText('公开 · 登录后填写', { exact: true }).waitFor();
  for (const title of pinnedTitles) {
    await pinned.getByRole('link', { name: title, exact: true }).waitFor();
    assert.equal(await parts.getByRole('link', { name: title, exact: true }).count(), 1);
  }
  assert.equal((await fixture.guest.call('/collections/items/' + pinnedCollections[0] + '/rounds/' + round.id + '/submissions', { method: 'POST', body: { answers: { answer: '未登录提交' } } })).status, 401);
  assert.equal(await parts.getByRole('link', { name: new RegExp(privateTitle) }).count(), 0);
  assert.equal(await nav.getByRole('link', { name:'收集', exact: true }).getAttribute('aria-current'), 'page');
  assert.equal(await parts.getByRole('button', { name: '按标签', exact: true }).count(), 0);
  const search = parts.getByRole('searchbox', { name: '搜索收集' });
  await search.fill('问卷验收');
  await parts.getByRole('link', { name: new RegExp(title) }).waitFor();
  assert.equal(await pinned.count(), 0);
  await search.clear();
  const width = await parts.boundingBox();
  assert(width && width.width >= (name === 'phone' ? viewport.width - 48 : 1100), 'collection list uses the available screen');
  assert(await guest.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'collection list has no horizontal page overflow');
  assert.deepEqual(await parts.locator('.cw-group h2').allTextContents(), ['常用收集', '2026–2027 学年第一学期', '2025–2026 学年第二学期']);
  assert.deepEqual(await pinned.locator('.cw-card-title').allTextContents(), pinnedTitles, 'fixed shortcuts keep stable order');
  const earlierCard = parts.getByRole('link', { name: '上学期课程收集', exact: true });
  await earlierCard.getByText('CSX10001', { exact: true }).waitFor();
  await earlierCard.getByText('2 个批次', { exact: true }).waitFor();
  const cards = parts.locator('.cw-group').nth(1).locator('.cw-card');
  const columns = () => cards.first().locator('..').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  assert.equal(await columns(), name === 'phone' ? 1 : 3);
  const [first, second, third] = await Promise.all([0, 1, 2].map(index => cards.nth(index).boundingBox()));
  assert(first && second && third);
  if (name === 'phone') {
    assert(first.x === second.x && second.x === third.x && first.y < second.y && second.y < third.y);
  } else {
    assert(first.y === second.y && second.y === third.y && first.x < second.x && second.x < third.x);
    assert(first.width + second.width + third.width >= width.width - 32);
    await guest.page.setViewportSize({ width: 900, height: 900 });
    assert.equal(await columns(), 2);
    const [left, right, next] = await Promise.all([0, 1, 2].map(index => cards.nth(index).boundingBox()));
    assert(left && right && next && left.y === right.y && left.x < right.x && left.x === next.x && next.y > left.y);
    assert(await guest.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await guest.page.setViewportSize(viewport);
  }
  await shot(guest.page, name + '-collection-catalog');
  await parts.getByRole('link', { name: title, exact: true }).press('Enter');
  await parts.getByRole('heading', { name: title, exact: true }).waitFor();
  const login = parts.getByRole('link', { name: '登录后填写' });
  assert.equal(new URL(await login.getAttribute('href'), origin).searchParams.get('next'), '/forms/?id=' + item.id);
  assert(await parts.getByRole('textbox', { name: /^填写内容/ }).isDisabled());
  assert.equal(await parts.getByText(peerSecret).count(), 0);
  assert.equal(guestReads.filter(read => read.path === '/api/platform/auth/session').length, 0);
  const secret = await fixture.guest.call('/collections/submissions/' + fixture.peerSubmission);
  assert.equal(secret.status, 401);
  await guest.page.goto(origin + '/forms/?id=' + privateItem.id);
  await parts.getByRole('alert').filter({ hasText: /不存在或无权查看/ }).waitFor();
  assert.deepEqual(guest.errors, []);
  await guest.context.close();

  const member = await newPage(viewport), identity = gate(), memberReads = [];
  await collections(member.page, fixture, fixture.member, { identity, reads: memberReads });
  await member.page.goto(origin + '/forms/?id=' + item.id + '&a.answer=' + encodeURIComponent('地图预填内容'));
  const memberParts = member.page.locator('.cw-workspace');
  const answer = memberParts.getByRole('textbox', { name: /^填写内容/ });
  await answer.waitFor();
  assert.equal(memberReads.filter(read => read.path === '/api/platform/collections').length, 0, 'a direct collection link loads just its detail');
  assert.equal(await answer.inputValue(), '地图预填内容');
  assert.equal(await memberParts.getByRole('button', { name: '收集设置' }).count(), 0);
  assert.equal(await memberParts.getByText(peerSecret).count(), 0);
  assert.equal(memberReads.filter(read => read.path === '/api/platform/auth/session').length, 0);
  await answer.fill('登录验证期间保留这段内容');
  await memberParts.getByRole('button', { name: '提交', exact: true }).click();
  await memberParts.getByRole('button', { name: /正在提交/ }).waitFor();
  assert.equal(await answer.inputValue(), '登录验证期间保留这段内容');
  assert.equal(memberReads.filter(read => read.method === 'POST').length, 0);
  try {
    assert(await memberParts.getByRole('button', { name: /正在提交/ }).isDisabled());
  } finally {
    identity.release();
  }
  await memberParts.getByText('登录验证期间保留这段内容', { exact: true }).waitFor();
  assert.equal(memberReads.filter(read => read.path === '/api/platform/auth/session').length, 1);
  assert.equal(memberReads.filter(read => read.method === 'POST').length, 1, 'plain answers save with one write');
  assert.equal(memberReads.filter(read => read.path === '/api/platform/sync').length, 0);
  assert.equal((await fixture.member.call('/collections/submissions/' + fixture.peerSubmission)).status, 404);
  await member.page.reload();
  await memberParts.getByText('登录验证期间保留这段内容', { exact: true }).waitFor();
  await shot(member.page, name + '-collection-own-submission');
  await memberParts.getByRole('combobox', { name: '视角' }).selectOption('guest');
  await memberParts.getByText(/正在预览访客视角/).waitFor();
  assert.equal(await memberParts.getByText('登录验证期间保留这段内容', { exact: true }).count(), 0);
  assert.equal(await memberParts.getByRole('button', { name: '提交', exact: true }).count(), 0);
  await memberParts.getByRole('link', { name: '全部收集' }).click();
  await memberParts.getByRole('link', { name: new RegExp(title) }).waitFor();
  assert.equal(await memberParts.getByRole('link', { name: new RegExp(privateTitle) }).count(), 0);
  await memberParts.getByRole('combobox', { name: '视角' }).selectOption('user');
  await memberParts.getByRole('link', { name: new RegExp(privateTitle) }).waitFor();
  await memberParts.getByRole('link', { name: '我的提交' }).click();
  await memberParts.getByRole('heading', { name: '我的提交', exact: true }).waitFor();
  await memberParts.getByRole('link', { name: new RegExp(title) }).waitFor();
  assert.deepEqual(member.errors, []);
  await member.context.close();
  record(name + ': pinned card order, responsive card grid, semester chronology, one write and participant privacy');

  if (name === 'desktop') {
    const staff = await newPage(viewport), staffReads = [];
    await collections(staff.page, fixture, fixture.owner, { reads: staffReads });
    await staff.page.goto(origin + '/forms/');
    const staffParts = staff.page.locator('.cw-workspace');
    await staffParts.getByRole('button', { name: '新建收集' }).click();
    const dialog = staff.page.getByRole('dialog', { name: '新建收集' });
    await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('统一入口的草稿');
    await dialog.getByRole('textbox', { name: /字段名称|字段标题/ }).fill('草稿字段');
    const [firstCourse, course] = await releasedCourses();
    let courseTiming;
    if (course) {
      const firstMs = await pickReleasedCourse(dialog, firstCourse);
      await dialog.getByRole('button', { name: '移除课程' }).click();
      courseTiming = { firstMs, nextCodeMs: await pickReleasedCourse(dialog, course) };
    }
    const draftResponse = staff.page.waitForResponse(response => response.url().endsWith('/api/platform/collections/items') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '保存草稿' }).click();
    const savedDraft = await draftResponse;
    assert.equal(savedDraft.status(), 201, JSON.stringify((await savedDraft.json()).error || {}));
    await staffParts.getByRole('heading', { name: '统一入口的草稿', exact: true }).waitFor();
    const draftId = new URL(staff.page.url()).searchParams.get('id');
    assert(draftId, 'draft has a canonical collection URL');
    if (course) {
      const saved = await fixture.owner.call('/collections/items/' + draftId);
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.body.item.course, course);
      record('real WASM course-code search and saved campus fact ID ' + JSON.stringify(courseTiming));
    }
    assert.equal((await fixture.guest.call('/collections/items/' + draftId)).status, 404);
    await staffParts.getByRole('button', { name: '新增批次' }).click();
    const addRound = staff.page.getByRole('dialog', { name: '新增批次' });
    await addRound.getByRole('textbox', { name: '批次名称' }).fill('草稿的第二轮');
    await addRound.getByRole('textbox', { name: '字段名称' }).fill('第二轮字段');
    await addRound.getByRole('button', { name: '保存', exact: true }).click();
    await staffParts.getByRole('heading', { name: '草稿的第二轮', exact: true }).waitFor();
    assert(new URL(staff.page.url()).searchParams.has('round'));
    await staffParts.getByRole('button', { name: '删除草稿', exact: true }).click();
    const deleteDraft = staff.page.getByRole('dialog', { name: '删除草稿' });
    await deleteDraft.getByRole('button', { name: '删除草稿', exact: true }).click();
    await staffParts.getByText('草稿已删除', { exact: true }).waitFor();
    assert.equal((await fixture.owner.call('/collections/items/' + draftId)).status, 404);
    await staff.page.goto(origin + '/forms/?id=' + item.id);
    const peerRow = staffParts.getByRole('row', { name: /合成同行成员/ });
    await peerRow.getByRole('button', { name: '查看', exact: true }).click();
    const receipt = staff.page.getByRole('dialog', { name: '提交详情' });
    await receipt.getByText(peerSecret, { exact: true }).waitFor();
    await receipt.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(staffReads.filter(read => read.method === 'GET' && read.path === '/api/platform' + roundPath(item) + '/submissions').length, 1);
    assert(!staffReads.some(read => read.query.includes('board=1')));
    await shot(staff.page, name + '-collection-board');
    await staffParts.getByRole('button', { name: /修改截止时间/ }).click();
    const deadline = staff.page.getByRole('dialog', { name: '截止时间' });
    await deadline.getByText('到期自动停止收集。留空则由管理者手动停止。').waitFor();
    await deadline.getByRole('button', { name: '取消' }).click();

    await staff.page.goto(origin + '/forms/?id=' + fixture.stopped.id);
    await staffParts.locator('.cw-detail-head').getByText('已停止', { exact: true }).waitFor();
    await staffParts.getByRole('button', { name: /修改截止时间.*未设截止时间/ }).waitFor();
    await staffParts.getByRole('button', { name: '恢复收集', exact: true }).click();
    await staffParts.locator('.cw-detail-head').getByText('收集中', { exact: true }).waitFor();
    await staffParts.getByRole('button', { name: '停止收集', exact: true }).click();
    await staffParts.locator('.cw-detail-head').getByText('已停止', { exact: true }).waitFor();
    assert.equal((await fixture.owner.call('/collections/items/' + fixture.stopped.id)).body.item.rounds[0].deadline, '');

    await staff.page.goto(origin + '/forms/?id=' + fixture.expired.id);
    await staffParts.locator('.cw-detail-head').getByText('已截止', { exact: true }).waitFor();
    await staffParts.locator('.cw-round-head').getByText('已截止', { exact: true }).waitFor();
    const cutoff = await staffParts.getByRole('button', { name: /修改截止时间/ }).innerText();
    await staffParts.getByRole('button', { name: '开放补交', exact: true }).click();
    await staffParts.locator('.cw-detail-head').getByText('补交中', { exact: true }).waitFor();
    assert.equal(await staffParts.getByRole('button', { name: /修改截止时间/ }).innerText(), cutoff);
    const reopened = await fixture.owner.call('/collections/items/' + fixture.expired.id);
    assert.equal(reopened.body.item.rounds[0].deadline, fixture.deadline);
    const lateMember = await newPage(viewport);
    await collections(lateMember.page, fixture, fixture.member);
    await lateMember.page.goto(origin + '/forms/?id=' + fixture.expired.id);
    const lateParts = lateMember.page.locator('.cw-workspace');
    await lateParts.getByText('本次提交将记为补交。', { exact: true }).waitFor();
    await lateParts.getByRole('textbox', { name: /^填写内容/ }).fill('补交验收答案');
    await lateParts.getByRole('button', { name: '提交补交', exact: true }).click();
    const lateReceipt = lateParts.locator('.cw-receipt');
    await lateReceipt.getByText('补交', { exact: true }).waitFor();
    await lateReceipt.getByText('待审核', { exact: true }).waitFor();
    await lateReceipt.getByText('补交验收答案', { exact: true }).waitFor();
    assert.deepEqual(lateMember.errors, []);
    await lateMember.context.close();
    await staffParts.getByRole('button', { name: '停止补交', exact: true }).click();
    await staffParts.locator('.cw-detail-head').getByText('已截止', { exact: true }).waitFor();
    const restopped = await fixture.owner.call('/collections/items/' + fixture.expired.id);
    assert.equal(restopped.body.item.rounds[0].deadline, fixture.deadline);
    assert.equal(restopped.body.item.rounds[0].policy, 'strict');
    assert.equal(restopped.body.item.rounds[0].open, false);
    record('desktop: automatic cutoff, manually stopped legacy rounds, reopen and stop makeup without moving the deadline');
    await staff.page.goto(origin + '/forms/?id=' + item.id);
    await staffParts.getByRole('combobox', { name: '视角' }).selectOption('user');
    await staffParts.getByText(/正在预览用户视角/).waitFor();
    assert.equal(await staffParts.getByRole('button', { name: '收集设置' }).count(), 0);
    assert.equal(await staffParts.getByText(peerSecret).count(), 0);
    await staffParts.getByRole('combobox', { name: '视角' }).selectOption('owner');
    await staffParts.getByRole('button', { name: '取消发布', exact: true }).click();
    const unpublish = staff.page.getByRole('dialog', { name: '取消发布' });
    await unpublish.getByRole('button', { name: '取消发布', exact: true }).click();
    await staffParts.getByRole('button', { name: '删除草稿', exact: true }).waitFor();
    assert.equal((await fixture.guest.call('/collections/items/' + item.id)).status, 404);
    const previous = await fixture.member.call('/collections/items/' + item.id);
    assert.equal(previous.status, 200);
    assert.equal(previous.body.mySubmissions[0].answers.answer, '登录验证期间保留这段内容');
    assert.deepEqual(staff.errors, []);
    await staff.context.close();
    record('desktop: owner creates and deletes a draft, edits deadlines, previews user view and withdraws a published collection');
  }
}
const layouts = [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 1000 }]];
try {
  for (const [name, viewport] of layouts) await checkCollection(viewport, name);
  for (const [name, viewport] of layouts) {
    const account=await newPage(viewport), counts={session:0,devices:0,members:0},unexpected=[];
    let deviceGate=null, failAccount=false;
    await account.page.route('**/api/platform/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith('/auth/session')){counts.session++;await route.fulfill(failAccount?{status:503,json:{error:{message:'账号读取暂时中断。'}}}:{json:current});}
      else if(path.endsWith('/auth/devices')){counts.devices++;if(deviceGate)await deviceGate.ready;await route.fulfill({json:{items:[device]}});}
      else if(path.endsWith('/admin/users')){counts.members++;await route.fulfill({json:{items:[]}});}
      else {unexpected.push(path);await route.fulfill({status:404,json:{error:{message:'Unexpected platform read'}}});}
    });
    await account.page.goto(origin+'/account/');
    await account.page.getByRole('heading',{name:'我的账号',exact:true}).waitFor();
    await account.page.locator('[data-me]').waitFor();
    assert.equal(await account.page.locator('[data-me]').count(), 1, 'the account page keeps the single shared header control');
    assert.equal(new URL(account.page.url()).pathname,'/account/','a real session is not rejected for missing localStorage hints');
    assert.deepEqual(counts,{session:1,devices:0,members:0},'profile does not fetch devices or the staff roster');
    await shot(account.page,`${name}-account-profile`);
    await account.page.getByRole('tab',{name:'账号安全',exact:true}).click();
    await account.page.getByRole('heading',{name:'账号安全',exact:true}).waitFor();
    assert(await account.page.locator('[data-profile-form]').isHidden());
    await shot(account.page,`${name}-account-security`);
    await account.page.getByRole('tab',{name:'登录设备',exact:true}).click();
    await account.page.locator('[data-account-devices] h3').waitFor();
    assert.equal(counts.devices,1);
    deviceGate=gate();
    await account.page.getByRole('button',{name:'刷新设备',exact:true}).click();
    await account.page.getByText('正在刷新设备…',{exact:true}).waitFor();
    assert(await account.page.locator('[data-account-devices] h3').isVisible(),'previous device rows remain visible during refresh');
    assert(await account.page.getByRole('button',{name:'刷新设备',exact:true}).isDisabled());
    deviceGate.release();deviceGate=null;
    await account.page.waitForFunction(()=>!document.querySelector('[data-devices-refresh]').disabled);
    await account.page.getByRole('button',{name:'退出此设备',exact:true}).click();
    await account.page.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(counts.devices,2,'cancel restores the row without another read');
    await account.page.getByRole('tab',{name:'我的账号',exact:true}).click();
    await account.page.getByRole('tab',{name:'登录设备',exact:true}).click();
    assert.equal(counts.devices,2,'reopening the loaded panel shares its current contents');
    await shot(account.page,`${name}-account-devices`);
    failAccount=true;
    await account.page.goto(origin+'/account/');
    await account.page.getByRole('button',{name:'重新读取账号',exact:true}).waitFor();
    assert(await account.page.locator('[data-account-status]').isVisible(),'account failures are visible');
    failAccount=false;
    await account.page.getByRole('button',{name:'重新读取账号',exact:true}).click();
    await account.page.getByRole('heading',{name:'我的账号',exact:true}).waitFor();
    assert.deepEqual(account.errors,[]);assert.deepEqual(unexpected,[],'closed account avatar does not start unrelated campus synchronization');await account.context.close();
    record(`${name}: account tabs, lazy device/roster reads, preserved rows, cancel without fetch and visible failure retry`);

    const visual=await newPage(viewport);
    await visual.page.goto(origin+'/search/');
    await visual.page.getByRole('textbox',{name:'搜索',exact:true}).waitFor();
    if(name==='phone') {
      const search=await visual.page.locator('.sfield').boundingBox(), avatar=await visual.page.locator('[data-me]').boundingBox();
      assert(Math.abs(search.y+search.height/2-avatar.y-avatar.height/2)<1,'search and avatar share one centre');
      assert.equal(search.height,36);assert(search.x+search.width<=avatar.x);
    }
    await shot(visual.page,`${name}-search-shared-components`);
    const picture = gate();
    await visual.page.route('https://q1.qlogo.cn/**', async route => {
      await picture.ready;
      await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="blue"/></svg>'});
    });
    await visual.page.evaluate(()=>{
      localStorage.setItem('studev_auth_user',JSON.stringify({nickname:'测试最长显示昵称',role:'user',qq:'123456789',verifiedAt:Date.now()}));
      window.dispatchEvent(new Event('studev:account'));
    });
    await visual.page.reload({waitUntil:'domcontentloaded'});
    await visual.page.getByRole('button',{name:'测试最长显示昵称，打开我',exact:true}).waitFor();
    assert.equal(await visual.page.locator('[data-me-face]').innerText(),'测','the cached nickname and initial stay visible while the avatar downloads');
    if(name==='phone') {
      const search=await visual.page.locator('.sfield').boundingBox(), avatar=await visual.page.locator('[data-me]').boundingBox();
      assert(search.x+search.width<=avatar.x,'the longest displayed nickname still has its own header space');
      await shot(visual.page,`${name}-search-long-name`);
    }
    const visiblePhoto = visual.page.locator('[data-me-face] img');
    assert(await visiblePhoto.isHidden(),'waiting for the photo does not leave an empty avatar');
    picture.release();
    await visiblePhoto.waitFor();
    await visual.page.evaluate(()=>{
      localStorage.removeItem('studev_auth_user');
      window.dispatchEvent(new Event('studev:account'));
    });
    await visual.page.getByRole('button',{name:'未登录，打开我',exact:true}).waitFor();
    assert.equal(await visual.page.locator('[data-me-face] svg').count(),1,'sign-out restores the anonymous face');
    assert.deepEqual(visual.errors,[]);await visual.context.close();
    record(`${name}: search geometry and shared component visual evidence`);
  }
  await writeFile(join(output,'platform-result.json'),JSON.stringify({origin,passed},null,2));
} finally {await browser.close();}
