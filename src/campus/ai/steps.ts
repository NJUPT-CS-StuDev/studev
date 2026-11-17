// What the AI looked up, as the steps under a question say it: one line for the whole (搜索资料 ×2 · 读原文 · 规划路线),
// and each call with what it asked and what came back (搜索资料 “补考报名” · 6 条), including failed attempts and retries.
// The same words are android/.../ai/Steps.kt.
import { dateLabel, hm } from '@/world/time';

export interface Step { name: string; label: string; detail: string; failed: boolean; pending: boolean }
export interface Call { id: string; name: string; arguments: string }

const LABELS: Record<string, string> = {
    search: '搜索资料', read: '读原文', course: '看课程', schedule: '查上课安排', curriculum: '查培养方案', find_place: '找地点', nearby: '找附近', route: '规划路线', timeline: '查看安排', exams: '查考试', list_tasks: '读取任务',
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
        case 'course': { const chapters = field(result, 'chapters'); return `${text(field(result, 'course')) ? `《${text(field(result, 'course'))}》` : quoted('course')}${done ? Array.isArray(chapters) ? ` · ${chapters.length} 章` : ' · 没找到' : ''}`; }
        case 'schedule': { const n = field(result, 'count'); return `${quoted('of')}${done ? typeof n === 'number' && n ? ` · ${n} 次课` : ' · 没有' : ''}`; }
        case 'curriculum': { const terms = field(result, 'terms'); return `${text(field(result, 'major')) || text(args.major)}${args.grade ? ` ${text(args.grade)} 级` : ''}${done ? Array.isArray(terms) ? ` · ${terms.length} 个学期` : ' · 没找到' : ''}`; }
        case 'read': return done && text(field(result, 'title')) ? `《${text(field(result, 'title'))}》` : quoted('id');
        case 'find_place': { const first = Array.isArray(result) ? text(field(result[0], 'name')) : ''; return `${quoted('query')}${done ? first ? ` → ${first}` : ' · 没找到' : ''}`; }
        case 'nearby': { const places = field(result, 'places'); return `${text(field(result, 'near')) || text(args.near)}附近的${text(args.what)}${done && Array.isArray(places) ? ` · ${places.length} 处` : ''}`; }
        case 'route': { const metres = field(result, 'distance_m'); return `${text(field(result, 'from')) || text(args.from)} → ${text(field(result, 'to')) || text(args.to)}${field(result, 'scope') === 'within-building' ? ` · 同在${text(field(result, 'building'))}` : typeof metres === 'number' ? ` · ${Math.round(metres)} 米${text(field(result, 'arrival')) ? ` · 到${text(field(result, 'arrival'))}` : ''}` : ''}`; }
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

/** Every call in order; a retry never overwrites an earlier attempt. */
export function stepsOf(calls: readonly Call[], results: ReadonlyMap<string, unknown>): Step[] {
    const steps: Step[] = [];
    for (const call of calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.arguments) as Record<string, unknown>; } catch { /* Said badly: shown by its name alone. */ }
        const done = results.has(call.id), result = results.get(call.id);
        const error = text(field(result, 'error'));
        steps.push({ name: call.name, label: LABELS[call.name] ?? call.name, detail: error ? `${detail(call.name, args, undefined, false)}：${error}`.replace(/^：/, '') : detail(call.name, args, result, done), failed: Boolean(error), pending: !done });
    }
    return steps;
}

/** The steps in one line: what was done, each kind once, with how many times. */
export function stepsLine(steps: readonly Step[]): string {
    const counts = new Map<string, { total: number; failed: number; pending: number }>();
    for (const step of steps) {
        const count = counts.get(step.label) ?? { total: 0, failed: 0, pending: 0 };
        count.total++; count.failed += Number(step.failed); count.pending += Number(step.pending);
        counts.set(step.label, count);
    }
    return [...counts].map(([label, n]) => `${label}${n.total > 1 ? ` ×${n.total}` : ''}${n.failed ? `（失败 ${n.failed}）` : ''}${n.pending ? `（进行中 ${n.pending}）` : ''}`).join(' · ');
}
