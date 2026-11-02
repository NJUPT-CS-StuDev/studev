// Real browser acceptance against a local build or the deployed product.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer';
const { values } = parseArgs({ options: { origin: { type: 'string', default: 'http://127.0.0.1:4328' }, output: { type: 'string', default: 'D:/Temp/codex/studev-stability-search-exams/browser' }, native: { type: 'string' } } });
await mkdir(values.output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, userDataDir: await mkdtemp(join(values.output, 'profile-')) });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(30_000);
const visit = path => page.goto(new URL(path, values.origin).href, { waitUntil: 'networkidle0' });
try {
    await page.setViewport({ width: 1440, height: 1000 });
    const search = [];
    for (const [scope, query] of [['web', '奖学金'], ['materials', '高等数学'], ['community', '校园网']]) {
        await visit(`/search/${scope}/?q=${encodeURIComponent(query)}`);
        await page.waitForSelector('a[data-search-result]');
        await page.waitForFunction(() => [...document.querySelectorAll('p')].some(node => /找到 \d+ 条相关结果/.test(node.textContent)));
        const result = await page.evaluate(() => ({ urls: [...document.querySelectorAll('a[data-search-result]')].map(node => node.href), summary: [...document.querySelectorAll('p')].map(node => node.textContent).find(text => /找到 \d+ 条相关结果/.test(text)) }));
        assert(result.urls.length > 0);
        search.push({ scope, query, ...result });
        await page.screenshot({ path: join(values.output, `search-${scope}.png`), fullPage: true });
    }
    await writeFile(join(values.output, 'search-results.json'), JSON.stringify(search, null, 2));
    if (values.native) {
        const native = JSON.parse(await readFile(values.native, 'utf8'));
        for (const result of search) {
            const counterpart = native.find(row => row.scope === result.scope && row.query === result.query);
            assert(counterpart, `Native report missing ${result.scope}`);
            assert.deepEqual(result.urls, counterpart.urls.slice(0, result.urls.length), `Web/native ranking differs in ${result.scope}`);
            assert.equal(Number(result.summary.match(/找到 (\d+)/)[1]), counterpart.total);
        }
    }
    await visit('/search/exam/?class=B240402');
    await page.waitForSelector('[data-exam] input');
    const first = await page.$eval('[data-exam]', node => ({ id: node.dataset.exam, checked: node.querySelector('input').checked }));
    assert(first.checked);
    await page.click(`[data-exam="${first.id}"] input`);
    await page.waitForFunction(id => !document.querySelector(`[data-exam="${id}"] input`).checked, {}, first.id);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('studev_prefs')));
    assert(Object.values(saved.examAttendance).some(choices => choices[first.id] === false));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(id => document.querySelector(`[data-exam="${id}"] input`)?.checked === false, {}, first.id);
    await visit('/search/exam/?class=B250105');
    await page.waitForSelector('[data-exam] input');
    assert(await page.$$eval('[data-exam] input', nodes => nodes.every(node => node.checked)));
    await visit('/search/exam/?class=B240402');
    await page.waitForFunction(id => document.querySelector(`[data-exam="${id}"] input`)?.checked === false, {}, first.id);
    const total = await page.$$eval('[data-exam]', nodes => nodes.length);
    await page.evaluate(() => {
        const create = URL.createObjectURL.bind(URL);
        URL.createObjectURL = blob => { if (blob.type.startsWith('text/calendar')) blob.text().then(text => { window.__downloadedCalendar = text; }); return create(blob); };
    });
    await page.click('[aria-label="导出 ICS 日历文件"]');
    await page.waitForFunction(() => typeof window.__downloadedCalendar === 'string');
    const calendar = await page.evaluate(() => window.__downloadedCalendar);
    assert.equal((calendar.match(/BEGIN:VEVENT/g) ?? []).length, total - 1);
    assert(!calendar.includes(`UID:${first.id}@`));
    await page.screenshot({ path: join(values.output, 'exam-excluded.png'), fullPage: true });
    await page.click(`[data-exam="${first.id}"] input`);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(id => document.querySelector(`[data-exam="${id}"] input`)?.checked === true, {}, first.id);
    await visit('/search/timetable/?class=B240402&week=9&q=艺术');
    await page.waitForSelector('.course-result button');
    const add = '.course-result button[aria-label^="加入我的课表"]';
    await page.waitForSelector(add);
    await page.click(add);
    await page.waitForFunction(() => document.querySelector('.course-result button[aria-label^="移出我的课表"]'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.course-result button[aria-label^="移出我的课表"]');
    await page.click('.course-result button[aria-label^="移出我的课表"]');
    await page.click('[aria-label="关闭课程管理"]');
    await visit('/search/timetable/?class=B240402&week=9');
    await page.waitForSelector('.timetable-manage');
    await page.click('.timetable-manage');
    await page.waitForSelector('[aria-label^="不上 "]');
    const hide = await page.$eval('[aria-label^="不上 "]', node => node.getAttribute('aria-label'));
    await page.click(`[aria-label=${JSON.stringify(hide)}]`);
    await page.waitForSelector('[aria-label^="恢复 "]');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.timetable-manage'); await page.click('.timetable-manage');
    await page.waitForSelector('[aria-label^="恢复 "]'); await page.click('[aria-label^="恢复 "]');
    await page.setViewport({ width: 412, height: 915 });
    await visit('/search/web/?q=奖学金'); await page.waitForSelector('a[data-search-result]');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(values.output, 'mobile-search.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, search: search.map(({ scope, urls, summary }) => ({ scope, displayed: urls.length, summary })), examSelection: 'persisted, isolated, restored and respected by ICS', timetable: 'add, remove, skip and restore survive reload', errors }));
} finally { await browser.close(); }
