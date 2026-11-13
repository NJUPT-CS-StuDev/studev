import { afterEach, expect, it, vi } from 'vitest';
import { askOwn } from './stream';
import { STARTING_OWN } from './model';

afterEach(() => vi.unstubAllGlobals());
const own = { ...STARTING_OWN, key: 'test-only-provider-key' };
const messages = [{ role: 'user' as const, content: '你好' }];
const situation = { week: 11, class: 'B240402', campus: '仙林', name: '吴双灿', student: 'B24040213', memory: null };

it('uses only the explicitly chosen provider, without platform credentials, and reads a split event stream', async () => {
    const encoder = new TextEncoder();
    const pieces = ['data: {"choices":[{"delta":{"content":"你"}}]}\r\n', '\r\ndata: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n'];
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(controller) { pieces.forEach(piece => controller.enqueue(encoder.encode(piece))); controller.close(); } })));
    vi.stubGlobal('fetch', fetch);
    let shown = '';
    const answer = await askOwn(own, messages, situation, (piece: string) => { shown += piece; }, new AbortController().signal);
    expect(answer).toEqual({ role: 'assistant', content: '你好' });
    expect(shown).toBe('你好');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer test-only-provider-key' } });
    // Told the moment and who is asking, as the platform tells it; no memory kept, so nothing to remember with.
    const body = JSON.parse(String(init.body)) as { messages: { content: string }[]; tools: { function: { name: string } }[] };
    expect(body.messages[0]!.content).toMatch(/本学期第 11 周。你在和仙林校区 B240402 班的吴双灿（学号 B24040213）说话/);
    expect(body.tools.map(tool => tool.function.name)).not.toContain('remember');
});

it('reports a failed personal key without falling back to the shared quota', async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"invalid"}}', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    await expect(askOwn(own, messages, situation, () => {}, new AbortController().signal)).rejects.toThrow('API Key 不对');
    expect(fetch).toHaveBeenCalledOnce();
});

it('does not send a key to an invalid or unencrypted provider address', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(askOwn({ ...own, base: 'http://example.org' }, messages, situation, () => {}, new AbortController().signal)).rejects.toThrow('https://');
    expect(fetch).not.toHaveBeenCalled();
});
