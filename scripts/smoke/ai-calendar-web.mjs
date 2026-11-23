// Exercise the public calendar before a person chooses a class; inference is intercepted, never sent to a provider.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { CAMPUS_POINTER_PATH, campusPointer } from '../../src/campus/world/release.ts';

const root = resolve(import.meta.dirname, '../..');
const origin = process.env.STUDEV_WEB_URL || 'http://127.0.0.1:4324';
const output = process.env.STUDEV_AI_CALENDAR_SMOKE_DIR || 'D:/Temp/codex/studev-design-lrmcp/ai-calendar';
const release = JSON.parse(await readFile(join(root, 'src/data/campus-release.json'), 'utf8'));
const pointer = campusPointer(release);
const product = JSON.parse(await readFile(join(root, 'product.json'), 'utf8'));
const dataOrigin = new URL(product.campusOrigin).origin;
const termPath = `${release.base}/teaching/${release.teaching}/term.json`;
const term = JSON.parse(await readFile(join(root, `public${termPath}`), 'utf8'));
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const week = term.weeks.find(item => item.start <= today && today <= item.end)?.week;
assert(week, 'The released term covers this acceptance date');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
    for (const state of ['unknown', 'in', 'out']) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
        await context.addInitScript(({ release, entry }) => {
            localStorage.setItem('studev-campus-release', JSON.stringify({ release, entry }));
            localStorage.setItem('studev_prefs', JSON.stringify({ campus: '仙林' }));
            localStorage.setItem('studev_ai_model', JSON.stringify({ use: 'own', own: { base: 'https://calendar-inference.test', model: 'test', key: 'test-only' }, runtime: { model: '' } }));
        }, { release: pointer, entry: new URL(CAMPUS_POINTER_PATH, dataOrigin).href });
        const page = await context.newPage(), requests = [], privateReads = [];
        let termReads = 0;
        await context.route(`${dataOrigin}/**`, async route => {
            const path = new URL(route.request().url()).pathname;
            if (path === termPath) {
                termReads++;
                await route.fulfill(state === 'unknown' ? { status: 503, body: 'Calendar temporarily unavailable' } : { json: state === 'out' ? { ...term, weeks: [] } : term });
            } else if (path === CAMPUS_POINTER_PATH) await route.fulfill({ json: pointer });
            else {
                if (/\/classes\/[^/]+\.json$/.test(path)) privateReads.push(path);
                try { await route.fulfill({ body: await readFile(join(root, 'public', decodeURIComponent(path))), contentType: 'application/json' }); }
                catch { await route.fulfill({ status: 404, body: 'Not found' }); }
            }
        });
        await context.route('**/api/platform/auth/session', route => route.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED', message: '请先登录。' } } }));
        await context.route('https://calendar-inference.test/**', async route => {
            const body = route.request().postDataJSON(); requests.push(body);
            await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: '校历验收完成。' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` });
        });
        await page.goto(new URL('/ai/', origin).href);
        await page.waitForLoadState('networkidle');
        assert.equal(termReads, 1);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('studev_prefs')).class ?? null), null);
        await page.getByRole('textbox', { name: '问点什么' }).fill('现在是第几周？');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByText('校历验收完成。', { exact: true }).waitFor();
        assert.equal(requests.length, 1);
        const prompt = requests[0].messages[0].content;
        assert.match(prompt, /还没选班级/);
        if (state === 'unknown') { assert.match(prompt, /当前教学周尚未取得/); assert.doesNotMatch(prompt, /现在不在教学周内/); }
        else if (state === 'in') assert(prompt.includes(`本学期第 ${week} 周`));
        else assert.match(prompt, /现在不在教学周内/);
        assert.deepEqual(privateReads, [], 'Public time never requires a personal class timetable');
        await page.screenshot({ path: join(output, `${state}.png`), fullPage: false });
        results.push({ state, noClass: true, termReads, privateClassReads: 0, correctPublicWeek: true });
        await context.close();
    }
    await writeFile(join(output, 'result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), today, week, results }, null, 2));
    console.log(`ok  public calendar without a class: unknown / week ${week} / outside term`);
} finally { await browser.close(); }
