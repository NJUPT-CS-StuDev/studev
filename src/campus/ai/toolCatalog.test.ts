import { describe, expect, test } from 'vitest';
import { Completion, completionRequest } from '@/world/assistant.mjs';
import { browserToolCatalog, browserToolId, needsToolConfirmation, reachOf, toolCatalog, toolHistory } from './toolCatalog';

const outline = { name: 'icourse.outline', description: 'Read the open course outline.',
    annotations: { readOnlyHint: true, destructiveHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
const situation = { week: null, class: null, campus: '仙林', memory: null };

describe('one available catalog for the picker and the model', () => {
    test('lists lent tools with their effect and requires an explicit opt-in before offering one', () => {
        const browser = browserToolCatalog([outline, { ...outline, name: 'mooc.submit', annotations: { destructiveHint: true, readOnlyHint: true } }, outline,
            { ...outline, name: 'filesystem_write_text', annotations: { readOnlyHint: false } }, { ...outline, name: 'no-annotations', annotations: undefined }]);
        expect(browser.map(tool => [tool.capability, tool.readOnly, tool.machine])).toEqual([['icourse.outline', true, false], ['mooc.submit', false, false], ['filesystem_write_text', false, true]]);
        expect(browser[2]?.label).toBe('写入文本文件');
        const disabledCampus = ['search'];
        expect(toolCatalog(situation, { disabledCampus, runtime: false }, browser).map(tool => tool.definition.function.name)).not.toContain(browserToolId(outline.name));
        const catalog = toolCatalog(situation, { disabledCampus, runtime: true }, browser.slice(0, 1));
        const name = browserToolId(outline.name);
        const request = completionRequest('deepseek', [], situation, 0, false, { tools: catalog.map(tool => tool.definition), preferred: [name] });
        expect(request.tools?.map(tool => tool.function.name)).not.toContain('search');
        expect(request.tools?.map(tool => tool.function.name)).not.toContain('remember');
        expect(request.tools?.at(-1)?.function.name).toBe(name);
        expect(request.messages[0]?.content).toContain(`点名了这些工具：${name}`);
        expect(browserToolId('icourse.outline')).not.toBe(browserToolId('icourse_doutline'));
    });

    test('accepts structured calls only for names declared to the model for this round', () => {
        const name = browserToolId(outline.name);
        const line = 'data: ' + JSON.stringify({ choices: [{ finish_reason: 'tool_calls', delta: { tool_calls: [
            { id: '1', index: 0, function: { name, arguments: '{}' } },
        ] } }] });
        const allowed = new Completion([name]);
        const denied = new Completion(['search']);
        allowed.take(line); denied.take(line);
        expect(allowed.result().message?.tool_calls?.[0]?.function.name).toBe(name);
        expect(denied.result().error).toBeDefined();
    });

    test('admits the same tools while varying confirmation based on their actual effects', () => {
        const write = { ...outline, name: 'filesystem_write_text', annotations: { readOnlyHint: false } };
        const items = toolCatalog({ ...situation, memory: '' }, { disabledCampus: [], runtime: true }, browserToolCatalog([outline, write]));
        const item = (name: string) => items.find(tool => tool.definition.function.name === name)!;
        expect(needsToolConfirmation('review', item('search'))).toBe(false);
        expect(needsToolConfirmation('review', item(browserToolId(outline.name)))).toBe(true);
        expect(needsToolConfirmation('read', item(browserToolId(outline.name)))).toBe(false);
        expect(needsToolConfirmation('read', item('remember'))).toBe(true);
        expect(needsToolConfirmation('approved', item('remember'))).toBe(false);
        expect(needsToolConfirmation('read', item('propose_task'))).toBe(false);
        expect(needsToolConfirmation('read', item(browserToolId(write.name)))).toBe(true);
        expect(needsToolConfirmation('approved', item(browserToolId(write.name)))).toBe(false);
    });

    test('keeps paired campus calls while omitting raw browser results from the free transport', () => {
        const lookup = { id: 'keep', type: 'function' as const, function: { name: 'search', arguments: '{}' } };
        const external = { ...lookup, id: 'drop', function: { ...lookup.function, name: browserToolId(outline.name) } };
        expect(toolHistory([
            { role: 'user', content: '课表资料' }, { role: 'assistant', content: null, tool_calls: [lookup, external] },
            { role: 'tool', content: '可展示', tool_call_id: 'keep' }, { role: 'tool', content: '课程目录', tool_call_id: 'drop' },
        ], new Set(), true)).toEqual([
            { role: 'user', content: '课表资料' }, { role: 'assistant', content: null, tool_calls: [lookup] },
            { role: 'tool', content: '可展示', tool_call_id: 'keep' },
        ]);
    });

    test('tells the model what this tab reaches, from facts, in the shared phrases', () => {
        const browser = browserToolCatalog([outline]);
        const none = { disabledCampus: [], runtime: false };
        const ready = reachOf({ state: 'ready', models: ['DeepSeek 网页'], granted: [] }, none, true, []);
        expect(ready).toEqual({ runtime: 'ready', models: ['DeepSeek 网页'], on: [], off: [], free: false, remote: [] });
        const prompt = completionRequest('deepseek', [], situation, 0, false, { reach: ready }).messages[0]?.content;
        expect(prompt).toContain('lrmcp）已连接');
        expect(prompt).toContain('DeepSeek 网页');
        expect(prompt).toContain('还没有网页工具授权给本网站');
        const granted = reachOf({ state: 'ready', models: [], granted: browser }, none, true, []);
        expect(completionRequest('deepseek', [], situation, 0, false, { reach: granted }).messages[0]?.content).toContain('已授权但没打开的网页工具：查看 MOOC 课程目录');
        const offline = reachOf({ state: 'offline', models: [], granted: [] }, none, true, []);
        expect(completionRequest('deepseek', [], situation, 0, false, { reach: offline }).messages[0]?.content).toContain('没有连上');
    });
});
