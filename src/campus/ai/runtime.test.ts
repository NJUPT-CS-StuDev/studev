import { afterEach, expect, it, vi } from 'vitest';
import { askRuntime, closeRuntimeChat, runtimeModels, runtimeRequest, runtimeErrorMessage } from './runtime';
import { LocalRuntimeError } from '@local-runtime-mcp/browser-extension/sdk';
import { readModelSettings, selectedProvider, STARTING_OWN } from './model';
import { append, choose, conversationId, emptyThread } from './thread';

const bridge = vi.hoisted(() => ({ listModels: vi.fn(), chat: vi.fn(), closeConversation: vi.fn() }));
vi.mock('@local-runtime-mcp/browser-extension/sdk', async (importOriginal) => ({ ...await importOriginal<typeof import('@local-runtime-mcp/browser-extension/sdk')>(), createLRMCPClient: () => bridge }));
const messages = [{ role: 'user' as const, content: '明天有什么考试？' }];
const situation = { week: 12, class: 'B240402', campus: '仙林', memory: null };
const completion = (content: string | null, tool_calls?: unknown[]) => ({ object: 'chat.completion', conversation_id: 'chat-one', choices: [{ message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) }, finish_reason: tool_calls ? 'tool_calls' : 'stop' }] });
function stream(result: unknown, events: unknown[] = []) { return { result: Promise.resolve(result), async *[Symbol.asyncIterator]() { for (const event of events) yield event; } }; }
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('preserves the same system context and tools while omitting unsupported website controls', () => {
    const request = runtimeRequest('deepseek-web', messages, situation, false, 'chat-one');
    expect(request).toMatchObject({ model: 'deepseek-web', stream: true, conversation_id: 'chat-one' });
    expect(request).not.toHaveProperty('max_tokens'); expect(request).not.toHaveProperty('temperature');
    expect(request.tools?.some(tool => tool.function.name === 'read')).toBe(true);
    expect(request.messages[0]?.content).toContain('第 12 周');
    expect(runtimeRequest('deepseek-web', messages, situation, true, 'chat-one')).not.toHaveProperty('tools');
});

it('uses the shared SDK and returns validated tool calls to the existing campus loop', async () => {
    const call = { id: 'read-one', type: 'function', function: { name: 'read', arguments: '{"id":"material-one"}' } };
    bridge.chat.mockReturnValue(stream(completion(null, [call]), [{ type: 'delta', data: { content: '查一下' } }, { type: 'delta', data: { tool_calls: [call] } }]));
    const signal = new AbortController().signal, shown: string[] = [];
    const answer = await askRuntime(runtimeRequest('deepseek-web', messages, situation, false, 'chat-one'), text => shown.push(text), signal);
    expect(answer.tool_calls).toEqual([call]); expect(shown).toEqual(['查一下']);
    expect(bridge.chat).toHaveBeenCalledOnce();
    expect(bridge.chat.mock.calls[0]?.[0]).not.toHaveProperty('key'); expect(bridge.chat.mock.calls[0]?.[0]).not.toHaveProperty('temperature');
    expect(bridge.chat.mock.calls[0]?.[1]).toEqual({ signal });
});

it('shows source failures and never falls back to free quota or a personal API', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    bridge.chat.mockReturnValue({ result: Promise.resolve(null), async *[Symbol.asyncIterator]() { throw new Error('DeepSeek page not ready'); } });
    await expect(askRuntime(runtimeRequest('deepseek-web', messages, situation, false, 'chat-one'), () => {}, new AbortController().signal)).rejects.toThrow('DeepSeek page not ready');
    expect(fetch).not.toHaveBeenCalled(); expect(bridge.chat).toHaveBeenCalledOnce();
    bridge.chat.mockReturnValue(stream(completion(null, [{ id: 'bad', type: 'function', function: { name: 'arbitrary_eval', arguments: '{}' } }])));
    await expect(askRuntime(runtimeRequest('deepseek-web', messages, situation, false, 'chat-one'), () => {}, new AbortController().signal)).rejects.toThrow('AI 回答未完成');
});

it('explains public source errors in Chinese by code while preserving other explicit diagnostics', async () => {
    const error = new LocalRuntimeError('Provider prose can change without affecting presentation.', 'provider_unavailable');
    expect(runtimeErrorMessage(error)).toBe('模型网站暂时不可用，请稍后再试。');
    bridge.chat.mockReturnValue({ result: Promise.resolve(null), async *[Symbol.asyncIterator]() { throw error; } });
    await expect(askRuntime(runtimeRequest('deepseek-web', messages, situation, false, 'chat-one'), () => {}, new AbortController().signal)).rejects.toThrow('模型网站暂时不可用，请稍后再试。');
    expect(runtimeErrorMessage(new LocalRuntimeError('specific owner-grant diagnostic', 'not_granted'))).toBe('specific owner-grant diagnostic');
});

it('discovers only owner-granted models and rejects an empty or malformed result', async () => {
    bridge.listModels.mockResolvedValue({ object: 'list', data: [{ id: 'deepseek-web', name: 'DeepSeek 网页' }, { id: 'deepseek-web' }] });
    expect(await runtimeModels()).toEqual([{ id: 'deepseek-web', name: 'DeepSeek 网页' }]);
    bridge.listModels.mockResolvedValue({ object: 'list', data: [] }); await expect(runtimeModels()).rejects.toThrow('尚未向本站开放模型');
    bridge.listModels.mockResolvedValue({ models: ['invented'] }); await expect(runtimeModels()).rejects.toThrow('模型列表无效');
});

it('migrates the runtime selection and the existing personal provider into the current settings', () => {
    const values = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    values.set('studev_ai_model', JSON.stringify({ use: 'runtime', own: { ...STARTING_OWN, key: 'test-only-old-key' }, runtime: { model: 'deepseek-web' } }));
    const settings = readModelSettings();
    expect(settings.selection).toEqual({ provider: 'runtime', model: 'deepseek-web' });
    expect(settings.providers).toMatchObject([{ kind: 'api', key: 'test-only-old-key', models: [{ id: STARTING_OWN.model, enabled: true }] }, { kind: 'runtime', key: '' }]);
    expect(JSON.parse(values.get('studev_ai_model')!)).toEqual(settings);
    expect(selectedProvider(settings, settings.selection)).toMatchObject({ id: 'runtime' });
    settings.providers[1]!.models[0]!.enabled = false;
    expect(selectedProvider(settings, settings.selection)).toBeUndefined();
});

it('keeps all dialogue, and explicitly retries the same accepted request without repeating completed tools', async () => {
    const history = Array.from({ length: 32 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `message ${i}` }));
    const request = runtimeRequest('deepseek-web', history, situation, false, 'chat-one');
    expect(request.messages.filter(message => message.role !== 'system')).toHaveLength(32);
    bridge.chat.mockReturnValue(stream(completion('done')));
    await askRuntime(request, () => {}, new AbortController().signal, true);
    expect(bridge.chat.mock.calls[0]?.[0]).toEqual({ ...request, retry: true });
    bridge.chat.mockReturnValue(stream({ ...completion('wrong session'), conversation_id: 'another-chat' }));
    await expect(askRuntime(request, () => {}, new AbortController().signal)).rejects.toThrow('未返回完整');
});

it('uses persisted branch anchors while tools, follow-ups and interrupted text keep their conversation', () => {
    let thread = append(emptyThread(), '', 'u1', { role: 'user', content: 'question' });
    thread = append(thread, 'u1', 'a1', { role: 'assistant', content: 'answer' });
    thread = append(thread, 'u1', 'fork-one', { role: 'assistant', content: '', tool_calls: [] });
    thread = append(thread, 'fork-one', 'tool-one', { role: 'tool', content: 'result', tool_call_id: 'call-one' });
    thread = append(thread, 'tool-one', 'partial', { role: 'assistant', content: 'partial answer' });
    thread = append(thread, 'partial', 'follow-up', { role: 'user', content: 'continue' });
    const restored = JSON.parse(JSON.stringify({ thread, forks: ['fork-one'] }));
    expect(conversationId(restored.thread, 'follow-up', 'chat-one', restored.forks)).toBe('fork-one');
    expect(conversationId(choose(thread, 'a1'), 'a1', 'chat-one', restored.forks)).toBe('chat-one');
    expect(conversationId(thread, 'u1', 'chat-one', restored.forks)).toBe('chat-one');
});

it('closes the models actually used by one local chat and its branches without deleting website history', async () => {
    bridge.closeConversation.mockResolvedValue({ closed: true });
    await closeRuntimeChat('chat-one', ['fork-one', 'fork-one'], ['web-one', 'web-two', 'web-one']);
    expect(bridge.closeConversation.mock.calls.map(call => call.slice(0,2))).toEqual([
        ['web-one','chat-one'],['web-one','fork-one'],['web-two','chat-one'],['web-two','fork-one'],
    ]);
    bridge.closeConversation.mockRejectedValue(new Error('offline'));
    await expect(closeRuntimeChat('chat-one', [], ['web-one'])).rejects.toThrow('本机对话已删除');
});
