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
 * @typedef {{ week: number | null, class: string | null, campus: string, memory: string | null, instructions?: string }} Situation
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
    lines.push(assistant.style);
    if (situation.instructions?.trim()) lines.push(assistant.instructionIntro, situation.instructions.trim());
    if (situation.memory !== null) lines.push(...assistant.memory.map(line => fill(line, { memory: situation.memory.trim() || '（还没有）' })));
    return lines.join('\n');
}

/** The tools offered: all of them, but `remember` only to someone who keeps a memory. */
export const toolsFor = situation => situation.memory === null ? tools.filter(tool => tool.function.name !== 'remember') : tools;

/** How many times the model may look things up for one question; the last time it must answer with what it found. */
export const ROUNDS = 8;

/** The request a provider is sent, OpenAI's chat completions as every provider speaks it; `last`, it may call no more tools. */
/** @typedef {{type:'function',function:{name:string,description:string,parameters:object}}} ModelTool */
/** What this device can reach besides the campus tools, as facts the client saw; phrased here for every client.
 * @typedef {{runtime: 'ready'|'offline'|'unknown', models: string[], on: string[], off: string[], free: boolean, remote: string[]}} Reach */
/** @param {Reach} reach */
export function reachText(reach) {
    const said = assistant.reach, list = values => values.join('、');
    const lines = [said.intro, said[reach.runtime]];
    if (reach.runtime === 'ready') {
        if (reach.models.length) lines.push(said.models.replace('{list}', list(reach.models)));
        if (reach.on.length) lines.push(said.on.replace('{list}', list(reach.on)));
        if (reach.off.length) lines.push(said.off.replace('{list}', list(reach.off)));
        if (!reach.on.length && !reach.off.length) lines.push(said.none);
        if (reach.free && reach.on.length) lines.push(said.free);
    }
    lines.push(reach.remote.length ? said.remote.replace('{list}', list(reach.remote)) : said.noRemote);
    return lines.join('\n');
}
/** Why a reach is not usable, or null. */
export function reachError(value) {
    const names = list => Array.isArray(list) && list.length <= 24 && list.every(item => typeof item === 'string' && item.length > 0 && item.length <= 60);
    if (!value || typeof value !== 'object' || !['ready', 'offline', 'unknown'].includes(value.runtime) || typeof value.free !== 'boolean') return '连接状态无效。';
    return ['models', 'on', 'off', 'remote'].every(key => names(value[key])) ? null : '连接状态无效。';
}
/** @typedef {{tools?: ModelTool[], preferred?: string[], external?: ModelTool[], reach?: Reach}} ToolContext */
/** @param {ToolContext} context */
export const completionRequest = (model, messages, situation, now = Date.now(), last = false, context = {}) => {
    const available = context.tools ?? toolsFor(situation);
    const named = (context.preferred ?? []).filter(name => available.some(tool => tool.function.name === name));
    const reach = context.reach ? `\n${reachText(context.reach)}` : '';
    const preference = !last && named.length
        ? `\n用户在这轮问题里用“/工具名”点名了这些工具：${named.join('、')}。按问题里各自对应的要求优先调用；缺少必要信息时先向用户提问。` : '';
    return { model, stream: true, max_tokens: 4096, temperature: 0.2, ...(!last ? { tools: available } : {}),
        messages: [{ role: 'system', content: instructions(situation, now) + reach + (last ? `\n${assistant.finish}` : preference) }, ...messages] };
};

/** Why the campus context is invalid, or null if it can be used. */
export function situationError(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '缺少当前情况。';
    const { week, campus, memory } = value, cls = value.class;
    if (!(week === null || (Number.isInteger(week) && week >= 0 && week <= 30))) return '教学周无效。';
    if (!(cls === null || (typeof cls === 'string' && /^[A-Za-z0-9]{2,16}$/.test(cls)))) return '班级无效。';
    if (typeof campus !== 'string' || !/^[\u4e00-\u9fa5]{1,8}$/.test(campus)) return '校区无效。';
    if (!(memory === null || (typeof memory === 'string' && memory.length <= 4000))) return '记忆太长了，删掉一些再问。';
    if (value.instructions !== undefined && (typeof value.instructions !== 'string' || value.instructions.length > 12000)) return '指令太长了，请缩短后再问。';
    return null;
}

/**
 * A streamed answer read line by line: each line gives the next piece of what is said (if any); at the end, the whole
 * turn with its tool calls put together, or why it is not one. What the model thinks before answering is dropped.
 */
const BAR = '[|｜]';
const NATIVE = new RegExp(`<\\s*/?\\s*${BAR}[\\s|｜]*DSML[\\s|｜]*${BAR}`);
const NATIVE_START = new RegExp(`<(?:\\s*${BAR}[\\s|｜]*(?:D(?:S(?:ML?)?)?)?)?[\\s|｜]*$`);

/** The calls a DSML block spells out: each invoke's name and parameters, `string="false"` ones read as JSON. */
export function nativeCalls(text) {
    const plain = text.replace(new RegExp(`${BAR}[\\s|｜]*DSML[\\s|｜]*${BAR}`, 'g'), 'DSML:').replace(/<\s*(\/?)\s*DSML:\s*/g, '<$1DSML:');
    const calls = [];
    for (const [, name, body] of plain.matchAll(/<DSML:invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/DSML:invoke>/g)) {
        const args = {};
        for (const [, key, raw, value] of body.matchAll(/<DSML:parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?\s*>([\s\S]*?)<\/DSML:parameter>/g)) {
            if (raw === 'false') { try { args[key] = JSON.parse(value); } catch { return []; } } else args[key] = value;
        }
        calls.push({ id: `native-${calls.length}-${Math.random().toString(36).slice(2, 10)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    }
    return calls;
}

export class Completion {
    /** @param {Iterable<string>} [allowed] */
    constructor(allowed) { this.names = allowed ? new Set(allowed) : names; }
    content = ''; finish = null; calls = [];
    pending = ''; /** @type {string | null} */ native = null;
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
        this.pending += typeof delta.content === 'string' ? delta.content : '';
        // Provider-native tool syntax (DeepSeek's DSML, with however many bars and spaces it drew) is not an answer:
        // it is held back from the text and read as the calls it spells out once the stream ends.
        if (this.native !== null) { this.native += this.pending; this.pending = ''; return ''; }
        const found = NATIVE.exec(this.pending);
        if (found) {
            const piece = this.pending.slice(0, found.index);
            this.content += piece; this.native = this.pending.slice(found.index); this.pending = '';
            return piece;
        }
        // Hold a tail that could still become the markup until the next piece shows what it is.
        let held = this.finish ? 0 : (NATIVE_START.exec(this.pending)?.[0].length ?? 0);
        const piece = this.pending.slice(0, this.pending.length - held);
        this.pending = this.pending.slice(this.pending.length - held);
        this.content += piece;
        return piece;
    }
    /** The turn, once the stream has ended: `{ message }`, or `{ error }` when it stopped short or called what it may not. */
    result() {
        const made = this.calls.filter(Boolean);
        if (this.native !== null) {
            const spelled = nativeCalls(this.native);
            if (!spelled.length || made.length) return { error: '模型未能正确发起查询，请重试。' };
            made.push(...spelled);
            this.finish = 'tool_calls';
        }
        // An answer cut at its length is still an answer, what it got to say; a cut tool call is not.
        const whole = ['stop', 'tool_calls'].includes(this.finish) || (this.finish === 'length' && !made.length && this.content);
        if (!whole || made.some(call => !call.id || !this.names.has(call.function.name))) return { error: 'AI 回答未完成，请缩短问题后重试。' };
        return { message: { role: 'assistant', content: this.content || null, ...(made.length ? { tool_calls: made } : {}) } };
    }
}
