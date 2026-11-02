// Runs against a built preview or production with a separate browser profile.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer';

const { values } = parseArgs({ options: {
    origin: { type: 'string', default: 'http://localhost:4321' },
    output: { type: 'string', default: 'D:/Temp/codex/studev-search-release/browser' },
} });
await mkdir(values.output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, userDataDir: await mkdtemp(join(values.output, 'profile-')) });
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('/search/timetable/?class=B240402&q=檀军', values.origin).href, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.course-manager input[aria-label="搜索课程"]');
    const checks = [['檀军', '就业指导'], ['操作系统', '操作系统'], ['教3-410', '教3-410']];
    for (const [query, expected] of checks) {
        await page.locator('.course-manager input[aria-label="搜索课程"]').fill(query);
        await page.waitForFunction(text => document.querySelector('.course-results')?.textContent.includes(text), { timeout: 30_000 }, expected);
        const result = await page.$eval('.course-manager .course-detail-body section', element => ({ heading: element.querySelector('h3').textContent, text: element.querySelector('.course-results').textContent }));
        assert.match(result.heading, /^找到 [1-9]/);
        assert(!result.text.includes('is not iterable'));
        console.log(JSON.stringify({ query, heading: result.heading, matched: expected }));
        await page.screenshot({ path: join(values.output, `${checks.indexOf(checks.find(check => check[0] === query))}-search.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
} finally {
    await browser.close();
}
