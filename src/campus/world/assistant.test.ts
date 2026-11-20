import { describe, expect, it } from 'vitest';
import { Completion, completionRequest, instructions, situationError } from './assistant.mjs';
import { stepsLine, stepsOf } from '../ai/steps';

const frame = (delta: Record<string, unknown>, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta, ...(finish_reason ? { finish_reason } : {}) }] })}`;
const situation = { week: 12, class: 'B240402', campus: '仙林', memory: null };

it('keeps public teaching time independent of a class and distinguishes unavailable time from outside term', () => {
    const withoutClass = { ...situation, class: null };
    expect(instructions(withoutClass, 0)).toContain('本学期第 12 周');
    expect(instructions(withoutClass, 0)).toContain('还没选班级');
    expect(instructions({ ...withoutClass, week: null }, 0)).toContain('当前教学周尚未取得');
    expect(instructions({ ...withoutClass, week: null }, 0)).not.toContain('现在不在教学周内');
    expect(instructions({ ...withoutClass, week: 0 }, 0)).toContain('现在不在教学周内');
    for (const week of [null, 0, 1, 12, 30]) expect(situationError({ ...withoutClass, week })).toBeNull();
    for (const week of [-1, 0.5, 31, '12', undefined]) expect(situationError({ ...withoutClass, week })).toBe('教学周无效。');
});

describe('the model response protocol', () => {
    it('ends lookup rounds without advertising tools, retaining the actual tool results as evidence', () => {
        const messages = [{ role: 'user', content: '计网里 TCP 拥塞控制有哪些真题考过？' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'look', type: 'function', function: { name: 'search', arguments: '{"query":"拥塞控制","in":"考试资料"}' } }] },
            { role: 'tool', tool_call_id: 'look', content: '[{"id":"sections/a.md#计算-3","title":"计算 3"}]' }];
        const request = completionRequest('deepseek-flash', messages, situation, 0, true);
        expect(request).not.toHaveProperty('tools');
        expect(request).not.toHaveProperty('tool_choice');
        expect(request.messages.slice(1)).toEqual(messages);
        expect(request.messages[0]!.content).toContain('本次资料查询已结束');
    });

    it.each(['<｜DSML｜', '<|DSML|', '<｜｜DSML｜｜', '< | | DSML | | '])('reads native markup %s as the call it spells, at every stream split, never as text', marker => {
        const close = marker.replace('<', '</');
        const native = `${marker}function_calls>${marker}invoke name="read">${marker}parameter name="id" string="true">sections/a.md</${close.slice(2)}parameter>${marker}parameter name="ids" string="false">["x"]${close}parameter>${close}invoke>${close}function_calls>`;
        for (let cut = 1; cut < marker.length + 4; cut++) {
            const completion = new Completion();
            const shown = completion.take(frame({ content: '我来查询。' + native.slice(0, cut) }))
                + completion.take(frame({ content: native.slice(cut) }, 'stop'));
            expect(shown).toBe('我来查询。');
            const { message } = completion.result();
            expect(message?.content).toBe('我来查询。');
            expect(message?.tool_calls?.map(call => [call.function.name, JSON.parse(call.function.arguments)])).toEqual([['read', { id: 'sections/a.md', ids: ['x'] }]]);
        }
    });

    it('refuses native markup that names an unknown tool or spells nothing', () => {
        for (const native of ['<｜DSML｜invoke name="format_disk"></｜DSML｜invoke>', '<｜DSML｜function_calls>']) {
            const completion = new Completion();
            completion.take(frame({ content: native }, 'stop'));
            expect(completion.result().error).toBeDefined();
        }
    });

    it('streams ordinary less-than signs and structured calls unchanged', () => {
        const text = new Completion();
        expect(text.take(frame({ content: '$x <' }))).toBe('$x ');
        expect(text.take(frame({ content: ' 5$。' }, 'stop'))).toBe('< 5$。');
        expect(text.result()).toEqual({ message: { role: 'assistant', content: '$x < 5$。' } });
        const call = new Completion();
        call.take(frame({ tool_calls: [{ index: 0, id: 'read-1', function: { name: 'read', arguments: '{"id":' } }] }));
        call.take(frame({ tool_calls: [{ index: 0, function: { arguments: '"sections/a.md#计算-3"}' } }] }, 'tool_calls'));
        expect(call.result()).toEqual({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read', arguments: '{"id":"sections/a.md#计算-3"}' } }] } });
    });

    it('reports failed and pending lookups in the record summary', () => {
        const calls = ['ok', 'missing', 'waiting'].map(id => ({ id, name: 'read', arguments: JSON.stringify({ id }) }));
        const steps = stepsOf(calls, new Map([['ok', { title: '计算 3' }], ['missing', { error: '找不到这篇资料。' }]]));
        expect(stepsLine(steps)).toBe('读原文 ×3（失败 1）（进行中 1）');
        expect(steps.map(step => [step.failed, step.pending])).toEqual([[false, false], [true, false], [false, true]]);
    });
    it('keeps the failed attempt when the same lookup is retried successfully', () => {
        const calls = ['first', 'retry'].map(id => ({ id, name: 'read', arguments: '{"id":"3ae8eb914a97e13a"}' }));
        const steps = stepsOf(calls, new Map([['first', { error: '网络连接中断' }], ['retry', { title: 'TCP 拥塞控制' }]]));
        expect(steps).toHaveLength(2);
        expect(steps.map(step => step.failed)).toEqual([true, false]);
        expect(stepsLine(steps)).toBe('读原文 ×2（失败 1）');
    });
});
