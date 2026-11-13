// The AI's one contract, the same through the platform's free quota or one's own key: what the model is told
// (assistant.json, today's date filled in), the tools it may call (tools.json), and how its streamed answer is read
// into the turn it makes. The platform relays with it (src/platform/server/ai.mjs); a browser with its own key talks
// to the provider with it directly (src/campus/ai/stream.ts). Android reads the same two files from its assets and
// reads the stream the same way (android/.../ai/Completion.kt).
import assistant from './assistant.json' with { type: 'json' };
import tools from './tools.json' with { type: 'json' };

export { tools };
const names = new Set(tools.map(tool => tool.function.name));

/** The day it is in Nanjing, as YYYY-MM-DD. */
export const nanjingDate = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));

/** What the model is told before the conversation. */
export const instructions = (now = Date.now()) => assistant.prompt.join('\n').replaceAll('{date}', nanjingDate(now));

/** The request a provider is sent, OpenAI's chat completions as every provider speaks it. */
export const completionRequest = (model, messages, now = Date.now()) =>
    ({ model, stream: true, max_tokens: 2048, temperature: 0.2, tools, messages: [{ role: 'system', content: instructions(now) }, ...messages] });

/**
 * A streamed answer read line by line: each line gives the next piece of what is said (if any); at the end, the whole
 * turn with its tool calls put together, or why it is not one. What the model thinks before answering is dropped.
 */
export class Completion {
    content = ''; finish = null; calls = [];
    /** One line of the stream; the piece of the answer it adds, or ''. */
    take(line) {
        if (!line.startsWith('data:')) return '';
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return '';
        const choice = JSON.parse(data).choices?.[0];
        if (!choice) return '';
        const delta = choice.delta ?? {};
        for (const part of delta.tool_calls ?? []) {
            const call = this.calls[part.index ?? this.calls.length] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (part.id) call.id = part.id;
            if (part.function?.name) call.function.name += part.function.name;
            if (part.function?.arguments) call.function.arguments += part.function.arguments;
        }
        if (choice.finish_reason) this.finish = choice.finish_reason;
        const piece = typeof delta.content === 'string' ? delta.content : '';
        this.content += piece;
        return piece;
    }
    /** The turn, once the stream has ended: `{ message }`, or `{ error }` when it stopped short or called what it may not. */
    result() {
        const made = this.calls.filter(Boolean);
        if (!['stop', 'tool_calls'].includes(this.finish) || made.some(call => !call.id || !names.has(call.function.name))) return { error: 'AI 回答未完成，请缩短问题后重试。' };
        return { message: { role: 'assistant', content: this.content || null, ...(made.length ? { tool_calls: made } : {}) } };
    }
}
