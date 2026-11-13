// What the AI looked up, as the steps under a question say it: one line for the whole (搜索资料 ×2 · 读原文 · 规划路线),
// and each step with what it asked and what came back (搜索资料 “补考报名” · 6 条). The same call made twice is one
// step, where it was first taken, with what it last found. The same words are android/.../ai/Steps.kt.
import { dateLabel, hm } from '@/world/time';

export interface Step { name: string; label: string; detail: string; failed: boolean; pending: boolean }
export interface Call { id: string; name: string; arguments: string }

const LABELS: Record<string, string> = {
    search: '搜索资料', read: '读原文', find_place: '找地点', nearby: '找附近', route: '规划路线', timeline: '查看安排', exams: '查考试', list_tasks: '读取任务',
    suggest_slots: '找空闲时间', free_rooms: '查空教室', propose_task: '起草任务', remember: '记住',
};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
const field = (value: unknown, key: string): unknown => value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
const days = (from: string, to: string) => from === to ? dateLabel(from) : `${dateLabel(from)}–${dateLabel(to)}`;

/** What one call asked, and what came back once it has. */
function detail(name: string, args: Record<string, unknown>, result: unknown, done: boolean): string {
    const quoted = (key: string) => `“${text(args[key])}”`;
    switch (name) {
        case 'search': return `${quoted('query')}${args.in && args.in !== '全部' ? ` · ${text(args.in)}` : ''}${done ? ` · ${count(result)} 条` : ''}`;
        case 'read': return done && text(field(result, 'title')) ? `《${text(field(result, 'title'))}》` : '';
        case 'find_place': { const first = Array.isArray(result) ? text(field(result[0], 'name')) : ''; return `${quoted('query')}${done ? first ? ` → ${first}` : ' · 没找到' : ''}`; }
        case 'nearby': { const places = field(result, 'places'); return `${text(field(result, 'near')) || text(args.near)}附近的${text(args.what)}${done && Array.isArray(places) ? ` · ${places.length} 处` : ''}`; }
        case 'route': { const metres = field(result, 'distance_m'); return `${text(field(result, 'from')) || text(args.from)} → ${text(field(result, 'to')) || text(args.to)}${typeof metres === 'number' ? ` · ${Math.round(metres)} 米` : ''}`; }
        case 'timeline': return days(text(args.from), text(args.to));
        case 'exams': { const exams = field(result, 'exams'); return done && Array.isArray(exams) ? `${exams.length} 场` : ''; }
        case 'list_tasks': return done ? `${count(result)} 个` : '';
        case 'suggest_slots': return `${days(text(args.from), text(args.to))} · ${args.minutes} 分钟${done ? ` · ${count(result)} 个空档` : ''}`;
        case 'free_rooms': return `${dateLabel(text(args.date))} ${hm(args.minute as number)}${args.building ? ` · ${text(args.building)}` : ''}${done ? ` · ${count(field(result, 'rooms'))} 间` : ''}`;
        case 'propose_task': return quoted('title');
        case 'remember': return quoted('fact');
        default: return '';
    }
}

/** The steps of one answer, in the order they were taken, the same call made again taken once. */
export function stepsOf(calls: readonly Call[], results: ReadonlyMap<string, unknown>): Step[] {
    const steps = new Map<string, Step>();
    for (const call of calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.arguments) as Record<string, unknown>; } catch { /* Said badly: shown by its name alone. */ }
        const done = results.has(call.id), result = results.get(call.id);
        const error = text(field(result, 'error'));
        const key = `${call.name} ${JSON.stringify(args)}`;
        steps.set(key, { name: call.name, label: LABELS[call.name] ?? call.name, detail: error ? `${detail(call.name, args, undefined, false)}：${error}`.replace(/^：/, '') : detail(call.name, args, result, done), failed: Boolean(error), pending: !done });
    }
    return [...steps.values()];
}

/** The steps in one line: what was done, each kind once, with how many times. */
export function stepsLine(steps: readonly Step[]): string {
    const counts = new Map<string, number>();
    for (const step of steps) counts.set(step.label, (counts.get(step.label) ?? 0) + 1);
    return `${steps.some(step => step.pending) ? '正在' : '已'}${[...counts].map(([label, n]) => n > 1 ? `${label} ×${n}` : label).join(' · ')}`;
}
