// Use the built site in an isolated Edge context; changes touch this test's local preferences only.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { inspectAiTrace } from './ai-web.mjs';

const root = resolve(import.meta.dirname, '../..');
const origin = new URL(process.env.STUDEV_WEB_URL || 'http://127.0.0.1:4322');
const output = process.env.STUDEV_WEB_SMOKE_DIR || 'D:\\Temp\\codex\\studev-web-experience';
await mkdir(output, { recursive: true });
const release = JSON.parse(await readFile(join(root, 'src/data/campus-release.json'), 'utf8'));
const knowledge = JSON.parse(await readFile(join(root, `public${release.base}/knowledge/knowledge.json`), 'utf8'));
const teaching = JSON.parse(await readFile(join(root, `public${release.base}/teaching/${release.teaching}/classes.json`), 'utf8'));
const person = teaching.find(item => item.id === 'B240402');
assert(person, 'The released class is available for the actual UI test');
const military = knowledge.topics.find(topic => topic.id === '军事理论/现代国防观');
assert(military);
const groups = new Map();
for (const ref of military.references) groups.set(ref.material, [...(groups.get(ref.material) || []), ref]);
const [materialPath, references] = [...groups].sort((left, right) => right[1].length - left[1].length)[0];
const material = knowledge.materials.find(item => item.path === materialPath);
const sports = knowledge.courses.find(item => item.name === '体育理论');
assert(material && sports && references.length > 3);

const results = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const timeout = 30_000;
let active;
const log = step => { results.push(step); console.log(`ok  ${step}`); };
async function prefs(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('studev_prefs') || '{}')); }
async function screenshot(page, name) { await page.screenshot({ path: join(output, `${name}.png`), fullPage: false, animations: 'disabled' }); }
async function closeSheet(page) { await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).last().click(); }
async function heading(page, name) { await page.getByRole('heading', { name, exact: true, level: 2 }).waitFor({ state: 'visible' }); }
async function openCourses(page) {
    await page.locator('[data-me]').click();
    await heading(page, '我');
    await page.getByRole('dialog').getByRole('button', { name: /^课表设置/ }).click();
    await heading(page, '课表设置');
    await page.getByRole('dialog').getByRole('button', { name: /^我的课程/ }).click();
    await heading(page, '我的课程');
    await page.getByRole('button', { name: /^查看课程详情：/ }).first().waitFor({ state: 'visible' });
}
async function selectValue(page, label, value) {
    await page.waitForFunction(({ label, value }) => [...document.querySelectorAll('.kn-filter-fields label')]
        .find(item => item.firstChild?.textContent === label)?.querySelector('select')?.value === value, { label, value });
}
async function openFilters(page) {
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await heading(page, '筛选课程');
}
async function knowledgeScope(page, cohort, major) {
    await page.waitForFunction(({ cohort, major }) => document.querySelector('.kn-scope')?.textContent?.includes(`${cohort}级 · ${major}`), { cohort, major });
}
async function closeFilters(page) {
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
}
async function compactFilters(page, name) {
    await knowledgeScope(page, person.grade, person.major);
    assert.equal(await page.getByRole('combobox').count(), 0, 'catalogue filters do not occupy the main page');
    await screenshot(page, `${name}-knowledge-catalogue`);
    const before = page.url();
    await openFilters(page);
    await selectValue(page, '入学年份', person.grade); await selectValue(page, '专业', person.major);
    for (const label of ['入学年份', '专业', '学年', '课程类别', '修读要求'])
        assert.equal(await page.getByRole('combobox', { name: label, exact: true }).count(), 1);
    async function setDraft() {
        await page.getByRole('combobox', { name: '入学年份', exact: true }).selectOption('2026');
        await page.getByRole('combobox', { name: '专业', exact: true }).selectOption('软件工程');
        await page.getByRole('combobox', { name: '学年', exact: true }).selectOption('大二');
        await page.getByRole('combobox', { name: '课程类别', exact: true }).selectOption('专业课');
        await page.getByRole('combobox', { name: '修读要求', exact: true }).selectOption('必修');
    }
    await setDraft();
    assert.equal(page.url(), before, 'draft changes do not write the page address');
    await knowledgeScope(page, person.grade, person.major);
    await closeFilters(page);
    assert.equal(page.url(), before, 'cancel leaves all filters unchanged');
    await openFilters(page);
    await selectValue(page, '入学年份', person.grade); await selectValue(page, '专业', person.major);
    await setDraft();
    await screenshot(page, `${name}-knowledge-filter-sheet`);
    await page.getByRole('button', { name: '应用筛选', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await knowledgeScope(page, '2026', '软件工程');
    assert.equal(new URL(page.url()).searchParams.get('grade'), '大二');
    assert.equal(new URL(page.url()).searchParams.get('category'), '专业课');
    assert.equal(new URL(page.url()).searchParams.get('nature'), '必修');
    assert((await page.locator('.kn-scope').innerText()).includes('3 项筛选'));
    await page.goBack();
    await knowledgeScope(page, person.grade, person.major);
    assert.equal(await page.getByRole('dialog').count(), 0, 'Back reaches the prior page without an overlay');
    await page.goForward();
    await knowledgeScope(page, '2026', '软件工程');
    assert.equal(await page.getByRole('dialog').count(), 0, 'Forward keeps the applied scope without a ghost sheet');
    const applied = page.url();
    await openFilters(page);
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await selectValue(page, '入学年份', person.grade); await selectValue(page, '专业', person.major); await selectValue(page, '学年', '全部');
    assert.equal(page.url(), applied, 'reset only changes the draft until applied');
    await closeFilters(page);
    await knowledgeScope(page, '2026', '软件工程');
    await openFilters(page);
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await page.getByRole('button', { name: '应用筛选', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await knowledgeScope(page, person.grade, person.major);
    for (const key of ['cohort', 'major', 'grade', 'category', 'nature']) assert(!new URL(page.url()).searchParams.has(key), `reset restores inherited ${key}`);
    for (const explicit of [{ cohort: '2026' }, { major: '软件工程' }]) {
        await goto(page, '/knowledge/?' + new URLSearchParams(explicit));
        await knowledgeScope(page, explicit.cohort ?? person.grade, explicit.major ?? person.major);
        await openFilters(page);
        await page.getByRole('combobox', { name: '学年', exact: true }).selectOption('大一');
        await page.getByRole('button', { name: '应用筛选', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        const current = new URL(page.url()).searchParams;
        assert.equal(current.get('grade'), '大一');
        assert.equal(current.get('cohort'), explicit.cohort ?? null, 'applying an advanced filter preserves year inheritance independently');
        assert.equal(current.get('major'), explicit.major ?? null, 'applying an advanced filter preserves major inheritance independently');
    }
    await goto(page, '/knowledge/');
    await knowledgeScope(page, person.grade, person.major);
    log(`${name}: compact filters, draft cancellation, one apply, Back/Forward and reset to class defaults`);
}
async function referenceCount(page, expected) {
    await page.waitForFunction(({ title, expected }) => [...document.querySelectorAll('.kn-refs')]
        .find(group => group.querySelector('.kn-ref-head b')?.textContent === title)?.querySelectorAll('.kn-ref-list button').length === expected,
    { title: material.title, expected });
}
async function goto(page, path) {
    const response = await page.goto(new URL(path, origin).href, { waitUntil: 'domcontentloaded' });
    assert.equal(response?.status(), 200, path);
}

async function noAvatarOverlap(page, selector) {
    if (page.viewportSize().width >= 1000) return;
    const collisions = await page.evaluate(selector => {
        const avatar = document.querySelector('[data-me]').getBoundingClientRect();
        return [...document.querySelectorAll(selector)].flatMap(element => {
            const box = element.getBoundingClientRect();
            return box.width && box.height && Math.min(avatar.right, box.right) > Math.max(avatar.left, box.left)
                && Math.min(avatar.bottom, box.bottom) > Math.max(avatar.top, box.top) ? [element.textContent || element.getAttribute('aria-label') || selector] : [];
        });
    }, selector);
    assert.deepEqual(collisions, [], `the login entry must not cover ${selector}`);
}

async function headerAligned(page, selector) {
    if (page.viewportSize().width >= 1000) return;
    await page.locator(selector).waitFor({ state: 'visible' });
    const delta = await page.evaluate(selector => {
        const avatar = document.querySelector('[data-me]').getBoundingClientRect();
        const entry = document.querySelector(selector).getBoundingClientRect();
        return entry.y + entry.height / 2 - avatar.y - avatar.height / 2;
    }, selector);
    assert(Math.abs(delta) <= 1, `the campus header and account entry share a centre line: ${selector}, difference ${delta}px`);
}

async function sheetHistory(page, name) {
    const baseLength = await page.evaluate(() => history.length);
    await openCourses(page);
    assert.equal(await page.evaluate(() => history.length), baseLength + 1, 'nested settings share one overlay history entry');
    await page.getByRole('button', { name: /^查看课程详情：/ }).first().click();
    await page.getByRole('heading', { name: '上课安排', exact: true }).waitFor();
    await page.goBack();
    await heading(page, '我的课程');
    assert.equal(await page.evaluate(() => history.length), baseLength + 1);
    await page.getByRole('button', { name: '自定义课程', exact: true }).click();
    await heading(page, '自定义课程');
    await page.keyboard.press('Escape');
    await heading(page, '我的课程');
    await closeSheet(page);
    await heading(page, '课表设置');
    // Reopen on the DOM removal itself, while the outgoing owner's history traversal can still be pending.
    await page.evaluate(() => new Promise(resolve => {
        const observer = new MutationObserver(() => {
            if (document.querySelector('[role="dialog"]')) return;
            observer.disconnect();
            document.querySelector('[data-me]').click();
            resolve();
        });
        observer.observe(document.body, { subtree: true, childList: true });
        document.querySelector('[role="dialog"] .x').click();
    }));
    await heading(page, '我');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await heading(page, '我');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !history.state?.sheet);

    await openCourses(page);
    await page.getByRole('link', { name: '从全校课程添加', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索', exact: true }).waitFor();
    await noAvatarOverlap(page, '.search .sfield');
    await page.goBack();
    await page.locator('.sd.timetable-page').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.goForward();
    assert.equal(new URL(page.url()).pathname, '/search/');
    await page.getByRole('textbox', { name: '搜索', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);

    if (page.viewportSize().width < 1000) {
        await goto(page, '/knowledge/?topic=' + encodeURIComponent(military.id));
        await heading(page, military.title);
        await noAvatarOverlap(page, '.kn-course-switch');
        await page.getByRole('button', { name: /课程目录$/ }).click();
        await page.getByRole('dialog').locator('.kn-course-head').click();
        await page.waitForURL(url => url.searchParams.get('course') === military.taught_by[0] && !url.searchParams.has('topic'));
        assert.equal(await page.getByRole('dialog').count(), 0);
        await page.goBack();
        await page.waitForURL(url => url.searchParams.get('topic') === military.id);
        await heading(page, military.title);
        assert.equal(await page.getByRole('dialog').count(), 0);
        await page.goForward();
        await page.waitForURL(url => url.searchParams.get('course') === military.taught_by[0] && !url.searchParams.has('topic'));
        assert.equal(await page.getByRole('dialog').count(), 0);
    }
    await goto(page, '/');
    log(`${name}: nested sheet handoff, Back/Escape, rapid reopen and real-page Back/Forward`);
}

async function mapAvailability(name, viewport) {
    const roomIndex = JSON.parse(await readFile(join(root, `public${release.base}/rooms/index.json`), 'utf8'));
    const knownDate = roomIndex.weeks[Math.floor(roomIndex.weeks.length / 2)].start;
    const failedDate = new Date(Date.parse(`${knownDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    for (const date of [knownDate, failedDate]) {
        const published = JSON.parse(await readFile(join(root, `public${release.base}/rooms/${roomIndex.term}/${date}.json`), 'utf8'));
        assert.equal(published.date, date, 'availability tests use actual published day files');
    }
    const context = await browser.newContext({ viewport, colorScheme: 'dark', locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('studev_ball_hinted', '1'));
    const page = await context.newPage();
    const previous = active; active = page;
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let releaseRequest;
    const pending = new Promise(resolve => { releaseRequest = resolve; });
    let failedRequests = 0;
    const dayUrl = new URL(`${release.base}/rooms/${roomIndex.term}/${failedDate}.json`, origin).href;
    await page.route(dayUrl, async route => {
        failedRequests++;
        await pending;
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Deliberate day-file availability test' });
    });
    const mapUrl = (date, place) => new URL(`/map/?t=${date}T08:00${place ? `&place=${encodeURIComponent(place)}&f=1` : ''}`, origin).href;
    const unknown = '暂无这一天的排课数据';
    async function unknownOccupancy() {
        await page.locator('.mbody').getByText(unknown, { exact: true }).waitFor({ state: 'visible' });
        const text = await page.locator('.mbody').innerText();
        assert(!/\d+\s*\/\s*\d+ 间空闲|这一层此刻没有空教室|\d+ 间空教室/.test(text), 'an unavailable day never means zero free classrooms');
        assert.equal(await page.locator('.labels .lb.teach .n').count(), 0, 'unknown occupancy has no numeric building labels');
    }
    try {
        await page.goto(mapUrl(knownDate, '仙林/教3'));
        await page.locator('.mbody .msum').filter({ hasText: /\d+\s*\/\s*\d+ 间空闲/ }).waitFor({ state: 'visible' });
        await page.locator('.floors button').first().waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelectorAll('.labels .lb.teach .n').length > 0);
        assert(await page.locator('.labels .lb.teach .n').count() > 0, 'known day occupancy still produces actual free counts');
        const frames = page.evaluate(async date => {
            const observed = [];
            for (let frame = 0; frame < 30; frame++) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                if (new URL(location.href).searchParams.get('t')?.startsWith(date)) observed.push({
                    text: document.querySelector('.mbody')?.textContent || '',
                    counts: document.querySelectorAll('.labels .lb.teach .n').length,
                });
            }
            return observed;
        }, failedDate);
        await page.getByRole('button', { name: '后一天', exact: true }).click();
        await page.waitForURL(url => url.searchParams.get('t')?.startsWith(failedDate));
        await unknownOccupancy();
        const observed = await frames;
        assert(observed.length > 0, 'the unavailable day is observed while its request is still pending');
        for (const frame of observed) {
            assert(!/\d+\s*\/\s*\d+ 间空闲|这一层此刻没有空教室/.test(frame.text), 'date changes do not flash the previous day as current availability');
            assert.equal(frame.counts, 0, 'loading a different day never flashes numeric building counts');
        }
        const failedResponse = page.waitForResponse(response => response.url() === dayUrl && response.status() === 503);
        releaseRequest();
        await failedResponse;
        await unknownOccupancy();
        await page.locator('.floors').getByRole('button', { name: '2', exact: true }).click();
        await page.locator('.mbody h2').filter({ hasText: '教3 2 层' }).waitFor({ state: 'visible' });
        await unknownOccupancy();
        assert.equal(await page.getByRole('link', { name: '整栋楼的安排', exact: true }).count(), 1, 'building browsing remains available without day occupancy');
        await screenshot(page, `${name}-map-day-unavailable`);

        await page.goto(mapUrl(failedDate, '仙林/教3-101'));
        await unknownOccupancy();
        assert.equal(await page.getByRole('button', { name: '去这里', exact: true }).count(), 1, 'room navigation remains available without day occupancy');
        await page.goto(mapUrl(failedDate));
        await unknownOccupancy();
        assert((await page.locator('.mbody').innerText()).includes('此刻可以去'), 'campus recommendations remain available without day occupancy');
        assert(failedRequests >= 3, 'building, room and campus-summary checks each exercise the actual unavailable day request');
        assert.deepEqual(errors, [], 'unavailable room-day requests cause no JavaScript errors');
        log(`${name}: real room-day loading/503 stays unknown across building, room and campus summary without false zero counts`);
    } finally {
        releaseRequest();
        await context.close(); active = previous;
    }
}

try {
    for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 1000 }]]) {
        const context = await browser.newContext({ viewport, colorScheme: 'dark', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
        await context.addInitScript(() => {
            if (!localStorage.getItem('studev_prefs')) localStorage.setItem('studev_prefs', JSON.stringify({ class: 'B240402', appearance: 'dark' }));
        });
        const page = await context.newPage(); active = page;
        page.setDefaultTimeout(timeout);
        const errors = [];
        const dataErrors = [];
        page.on('pageerror', error => errors.push(error.stack || error.message));
        page.on('response', response => {
            const url = new URL(response.url());
            if (url.origin === origin.origin && url.pathname.startsWith('/data/') && response.status() >= 400) dataErrors.push(`${response.status()} ${url.pathname}`);
        });
        page.on('requestfailed', request => {
            const url = new URL(request.url());
            if (url.origin === origin.origin && url.pathname.startsWith('/data/') && !request.failure()?.errorText.includes('ERR_ABORTED')) dataErrors.push(`${request.failure()?.errorText} ${url.pathname}`);
        });

        await goto(page, '/');
        await page.locator('[data-me-name]').waitFor({ state: 'visible' });
        assert.equal(await page.locator('[data-me-name]').innerText(), '未登录');
        await headerAligned(page, '.ph h1');
        await sheetHistory(page, name);
        await openCourses(page);
        await screenshot(page, `${name}-my-courses`);
        const courseButton = page.getByRole('button', { name: /^查看课程详情：/ }).first();
        const courseName = (await courseButton.getAttribute('aria-label')).replace('查看课程详情：', '');
        const originalLabs = (await prefs(page)).labs || {};
        await courseButton.click();
        await heading(page, courseName);
        await page.getByRole('heading', { name: '上课安排', exact: true }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '编辑名称', exact: true }).click();
        await page.getByLabel('课程显示名称').fill('验收课程名称');
        await page.getByRole('button', { name: '保存名称', exact: true }).click();
        await heading(page, '验收课程名称');
        assert(Object.values((await prefs(page)).timetable[release.teaching].names).includes('验收课程名称'));
        await page.getByRole('button', { name: '编辑名称', exact: true }).click();
        await page.getByRole('button', { name: '恢复原名', exact: true }).click();
        await heading(page, courseName);
        await page.getByRole('button', { name: '从我的课表隐藏', exact: true }).click();
        await heading(page, '我的课程');
        assert.equal((await prefs(page)).timetable[release.teaching].hidden.length, 1);
        assert.deepEqual((await prefs(page)).labs || {}, originalLabs, 'hiding a lecture does not cancel its lab');
        await page.getByRole('button', { name: '已隐藏', exact: true }).click();
        await page.getByRole('button', { name: `查看课程详情：${courseName}`, exact: true }).click();
        await page.getByRole('button', { name: '恢复到课表', exact: true }).click();
        await page.getByRole('button', { name: '已显示', exact: true }).click();
        await page.getByRole('button', { name: `查看课程详情：${courseName}`, exact: true }).waitFor({ state: 'visible' });
        log(`${name}: public course details, rename, restore, hide and restore preserve labs`);

        await page.getByRole('button', { name: '自定义课程', exact: true }).click();
        await heading(page, '自定义课程');
        await page.getByLabel('课程名称', { exact: true }).fill('验收自定义课程');
        await page.getByLabel(/^周次/).fill('1-8');
        await page.getByLabel('地点（可不填）', { exact: true }).fill('教1-101');
        await page.getByLabel('教师（选填）', { exact: true }).fill('验收教师');
        await page.getByRole('button', { name: '添加课程', exact: true }).click();
        await page.getByRole('button', { name: '查看课程详情：验收自定义课程', exact: true }).click();
        await heading(page, '验收自定义课程');
        const custom = (await prefs(page)).timetable[release.teaching].custom;
        assert.equal(custom.length, 1);
        const id = custom[0].id;
        await page.getByText('验收教师', { exact: true }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '编辑课程', exact: true }).click();
        await heading(page, '编辑课程');
        await page.getByLabel('课程名称', { exact: true }).fill('验收课程已编辑');
        await page.getByRole('combobox', { name: '从第几节', exact: true }).selectOption('6');
        await page.getByRole('combobox', { name: '到第几节', exact: true }).selectOption('7');
        await page.getByLabel('地点（可不填）', { exact: true }).fill('教1-102');
        await page.getByRole('button', { name: '保存修改', exact: true }).click();
        await heading(page, '验收课程已编辑');
        const changed = (await prefs(page)).timetable[release.teaching].custom;
        assert.equal(changed.length, 1); assert.equal(changed[0].id, id); assert.deepEqual(changed[0].periods, [6, 7]); assert.equal(changed[0].room, '教1-102');
        await screenshot(page, `${name}-course-detail`);
        await page.getByRole('button', { name: '移除这门课', exact: true }).click();
        await heading(page, '我的课程');
        assert.equal((await prefs(page)).timetable?.[release.teaching]?.custom?.length || 0, 0);
        await closeSheet(page);
        await heading(page, '课表设置');
        await page.getByRole('button', { name: '实验安排', exact: true }).click();
        await heading(page, '实验安排');
        const labSwitch = page.getByRole('dialog').locator('button.kv').filter({ has: page.locator('.toggle') }).first();
        await labSwitch.waitFor({ state: 'visible' });
        const beforeLabs = (await prefs(page)).labs || {};
        const beforeTimetable = (await prefs(page)).timetable || {};
        await labSwitch.click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('studev_prefs')).labs?.off?.length > 0);
        assert.deepEqual((await prefs(page)).timetable || {}, beforeTimetable);
        await labSwitch.click();
        assert.deepEqual((await prefs(page)).labs || {}, beforeLabs);
        await screenshot(page, `${name}-labs`);
        await closeSheet(page); await closeSheet(page);
        log(`${name}: custom course add/edit/same id/delete and independent lab settings`);

        await openCourses(page);
        await page.getByRole('link', { name: '从全校课程添加', exact: true }).click();
        await page.getByRole('textbox', { name: '搜索', exact: true }).fill('高等数学');
        await noAvatarOverlap(page, '.search .sfield');
        await headerAligned(page, '.search .sfield');
        await page.locator('.hits button.hit.entity').first().click();
        await page.getByRole('dialog').locator('.sheet-list a.res').first().click();
        await page.getByRole('button', { name: '加入课表', exact: true }).waitFor({ state: 'visible' });
        const addedId = new URL(page.url()).searchParams.get('preview');
        const addedName = await page.locator('.dock > .m').evaluate(element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim());
        assert(addedId && addedName);
        await page.getByRole('button', { name: '加入课表', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.dock'));
        assert((await prefs(page)).timetable[release.teaching].added.includes(addedId));
        await openCourses(page);
        await page.getByRole('button', { name: `查看课程详情：${addedName}`, exact: true }).click();
        await page.getByText('从全校课程添加', { exact: true }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '移除这门课', exact: true }).click();
        await heading(page, '我的课程');
        assert(!(await prefs(page)).timetable?.[release.teaching]?.added?.includes(addedId));
        await closeSheet(page); await closeSheet(page);
        log(`${name}: real course search, teaching-class preview, add and remove`);

        await goto(page, '/knowledge/');
        await headerAligned(page, '.knowledge .ph h1');
        await compactFilters(page, name);
        await page.getByRole('tab', { name: '课程关系', exact: true }).click();
        const diagram = page.locator('.kn-graph figure.doc-diagram svg');
        await diagram.waitFor({ state: 'visible' });
        assert((await diagram.locator('path').count()) > 0, 'the graph contains actual connections');
        await page.getByRole('combobox', { name: '查看课程', exact: true }).selectOption('all');
        await diagram.waitFor({ state: 'visible' });
        await screenshot(page, `${name}-course-relations-overview`);
        const focused = await page.getByRole('combobox', { name: '查看课程', exact: true }).locator('option').evaluateAll(options => options.find(item => item.value !== 'all')?.value);
        assert(focused);
        await page.getByRole('combobox', { name: '查看课程', exact: true }).selectOption(focused);
        await diagram.waitFor({ state: 'visible' });
        await screenshot(page, `${name}-course-relations-focus`);
        await goto(page, '/knowledge/?cohort=2026&major=' + encodeURIComponent('软件工程'));
        await knowledgeScope(page, '2026', '软件工程');
        await openFilters(page);
        await selectValue(page, '入学年份', '2026'); await selectValue(page, '专业', '软件工程');
        await closeFilters(page);
        assert.equal((await prefs(page)).class, 'B240402');
        log(`${name}: class-based knowledge defaults, explicit shared filters and connected graphs`);

        await goto(page, '/knowledge/?course=' + encodeURIComponent(sports.id));
        await page.locator('.kn-home .kn-doc .doc').waitFor({ state: 'visible' });
        await page.getByRole('heading', { name: sports.name, exact: true }).waitFor({ state: 'visible' });
        assert.equal(await page.getByRole('button', { name: /目录/ }).count(), 0, 'the course home is already its outline');
        assert.equal(await page.getByRole('heading', { name: sports.name, exact: true }).count(), 1);
        assert.equal(await page.locator('.kn-tree').count(), 0);
        assert.equal(await page.getByText(/章节和知识点由课件/).count(), 0);
        await screenshot(page, `${name}-course-home`);

        const retryTopic = knowledge.topics.find(topic => sports.chapters.some(chapter => chapter.topics.includes(topic.id)));
        assert(retryTopic);
        const retryUrl = new URL(`${release.base}/knowledge/${retryTopic.path.split('/').map(encodeURIComponent).join('/')}`, origin).href;
        // A normal warm PWA correctly serves this document from its worker cache. Test network failure in
        // a separate clean browser context without a worker, so the real fetch is actually made to fail.
        const availability = await browser.newContext({ viewport, colorScheme: 'dark', locale: 'zh-CN', serviceWorkers: 'block' });
        const retryPage = await availability.newPage(); active = retryPage;
        let failures = 0;
        const retryErrors = [];
        retryPage.on('pageerror', error => retryErrors.push(error.message));
        await retryPage.route(retryUrl, async route => { failures++; await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Deliberate one-request availability test' }); });
        await goto(retryPage, '/knowledge/?topic=' + encodeURIComponent(retryTopic.id));
        const failure = retryPage.getByRole('alert').filter({ hasText: '内容暂时无法加载' });
        await failure.waitFor({ state: 'visible' });
        assert.equal(failures, 1, 'the actual document request received the injected HTTP error');
        await screenshot(retryPage, `${name}-document-retry`);
        await retryPage.unroute(retryUrl);
        await failure.getByRole('button', { name: '重试', exact: true }).click();
        await retryPage.locator('.kn-doc .doc').waitFor({ state: 'visible' });
        await heading(retryPage, retryTopic.title);
        assert.equal(await retryPage.getByRole('alert').filter({ hasText: '内容暂时无法加载' }).count(), 0);
        assert.deepEqual(retryErrors, []);
        await availability.close(); active = page;
        log(`${name}: document availability error and successful in-place retry`);

        await goto(page, '/knowledge/?topic=' + encodeURIComponent(military.id));
        const refGroup = page.locator('.kn-refs').filter({ has: page.getByText(material.title, { exact: true }) });
        await refGroup.waitFor({ state: 'visible' });
        await noAvatarOverlap(page, '.kn-course-switch');
        await headerAligned(page, '.kn-bar .back');
        await headerAligned(page, '.kn-course-switch');
        await referenceCount(page, 3);
        await refGroup.locator('.kn-ref-list button small').first().waitFor({ state: 'visible' });
        await refGroup.scrollIntoViewIfNeeded();
        if (viewport.width < 1000) {
            const avatar = await page.locator('[data-me]').boundingBox();
            assert(avatar.y + avatar.height < 0, 'the mobile avatar scrolls away with the document and cannot obscure the passage');
        }
        await screenshot(page, `${name}-references-preview`);
        await refGroup.getByRole('button', { name: `展开全部 ${references.length} 处`, exact: true }).click();
        await referenceCount(page, references.length);
        await refGroup.getByRole('button', { name: '收起', exact: true }).click();
        await referenceCount(page, 3);
        await refGroup.locator('.kn-ref-list button').first().click();
        await page.waitForURL(url => url.searchParams.get('material') === materialPath && decodeURIComponent(url.hash.slice(1)) === references[0].anchor);
        const passage = page.locator('.kn-q.here');
        await passage.waitFor({ state: 'visible' });
        await passage.getByRole('button', { name: military.title, exact: true }).click();
        await page.waitForURL(url => url.searchParams.get('topic') === military.id);
        await heading(page, military.title);
        log(`${name}: course home without duplicate outline and ${references.length} references preview/expand/collapse/exact passage/backlink`);

        log(`${name}: ${await inspectAiTrace(page, { root, output, name })}`);
        await noAvatarOverlap(page, '.ai-bar button');
        await headerAligned(page, '.ai-model-b');

        await mapAvailability(name, viewport);

        assert.deepEqual(errors, [], `${name} JavaScript errors`);
        assert.deepEqual(dataErrors, [], `${name} failed application data requests`);
        await context.close(); active = null;
    }
    await writeFile(join(output, 'result.json'), JSON.stringify({ site: origin.href, release: release.version, passed: results }, null, 2));
} catch (error) {
    if (active && !active.isClosed()) {
        await screenshot(active, 'failure').catch(() => {});
        await writeFile(join(output, 'failure.txt'), `${error.stack}\n\n${await active.locator('body').innerText().catch(() => '')}`);
    }
    throw error;
} finally { await browser.close(); }
