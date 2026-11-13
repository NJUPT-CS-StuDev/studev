// Asking the model through the platform, its answer read as it comes: the platform's events are `delta` (the next
// piece of what it says), then `message` (the whole turn, tool calls put together) or `error`.
import { session } from '../../platform/client/api';

export interface Call { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Message { role: 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: Call[] }

export class AskError extends Error {}

export async function ask(messages: Message[], onDelta: (text: string) => void, signal: AbortSignal): Promise<Message> {
    // Reading the session also renews it when its short-lived pass has run out.
    const current = await session();
    if (!current) throw new AskError('请先登录。');
    const response = await fetch('/api/platform/ai', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-CSRF-Token': current.csrfToken }, body: JSON.stringify({ messages }) });
    if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new AskError(body?.error?.message ?? 'AI 暂时无法响应，请稍后重试。');
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = '';
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
        pending += read.value;
        const blocks = pending.split('\n\n');
        pending = blocks.pop() ?? '';
        for (const block of blocks) {
            const event = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
            if (!event || !data) continue;
            const value = JSON.parse(data) as { content?: string; message?: Message | string };
            if (event === 'delta' && value.content) onDelta(value.content);
            else if (event === 'message' && typeof value.message === 'object') return value.message;
            else if (event === 'error') throw new AskError(typeof value.message === 'string' ? value.message : 'AI 暂时无法响应。');
        }
    }
    throw new AskError('回答中断了，请重试。');
}
