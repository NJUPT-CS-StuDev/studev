import { createLRMCPClient } from '@local-runtime-mcp/browser-extension/sdk';
import { Completion, completionRequest, type Situation } from '@/world/assistant.mjs';
import { AskError, type Message } from './stream';
import assistant from '@/world/assistant.json';

export interface RuntimeModel { id: string; name: string }

/** Public runtime codes stay language-neutral; this product explains them to the person. */
export function runtimeErrorMessage(error: unknown): string {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
    const messages: Record<string, string> = assistant.runtimeErrors;
    return messages[code] ?? (error instanceof Error ? error.message : '回答中断，未自动重发。');
}

/** Discovery uses the owner's origin grant; the page has no runtime or provider key. */
export async function runtimeModels(signal?: AbortSignal): Promise<RuntimeModel[]> {
    let value: unknown;
    try { value = await createLRMCPClient().listModels({ signal, timeoutMs: 6000 }); }
    catch (error) { throw new AskError(`Local Runtime 未连接或未授权本站：${runtimeErrorMessage(error)}`); }
    const body = value as { object?: string; data?: { id?: unknown; name?: unknown }[] } | null;
    if (body?.object !== 'list' || !Array.isArray(body.data)) throw new AskError('Local Runtime 返回的模型列表无效。');
    const models = new Map<string, RuntimeModel>();
    for (const item of body.data) if (typeof item.id === 'string' && item.id.trim() && !models.has(item.id)) {
        models.set(item.id, { id: item.id, name: typeof item.name === 'string' && item.name.trim() ? item.name : item.id });
    }
    if (!models.size) throw new AskError('Local Runtime 尚未向本站开放模型，请在本机配置后重新连接。');
    return [...models.values()];
}

/** Same conversation and tools, without claiming control over a website model's sampling or token limits. */
export function runtimeRequest(model: string, messages: Message[], situation: Situation, last: boolean, conversation_id: string) {
    if (!conversation_id) throw new AskError('本次对话缺少会话标识。');
    const request = completionRequest(model, messages, situation, Date.now(), last);
    return { model: request.model, stream: request.stream, conversation_id, messages: request.messages, ...(request.tools ? { tools: request.tools } : {}) };
}
export type RuntimeRequest = ReturnType<typeof runtimeRequest>;

/** Closing a local chat releases only its scoped runtime pages, not website history. */
export async function closeRuntimeChat(chatId: string, forks: readonly string[], models: readonly string[]): Promise<void> {
    const client = createLRMCPClient();
    const ids = [...new Set([chatId, ...forks])];
    const targets = [...new Set(models)].flatMap(model => ids.map(id => ({ model, id })));
    let failed = false;
    for (let offset = 0; offset < targets.length; offset += 4) {
        const results = await Promise.allSettled(targets.slice(offset, offset + 4).map(({ model, id }) => client.closeConversation(model, id, { timeoutMs: 10_000 })));
        failed ||= results.some(result => result.status === 'rejected');
    }
    if (failed) throw new AskError('本机对话已删除，部分模型页面尚未关闭，请在浏览器中查看。');
}

export async function askRuntime(request: RuntimeRequest, onDelta: (text: string) => void, signal: AbortSignal, retry = false): Promise<Message> {
    if (!request.model) throw new AskError('先连接 Local Runtime 并选择一个模型。');
    const call = createLRMCPClient().chat({ ...request, ...(retry ? { retry: true } : {}) }, { signal });
    try {
        for await (const event of call) {
            if (event.type !== 'delta') continue;
            const delta = event.data as { content?: unknown } | undefined;
            if (typeof delta?.content === 'string' && delta.content) onDelta(delta.content);
        }
        const value = await call.result as { object?: string; conversation_id?: string; choices?: { message?: unknown; finish_reason?: unknown }[] } | null;
        const choice = value?.choices?.[0];
        const answer = choice?.message as { role?: string; content?: unknown; tool_calls?: unknown } | undefined;
        if (value?.object !== 'chat.completion' || value.conversation_id !== request.conversation_id || answer?.role !== 'assistant' || !(answer.content === null || typeof answer.content === 'string')) {
            throw new AskError('Local Runtime 未返回完整的模型回答。');
        }
        // Reuse the product's current validated tool-call decoder rather than a second tool protocol.
        const completion = new Completion();
        completion.take(`data: ${JSON.stringify({ choices: [{ delta: answer, finish_reason: choice?.finish_reason }] })}`);
        const result = completion.result();
        if (!result.message) throw new AskError(result.error);
        return result.message as Message;
    } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof AskError) throw error;
        throw new AskError(runtimeErrorMessage(error));
    }
}
