// The AI's one contract, the same through the platform's free quota or one's own key: what the model is told
// (assistant.json, filled in with the campus and teaching context), the tools it may call (tools.json), and how its streamed
// answer is read into the turn it makes. The platform relays with it (src/platform/server/ai.mjs); a browser with its
// own key talks to the provider with it directly (src/campus/ai/stream.ts). Android reads the same two files from its
// assets and does the same (android/.../ai/Assistant.kt).
import assistant from './assistant.json' with { type: 'json' };
import tools from './tools.json' with { type: 'json' };

export { tools };
export const DIAGRAMS = assistant.diagrams;
const names = new Set(tools.map(tool => tool.function.name));

/**
 * Teaching week (null unknown, 0 outside one), the chosen class and campus, and memory when the person enables it.
 * @typedef {{ week: number | null, class: string | null, campus: string, memory: string | null }} Situation
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

/** The person's campus and class, in a phrase. */
function campusContext(situation) {
    const me = assistant.me;
    return fill(situation.class ? me.class : me.noClass, situation) + me.anyone;
}

/** What the model is told before the conversation. */
export function instructions(situation, now = Date.now()) {
    const week = situation.week === null ? assistant.week.unknown : situation.week === 0 ? assistant.week.out : fill(assistant.week.in, situation);
    const lines = assistant.prompt.map(line => fill(line, { now: nanjingNow(now), week, me: campusContext(situation), diagrams: DIAGRAMS.join('、') }));
    if (situation.memory !== null) lines.push(...assistant.memory.map(line => fill(line, { memory: situation.memory.trim() || '（还没有）' })));
    return lines.join('\n');
}

/** The tools offered: all of them, but `remember` only to someone who keeps a memory. */
export const toolsFor = situation => situation.memory === null ? tools.filter(tool => tool.function.name !== 'remember') : tools;

/** How many times the model may look things up for one question; the last time it must answer with what it found. */
export const ROUNDS = 8;

/** The request a provider is sent, OpenAI's chat completions as every provider speaks it; `last`, it may call no more tools. */
export const completionRequest = (model, messages, situation, now = Date.now(), last = false) =>
    ({ model, stream: true, max_tokens: 4096, temperature: 0.2, ...(!last ? { tools: toolsFor(situation) } : {}), messages: [{ role: 'system', content: instructions(situation, now) + (last ? `\n${assistant.finish}` : '') }, ...messages] });

/** Why the campus context is invalid, or null if it can be used. */
export function situationError(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '缺少当前情况。';
    const { week, campus, memory } = value, cls = value.class;
    if (!(week === null || (Number.isInteger(week) && week >= 0 && week <= 30))) return '教学周无效。';
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
    pending = ''; protocolError = false;
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
        if (this.protocolError) return '';
        this.pending += typeof delta.content === 'string' ? delta.content : '';
        // Provider-native tool syntax is not an answer or a validated function call. Hold a split prefix until
        // it is known, then reject the malformed turn rather than showing or silently discarding a fake lookup.
        const markers = ['<｜DSML｜', '<|DSML|'];
        const found = markers.map(marker => this.pending.indexOf(marker)).filter(at => at >= 0);
        if (found.length) {
            const piece = this.pending.slice(0, Math.min(...found));
            this.content += piece; this.pending = ''; this.protocolError = true;
            return piece;
        }
        let held = 0;
        for (let size = 1; size <= this.pending.length && size < 8; size++) if (markers.some(marker => marker.startsWith(this.pending.slice(-size)))) held = size;
        if (this.finish) {
            if (held > 1) { this.protocolError = true; this.pending = ''; return ''; }
            held = 0;
        }
        const piece = this.pending.slice(0, this.pending.length - held);
        this.pending = this.pending.slice(this.pending.length - held);
        this.content += piece;
        return piece;
    }
    /** The turn, once the stream has ended: `{ message }`, or `{ error }` when it stopped short or called what it may not. */
    result() {
        if (this.protocolError) return { error: '模型未能正确发起查询，请重试。' };
        const made = this.calls.filter(Boolean);
        // An answer cut at its length is still an answer, what it got to say; a cut tool call is not.
        const whole = ['stop', 'tool_calls'].includes(this.finish) || (this.finish === 'length' && !made.length && this.content);
        if (!whole || made.some(call => !call.id || !names.has(call.function.name))) return { error: 'AI 回答未完成，请缩短问题后重试。' };
        return { message: { role: 'assistant', content: this.content || null, ...(made.length ? { tool_calls: made } : {}) } };
    }
}
