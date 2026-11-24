// Asking the model, its answer read as it comes. Through the platform, its events are `delta` (the next piece of what
// it says), then `message` (the whole turn, tool calls put together) or `error`. With one's own key, the provider is
// asked straight from this device and its stream read the same way the platform reads it (assistant.mjs).
import { requestSession, session, type Session } from '../../platform/client/api';
import { Completion, completionRequest, type Situation, type ToolContext } from '@/world/assistant.mjs';
import { addressError, endpoint, type Own } from './model';

export interface Call { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Message { role: 'user' | 'assistant' | 'tool'; content: string | null; tool_call_id?: string; tool_calls?: Call[] }

export class AskError extends Error {}

/** The platform checks the session and quota. Only the campus context goes to the model. */
export async function ask(messages: Message[], situation: Situation, last: boolean, onDelta: (text: string) => void, signal: AbortSignal, context: ToolContext = {}): Promise<Message> {
    // Reading the session also renews it when its short-lived pass has run out.
    const current = await requestSession();
    if (!current) throw new AskError('请先登录。');
    const body = JSON.stringify({ messages, last, situation, toolNames: context.tools?.map(tool => tool.function.name),
        externalTools: (context.external ?? context.tools)?.filter(tool => tool.function.name.startsWith('mcp_')), preferredTools: context.preferred, reach: context.reach });
    const send = (proof: Session) => fetch('/api/platform/ai', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-CSRF-Token': proof.csrfToken }, body });
    const explain = async (response: Response) => (await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null)?.error;
    let response = await send(current);
    let error = !response.ok ? await explain(response) : undefined;
    // These rejections happen before the platform spends quota or calls the model.
    if (response.status === 401 && (error?.code === 'TOKEN_INVALID' || error?.code === 'AUTH_REQUIRED')) {
        signal.throwIfAborted();
        const refreshed = await session();
        signal.throwIfAborted();
        if (refreshed?.user.id !== current.user.id) throw new AskError('请重新登录后再发送。');
        response = await send(refreshed);
        error = !response.ok ? await explain(response) : undefined;
    }
    if (!response.ok || !response.body) throw new AskError(error?.message ?? 'AI 暂时无法响应，请稍后重试。');
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

/** Asking with one's own key, straight from this device: no sign-in, nothing through the platform. */
export async function askOwn(own: Own, messages: Message[], situation: Situation, last: boolean, onDelta: (text: string) => void, signal: AbortSignal, context: ToolContext = {}): Promise<Message> {
    const invalid = addressError(own.base);
    if (invalid) throw new AskError(invalid);
    let response: Response;
    try {
        response = await fetch(endpoint(own.base), { method: 'POST', signal, cache: 'no-store', redirect: 'error', credentials: 'omit',
            headers: { Authorization: `Bearer ${own.key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(completionRequest(own.model, messages, situation, Date.now(), last, context)) });
    } catch (failure) {
        if (signal.aborted) throw failure;
        throw new AskError('连不上你填的接口地址，检查一下地址和网络。');
    }
    if (!response.ok || !response.body) {
        const said = await response.text().catch(() => '');
        const detail = (() => { try { return (JSON.parse(said) as { error?: { message?: string } }).error?.message; } catch { return undefined; } })();
        throw new AskError(response.status === 401 ? 'API Key 不对，请在「AI → 模型」检查。' : response.status === 402 ? '你的 API 余额不足。'
            : response.status === 404 ? `接口或模型不存在${detail ? `：${detail}` : '，检查地址和模型名。'}` : response.status === 429 ? '你的 API 请求太频繁，稍后再试。' : `你的 API 没有回答（${response.status}）${detail ? `：${detail}` : ''}`);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const completion = new Completion(last ? [] : context.tools?.map(tool => tool.function.name));
    let pending = '';
    let event = '';
    const take = (line: string) => {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (!line.trim()) event = '';
        if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data && data !== '[DONE]') {
                const value = JSON.parse(data) as { error?: string | { message?: string }; message?: string };
                if (value.error) throw new AskError(typeof value.error === 'string' ? value.error : value.error.message || '模型接口在回答途中出错。');
                if (event === 'error') throw new AskError(typeof value.message === 'string' ? value.message : '模型接口在回答途中出错。');
            }
        }
        const piece = completion.take(line); if (piece) onDelta(piece);
    };
    try {
        for (let read = await reader.read(); !read.done; read = await reader.read()) {
            pending += read.value;
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() ?? '';
            lines.forEach(take);
        }
        take(pending);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const { message, error } = completion.result();
    if (!message) throw new AskError(error);
    return message as Message;
}
