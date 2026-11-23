// Anonymous public roster through the production API projection and browser renderer.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createPlatformHandler } from '../../src/platform/server/app.mjs';
import { publishRosterPerson } from '../../src/platform/server/roster.mjs';
import { createRepository } from '../../src/platform/server/store.mjs';
import { memoryBlob, testEnvironment } from '../../src/platform/tests/fixtures.mjs';

const origin = process.env.STUDEV_WEB_URL || 'http://127.0.0.1:4324';
const output = process.env.STUDEV_ROSTER_SMOKE_DIR || 'D:/Temp/codex/studev-roster/browser';
const { env } = await testEnvironment();
env.PLATFORM_ORIGIN = origin;
const now = () => Date.UTC(2026, 10, 17, 12);
const store = memoryBlob();
const repo = createRepository(store, { now, secret: env.PLATFORM_SESSION_SECRET });
const handle = createPlatformHandler({ now, getStore: () => store });
const president = 'student-development';
const media = `${president}/media`;
const person = (index, realName, nickname, memberships, status = 'active') => ({
  id: `00000000-0000-0000-0000-00000000005${index}`, realName, nickname, revision: 1, status,
  studentId: `PRIVATESTAFF0${index}`, qq: `1000085${index}`, signature: '一起记录', memberships,
});
const position = (organizationId, title, startsOn, endsBefore, order = 1) => ({ organizationId, title, startsOn, endsBefore, order });
const first = person(1, '任𠮷', '', [position(president, '执行主席', '2026-09-01', '2027-07-01')], 'pending');
const second = person(2, '测试成员', '清风 <script>unsafe</script>', [position(media, '部长', '2026-10-01', '2027-07-01')]);
const earlier = person(3, '前任成员', '早晨', [position(media, '部长', '2026-09-01', '2026-10-01')]);
const previousYear = person(4, '往届成员', '晨光', [position(media, '部长', '2025-09-01', '2026-07-01')]);
const unaffiliated = person(5, '其他用户', '不可发布', [{ organizationId: president }]);
const scheduled = person(6, '未来成员', '未来任职', [position(media, '部长', '2027-07-01', '2027-08-01')]);
const people = [first, second, earlier, previousYear, unaffiliated, scheduled];
await Promise.all(people.map(user => publishRosterPerson(repo, user)));

await mkdir(output, { recursive: true });
const receipts = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNQX/D/PwgzwBgAXfgLFfJiz30AAAAASUVORK5CYII=', 'base64');
try {
  for (const [name, viewport, colorScheme] of [['phone', { width: 390, height: 844 }, 'dark'], ['desktop', { width: 1440, height: 1000 }, 'light']]) {
    const context = await browser.newContext({ viewport, colorScheme, serviceWorkers: 'block' });
    const calls = [], errors = [], external = [];
    await context.route('**/api/platform/**', async route => {
      const url = new URL(route.request().url());
      calls.push(url.pathname + url.search);
      if (url.pathname === '/api/platform/public/roster') {
        const response = await handle({ request: new Request(url), env });
        const payload = await response.text();
        for (const entry of people) {
          assert(!payload.includes(entry.studentId));
          assert(!payload.includes(entry.qq));
        }
        return route.fulfill({ status: response.status, contentType: 'application/json', body: payload });
      }
      if (url.pathname === `/api/platform/members/${first.id}/avatar`) return route.fulfill({ status: 502, body: '' });
      if (url.pathname.endsWith('/avatar')) return route.fulfill({ contentType: 'image/png', body: png });
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/qlogo|dst_uin|nk=/.test(request.url())) external.push(request.url()); });
    await page.goto(new URL(name === 'phone' ? '/history/' : '/history/#people', origin).href);
    if (name === 'phone') {
      await page.getByRole('tab', { name: /大事记/ }).waitFor();
      assert.equal(calls.length, 0, 'reading the timeline does not request platform data');
      await page.getByRole('tab', { name: /成员名册/ }).click();
    }
    const cards = page.locator('[data-roster-container] article.member:not(.member-skeleton)');
    const selector = page.getByRole('combobox', { name: '查看任职' });
    await cards.nth(1).waitFor();
    assert.equal(await cards.count(), 2);
    assert.equal(await selector.inputValue(), 'today');
    assert.equal(await cards.first().getAttribute('id'), 'member-' + first.id);
    assert.equal(await cards.first().locator('h4').innerText(), '任𠮷 𠮷');
    assert.equal(await cards.nth(1).locator('small').innerText(), '清风 <script>unsafe</script>');
    assert.equal(await cards.locator('script, time').count(), 0);
    await page.waitForFunction(() => document.querySelector('[data-roster-container] img')?.getAttribute('src')?.startsWith('data:image/svg+xml'));
    assert.match(decodeURIComponent(await cards.first().locator('img').getAttribute('src')), /𠮷/);
    const avatar = cards.nth(1).locator('img');
    await avatar.scrollIntoViewIfNeeded();
    await page.waitForFunction(id => {
      const img = document.querySelector(`#member-${id} img`);
      return img?.complete && img.naturalWidth > 0;
    }, second.id);
    assert.equal(await avatar.getAttribute('src'), `${origin}/api/platform/members/${second.id}/avatar`);

    await selector.selectOption('2025-2026');
    await page.locator(`#member-${previousYear.id}`).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('year'), '2025-2026');
    assert.equal(await cards.count(), 1);
    assert.deepEqual(await cards.locator('time').allTextContents(), ['2025-09-01', '2026-06-30']);

    await page.goBack();
    await page.locator(`#member-${first.id}`).waitFor();
    assert.equal(await selector.inputValue(), 'today');
    assert.equal(await cards.count(), 2);

    await selector.selectOption('2026-2027');
    await page.locator(`#member-${earlier.id}`).waitFor();
    assert.equal(await cards.count(), 3);
    assert.equal(await page.locator(`#member-${scheduled.id}, #member-${unaffiliated.id}`).count(), 0);
    assert.deepEqual(await page.locator(`#member-${earlier.id} time`).allTextContents(), ['2026-09-01', '2026-09-30']);
    await page.reload();
    await page.locator('#member-' + earlier.id).waitFor();
    assert.equal(await selector.inputValue(), '2026-2027');
    assert(calls.includes('/api/platform/public/roster'));
    assert(calls.includes('/api/platform/public/roster?year=2025-2026'));
    assert(calls.includes('/api/platform/public/roster?year=2026-2027'));
    assert(!calls.some(path => /auth|admin/.test(path)));
    assert.equal(external.length, 0);
    assert.equal(errors.length, 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    receipts.push({ name, today: 2, earlierYear: 1, currentYear: 3, privateFieldsAbsent: true, opaqueAvatar: true, unicodeFallback: true, noAccountReads: true, noPageErrors: true, noHorizontalOverflow: true });
    await context.close();
  }
  await writeFile(`${output}/result.json`, JSON.stringify({ ok: true, results: receipts }, null, 2));
  console.log(JSON.stringify({ ok: true, results: receipts }));
} finally {
  await browser.close();
}
