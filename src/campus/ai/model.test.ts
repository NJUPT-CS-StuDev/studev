import { afterEach, expect, it, vi } from 'vitest';
import { askOwn } from './stream';
import { STARTING_OWN } from './model';

afterEach(() => vi.unstubAllGlobals());
const own = { ...STARTING_OWN, key: 'test-only-provider-key' };
const messages = [{ role: 'user' as const, content: '你好' }];

it('uses only the explicitly chosen provider, without platform credentials, and reads a split event stream', async () => {
    const encoder = new TextEncoder();
    const pieces = ['data: {"choices":[{"delta":{"content":"你"}}]}\r\n', '\r\ndata: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n'];
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(controller) { pieces.forEach(piece => controller.enqueue(encoder.encode(piece))); controller.close(); } })));
    vi.stubGlobal('fetch', fetch);
    let shown = '';
    const answer = await askOwn(own, messages, piece => { shown += piece; }, new AbortController().signal);
    expect(answer).toEqual({ role: 'assistant', content: '你好' });
    expect(shown).toBe('你好');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer test-only-provider-key' } });
});

it('reports a failed personal key without falling back to the shared quota', async () => {
    const fetch = vi.fn(async () => new Response('{"error":{"message":"invalid"}}', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    await expect(askOwn(own, messages, () => {}, new AbortController().signal)).rejects.toThrow('API Key 无效');
    expect(fetch).toHaveBeenCalledOnce();
});

it('does not send a key to an invalid or unencrypted provider address', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(askOwn({ ...own, base: 'http://example.org' }, messages, () => {}, new AbortController().signal)).rejects.toThrow('HTTPS');
    expect(fetch).not.toHaveBeenCalled();
});
