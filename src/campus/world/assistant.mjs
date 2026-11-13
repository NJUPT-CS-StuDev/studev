// The AI's one contract, the same through the platform's free quota or one's own key: what the model is told
// (assistant.json, filled in with the moment and who is asking), the tools it may call (tools.json), and how its streamed
// answer is read into the turn it makes. The platform relays with it (src/platform/server/ai.mjs); a browser with its
// own key talks to the provider with it directly (src/campus/ai/stream.ts). Android reads the same two files from its
// assets and does the same (android/.../ai/Assistant.kt).
import assistant from './assistant.json' with { type: 'json' };
import tools from './tools.json' with { type: 'json' };

export { tools };
export const DIAGRAMS = assistant.diagrams;
const names = new Set(tools.map(tool => tool.function.name));

/**
 * Who is asking and when, as far as this device knows: the teaching week (null outside one), the class and campus
 * chosen in “我”, the name and student number of the account signed in (null when not), and the memory one keeps
 * (null when it is turned off). Through the platform, the name and number are the platform's own, not the device's.
 * @typedef {{ week: number | null, class: string | null, campus: string, name: string | null, student: string | null, memory: string | null }} Situation
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** The moment in Nanjing, as people say it: 2026年11月13日 周五 16:40. */
export function nanjingNow(now = Date.now()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
        .formatToParts(new Date(now)).map(part => [part.type, part.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    return `${parts.year}年${parts.month}月${parts.day}日 ${WEEKDAYS[day]} ${parts.hour}:${parts.minute}`;
}

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));

/** Who the model is talking to, in a phrase: 仙林校区 B240402 班的吴双灿（学号 B24040213）. */
function who(situation) {
    const me = assistant.me;
    const where = fill(situation.class ? me.class : me.noClass, situation);
    return where + (situation.name ? fill(me.named, { name: situation.name, student: situation.student ?? '未知' }) : me.anyone);
}

/** What the model is told before the conversation. */
export function instructions(situation, now = Date.now()) {
    const week = situation.week === null ? assistant.week.out : fill(assistant.week.in, situation);
    const lines = assistant.prompt.map(line => fill(line, { now: nanjingNow(now), week, me: who(situation), diagrams: DIAGRAMS.join('、') }));
    if (situation.memory !== null) lines.push(...assistant.memory.map(line => fill(line, { memory: situation.memory.trim() || '（还没有）' })));
    return lines.join('\n');
}

/** The tools offered: all of them, but `remember` only to someone who keeps a memory. */
export const toolsFor = situation => situation.memory === null ? tools.filter(tool => tool.function.name !== 'remember') : tools;

/** The request a provider is sent, OpenAI's chat completions as every provider speaks it. */
export const completionRequest = (model, messages, situation, now = Date.now()) =>
    ({ model, stream: true, max_tokens: 2048, temperature: 0.2, tools: toolsFor(situation), messages: [{ role: 'system', content: instructions(situation, now) }, ...messages] });

/** Why what a device says about its situation cannot be taken, or null. The platform fills in name and number itself. */
export function situationError(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '缺少当前情况。';
    const { week, campus, memory } = value, cls = value.class;
    if (!(week === null || (Number.isInteger(week) && week >= 1 && week <= 30))) return '教学周无效。';
    if (!(cls === null || (typeof cls === 'string' && /^[A-Za-z0-9]{2,16}$/.test(cls)))) return '班级无效。';
    if (typeof campus !== 'string' || !/^[\u4e00-\u9fa5]{1,8}$/.test(campus)) return '校区无效。';
    if (!(memory === null || (typeof memory === 'string' && memory.length <= 4000))) return '记忆太长了，删掉一些再问。';
    return null;
}

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
