import { describe, expect, test } from 'vitest';
import { Completion, completionRequest } from '@/world/assistant.mjs';
import { browserToolCatalog, browserToolId, campusHistory, needsToolConfirmation, toolCatalog } from './toolCatalog';

const outline = { name: 'icourse.outline', description: 'Read the open course outline.',
    annotations: { readOnlyHint: true, destructiveHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
const situation = { week: null, class: null, campus: '仙林', memory: null };

describe('one available catalog for the picker and the model', () => {
    test('requires a read-only listing and an explicit opt-in before offering a browser tool', () => {
        const browser = browserToolCatalog([outline, { ...outline, name: 'mooc.submit', annotations: { destructiveHint: true, readOnlyHint: true } }, outline]);
        expect(browser.map(tool => tool.capability)).toEqual(['icourse.outline']);
        const disabledCampus = ['search'];
        expect(toolCatalog(situation, { disabledCampus, enabledBrowser: [] }, browser).map(tool => tool.definition.function.name)).not.toContain(browserToolId(outline.name));
        const catalog = toolCatalog(situation, { disabledCampus, enabledBrowser: [outline.name] }, browser);
        const name = browserToolId(outline.name);
        const request = completionRequest('deepseek', [], situation, 0, false, { tools: catalog.map(tool => tool.definition), preferred: name });
        expect(request.tools?.map(tool => tool.function.name)).not.toContain('search');
        expect(request.tools?.map(tool => tool.function.name)).not.toContain('remember');
        expect(request.tools?.at(-1)?.function.name).toBe(name);
        expect(request.messages[0]?.content).toContain(`用户已选择工具 ${name}`);
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
        const items = toolCatalog({ ...situation, memory: '' }, { disabledCampus: [], enabledBrowser: [outline.name] }, browserToolCatalog([outline]));
        const item = (name: string) => items.find(tool => tool.definition.function.name === name)!;
        expect(needsToolConfirmation('review', item('search'))).toBe(false);
        expect(needsToolConfirmation('review', item(browserToolId(outline.name)))).toBe(true);
        expect(needsToolConfirmation('read', item(browserToolId(outline.name)))).toBe(false);
        expect(needsToolConfirmation('read', item('remember'))).toBe(true);
        expect(needsToolConfirmation('approved', item('remember'))).toBe(false);
        expect(needsToolConfirmation('read', item('propose_task'))).toBe(false);
    });

    test('keeps paired campus calls while omitting raw browser results from the free transport', () => {
        const lookup = { id: 'keep', type: 'function' as const, function: { name: 'search', arguments: '{}' } };
        const external = { ...lookup, id: 'drop', function: { ...lookup.function, name: browserToolId(outline.name) } };
        expect(campusHistory([
            { role: 'user', content: '课表资料' }, { role: 'assistant', content: null, tool_calls: [lookup, external] },
            { role: 'tool', content: '可展示', tool_call_id: 'keep' }, { role: 'tool', content: '课程目录', tool_call_id: 'drop' },
        ])).toEqual([
            { role: 'user', content: '课表资料' }, { role: 'assistant', content: null, tool_calls: [lookup] },
            { role: 'tool', content: '可展示', tool_call_id: 'keep' },
        ]);
    });
});
