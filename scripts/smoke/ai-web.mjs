// A recorded public provider response, viewed through normal persistent chat storage without sending a prompt.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function inspectAiTrace(page, { root, output, name }) {
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
    return `${calls.length} recorded calls; original parameters and TCP result inspected without a model request`;
}
