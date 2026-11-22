// A recorded public provider response, viewed through normal persistent chat storage without sending a prompt.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function inspectAiTrace(page, { root, output, name }) {
    const welcome = await page.goto(new URL('/ai/', page.url()).href, { waitUntil: 'domcontentloaded' });
    assert.equal(welcome?.status(), 200);
    const composer = page.getByRole('textbox', { name: '问点什么', exact: true });
    await composer.waitFor();
    const desktop = page.viewportSize().width >= 900;
    const navigation = page.locator('.site-nav:visible, .phone-tabs:visible');
    assert.equal(await navigation.locator('a.campus-tab svg[aria-hidden="true"]').count(), 5);
    assert.equal(await navigation.getByRole('link', { name: 'AI', exact: true }).getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.ai-bar .ai-title').textContent(), '');
    await page.screenshot({ path: join(output, `${name}-ai-welcome.png`), fullPage: false });
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
    await page.getByRole('button', { name: '分享 StuDev', exact: true }).click();
    const share = page.getByRole('dialog', { name: '分享 StuDev' });
    const product = JSON.parse(await readFile(join(root, 'product.json'), 'utf8'));
    assert.equal(await share.getByRole('textbox').inputValue(), product.origin + '/');
    await share.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '找空教室', exact: true }).click();
    assert.equal(await composer.inputValue(), '今天下午哪里有空教室？');
    assert.equal(await page.locator('.ai-turn').count(), 0, 'a suggestion stays a draft until sent');

    const messages = JSON.parse(await readFile(join(root, 'scripts/smoke/fixtures/ai-tcp.json'), 'utf8'));
    const nodes = [], chosen = {};
    let parent = '';
    messages.forEach((message, index) => {
        const id = `ai-replay-message-${index}`;
        nodes.push({ id, parent, message }); chosen[parent] = id; parent = id;
    });
    const seed = { current: 'ai-replay', chats: [{ id: 'ai-replay', title: '', updated: Date.now(), proposals: [], thread: { nodes, chosen } }] };
    await page.evaluate(seed => localStorage.setItem('studev_ai_chats', JSON.stringify(seed)), seed);
    const response = await page.goto(new URL('/ai/', page.url()).href, { waitUntil: 'domcontentloaded' });
    assert.equal(response?.status(), 200);
    await composer.waitFor();
    if (!desktop) await page.getByRole('button', { name: '对话列表', exact: true }).click();
    const history = page.getByRole('textbox', { name: '搜索对话', exact: true }).or(page.getByRole('searchbox', { name: '搜索对话', exact: true }));
    await history.fill('无匹配对话');
    await page.getByText('没有找到对话', { exact: true }).waitFor();
    await history.fill('TCP');
    await page.locator('.ai-chat-t').filter({ hasText: 'TCP' }).first().click();
    const record = page.locator('.ai-steps').first();
    await record.locator(':scope > summary').waitFor({ state: 'visible' });
    assert.equal(await record.getAttribute('open'), null, 'the tool record starts collapsed');
    const calls = messages.flatMap(message => message.tool_calls || []);
    await record.locator(':scope > summary').click();
    const rows = record.locator(':scope > ol > li > details');
    assert.equal(await rows.count(), calls.length, 'every real call is retained separately');
    const readAt = calls.findIndex(call => call.function.name === 'read');
    assert(readAt >= 0);
    const detail = rows.nth(readAt);
    await detail.locator(':scope > summary').click();
    const reference = JSON.parse(calls[readAt].function.arguments).id;
    assert.match(await detail.locator('pre').first().innerText(), new RegExp(reference));
    assert.match(await detail.locator('pre').last().innerText(), /TCP/);
    await page.screenshot({ path: join(output, `${name}-ai-call-details.png`), fullPage: false });
    await detail.locator(':scope > summary').click();
    await record.locator(':scope > summary').click();
    assert.equal(await record.getAttribute('open'), null);
    await page.locator('.ai-a').first().waitFor({ state: 'visible' });
    assert.doesNotMatch(await page.locator('.ai-turns').innerText(), /<(?:(?:｜|\|)DSML)/);
    const resources = page.locator('details.ai-resources');
    assert.equal(await resources.getAttribute('open'), null, 'reference links start folded');
    assert(await page.locator('.ai-answer-end + .ai-tools + .ai-resources').count(), 'the scroll target ends with the answer, ahead of attachments');
    await resources.locator('summary').click();
    const urls = await resources.getByRole('link').evaluateAll(elements => elements.map(item => item.getAttribute('href')));
    assert(urls.length > 2 && new Set(urls).size === urls.length && urls.every(href => href.startsWith('/knowledge/')));
    await page.screenshot({ path: join(output, `${name}-ai-references.png`), fullPage: false });
    const scroller = page.locator('.ai-scroll');
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.getByRole('button', { name: '回到最新回答' }).click();
    const { following, remaining } = await scroller.evaluate(element => {
        const target = element.querySelector('.ai-answer-end').getBoundingClientRect().bottom;
        return { following: Math.abs(element.getBoundingClientRect().bottom - target - 12) <= 4,
            remaining: element.scrollHeight - element.clientHeight - element.scrollTop };
    });
    assert(following && remaining > 64, 'return to the answer text leaves the open resource list below the viewport');
    return `five navigation icons, an editable campus suggestion, searchable history and ${calls.length} recorded calls`;
}
