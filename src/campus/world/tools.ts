import definitions from './tools.json';
import { dueOn, eventsOn, type Timeline } from './events';
import { availableSlots } from './planning';
import { addDays, daysBetween, momentNow, type Moment } from './time';
import { sanitizeTask, type Task } from './tasks';

export { definitions };
export interface TaskProposal { task: Omit<Task, 'id' | 'modified'>; id?: string; expected?: string }
export function toolArguments(name: string, raw: unknown): Record<string, unknown> {
    const schema = definitions.find(tool => tool.function.name === name)?.function.parameters;
    if (!schema || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工具参数无效。');
    const args = raw as Record<string, unknown>, properties = schema.properties as Record<string, { type: string; minimum?: number; maximum?: number; enum?: string[] }>;
    if (Object.keys(args).some(key => !properties[key]) || (schema.required ?? []).some(key => args[key] === undefined)) throw new Error('缺少工具参数或存在未知参数。');
    for (const [key, value] of Object.entries(args)) {
        const field = properties[key]!;
        if ((field.type === 'string' && (typeof value !== 'string' || value.length > 2000)) || (field.type === 'integer' && (!Number.isInteger(value) || typeof value !== 'number' || value < (field.minimum ?? 0) || value > (field.maximum ?? 1440))) || (field.type === 'boolean' && typeof value !== 'boolean') || (field.enum && !field.enum.includes(value as string))) throw new Error('工具参数类型或范围无效。');
    }
    return args;
}
export const toolDate = (raw: unknown) => {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || addDays(raw, 0) !== raw) throw new Error('日期无效。');
    return raw;
};
export function taskProposal(args: Record<string, unknown>, line: Timeline): TaskProposal {
    const old = args.id ? line.tasks.find(task => task.id === args.id && !task.deleted) : undefined;
    if (args.id && !old) throw new Error('要修改的任务不存在。');
    const next: Task = { ...(old ?? { id: 'proposal', modified: 'proposal' }), title: String(args.title).trim() };
    if (args.date !== undefined) { next.date = toolDate(args.date); next.start = args.start as number | undefined; next.end = args.end as number | undefined; }
    else { if (args.start !== undefined) next.start = args.start as number; if (args.end !== undefined) next.end = args.end as number; }
    if (args.due_date !== undefined) next.due = { ...old?.due, date: toolDate(args.due_date), ...(args.due_time !== undefined ? { time: args.due_time as number } : {}) };
    else if (args.due_time !== undefined) { if (!next.due) throw new Error('请先给出截止日期。'); next.due = { ...next.due, time: args.due_time as number }; }
    if (args.note !== undefined) next.note = String(args.note);
    if (args.done !== undefined) next.done = args.done ? 'awaiting-confirmation' : undefined;
    if (!next.title || (next.date && next.start === undefined) || (next.start !== undefined && !next.date) || (next.end !== undefined && (next.start === undefined || next.end <= next.start))) throw new Error('执行安排需要有效日期、开始和结束；截止请单独指定。');
    const safe = sanitizeTask(next);
    if (!safe) throw new Error('任务草案无效。');
    const { id, modified, ...task } = safe;
    return { task, ...(old ? { id: old.id, expected: old.modified } : {}) };
}
export function readTimeline(line: Timeline, from: string, to: string) {
    const count = daysBetween(toolDate(from), toolDate(to));
    if (count < 0 || count > 13) throw new Error('一次最多查询 14 天。');
    return Array.from({ length: count + 1 }, (_, i) => {
        const date = addDays(from, i);
        return { date, events: eventsOn(line, date).map(event => ({ id: event.id, kind: event.kind, name: event.name, start: event.start, end: event.end, room: event.room, avoid: event.avoid, layer: event.layer })), due: dueOn(line, date).map(task => ({ id: task.id, title: task.title, due: task.due, done: Boolean(task.done) })) };
    });
}
export function schedulingTool(line: Timeline, args: Record<string, unknown>, now: Moment = momentNow()) {
    const from = toolDate(args.from), to = toolDate(args.to);
    if (daysBetween(from, to) < 0 || daysBetween(from, to) > 13) throw new Error('一次最多排 14 天。');
    const task = args.task_id ? line.tasks.find(task => task.id === args.task_id && !task.deleted) : undefined;
    if (args.task_id && !task) throw new Error('要移动的任务不存在。');
    return availableSlots(line, { from, to, minutes: args.minutes as number, exclude: task?.id, due: task?.due }, now).slice(0, 12);
}
