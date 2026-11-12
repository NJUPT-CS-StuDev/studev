// A person's own tasks. A deadline and planned execution are independent; only the latter occupies time.
// An unplanned task may have a deadline or wait for one. Nothing here leaves the device.
import { addDays, daysBetween, type Moment } from './time';

export interface Task {
    id: string;
    title: string;
    note?: string;
    /** The day planned for doing it. Independent of its deadline. */
    date?: string;
    /** Planned start and end, in minutes into the day. */
    start?: number;
    end?: number;
    /** When it must be finished. Without a time, by the end of that day. */
    due?: { date: string; time?: number; remind?: number[] };
    /** Minutes before planned execution; deadline reminders belong to due. */
    remind?: number[];
    /** 0 none, 1 low, 2 medium, 3 high. */
    priority?: 0 | 1 | 2 | 3;
    /** The task it is a step of. */
    parent?: string;
    /** The course it belongs to, by course identity. */
    course?: string;
    /** Where the person put it among the tasks of its group, by dragging it there; those never moved follow, by time. */
    order?: number;
    /** When it was done. */
    done?: string;
    /** When it last changed, and whether it was deleted: what a later sync merges by. */
    modified: string;
    deleted?: true;
}

const KEY = 'studev_tasks';
const EVENT = 'studev:tasks';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const minute = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440 ? value : undefined;
const text = (value: unknown, limit: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;

/** A stored task as it may be read back; anything that is not one is left out. */
export function sanitizeTask(raw: unknown): Task | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const id = text(record.id, 80), title = text(record.title, 200), modified = text(record.modified, 40);
    if (!id || !title || !modified) return null;
    const task: Task = { id, title, modified };
    const note = text(record.note, 4000); if (note) task.note = note;
    // A plan is a day and a start; a day alone is not one (that is a deadline, kept in `due`).
    // A plan may end at midnight (1440), the end of its day.
    const start = minute(record.start), end = record.end === 1440 ? 1440 : minute(record.end);
    if (typeof record.date === 'string' && DATE.test(record.date) && start !== undefined) { task.date = record.date; task.start = start; if (end !== undefined && end > start) task.end = end; }
    if (record.due && typeof record.due === 'object') {
        const due = record.due as Record<string, unknown>;
        if (typeof due.date === 'string' && DATE.test(due.date)) {
            task.due = { date: due.date };
            const time = minute(due.time); if (time !== undefined) task.due.time = time;
            if (Array.isArray(due.remind)) task.due.remind = [...new Set(due.remind.filter((value): value is number => Number.isInteger(value) && value >= 0 && value <= 10080))];
        }
    }
    if (Array.isArray(record.remind)) { const remind = [...new Set(record.remind.filter(value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7 * 1440))].sort((a, b) => a - b); if (remind.length) task.remind = remind; }
    if (record.priority === 1 || record.priority === 2 || record.priority === 3) task.priority = record.priority;
    const parent = text(record.parent, 80); if (parent) task.parent = parent;
    const course = text(record.course, 200); if (course) task.course = course;
    if (typeof record.order === 'number' && Number.isFinite(record.order)) task.order = record.order;
    const done = text(record.done, 40); if (done) task.done = done;
    if (record.deleted === true) task.deleted = true;
    return task;
}

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/** Every task kept here, deleted ones included: a later sync needs to know what was deleted. */
export function readTasks(): Task[] {
    const raw = storage()?.getItem(KEY);
    if (!raw) return [];
    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        return list.map(sanitizeTask).filter((task): task is Task => task !== null);
    } catch { return []; }
}
export function writeTasks(change: (tasks: Task[]) => Task[]): Task[] {
    const next = change(readTasks());
    try { storage()?.setItem(KEY, JSON.stringify(next)); } catch { /* Full or blocked storage: the change lasts for this page only. */ }
    window.dispatchEvent(new CustomEvent(EVENT));
    return next;
}
export function subscribeTasks(listener: () => void): () => void {
    const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
    window.addEventListener(EVENT, listener);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', onStorage); };
}
const stamp = () => new Date().toISOString();
export const newTaskId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
/** Adds a task, or changes one: the change is stamped so that the newer side wins a merge. */
export const saveTask = (task: Omit<Task, 'modified'>) => {
    if (task.date && task.start === undefined) throw new Error('执行安排需要开始时间；截止日期请填写在截止时间中。');
    return writeTasks(tasks => [...tasks.filter(item => item.id !== task.id), { ...task, modified: stamp() }]);
};
/** Deleting keeps a mark, and takes its steps with it. */
export const deleteTask = (id: string) => writeTasks(tasks => tasks.map(task => task.id === id || task.parent === id ? { id: task.id, title: task.title, modified: stamp(), deleted: true as const } : task));
export const toggleDone = (task: Task) => saveTask({ ...task, done: task.done ? undefined : stamp() });

/** The tasks that count: not deleted. */
export const liveTasks = (tasks: Task[]) => tasks.filter(task => !task.deleted);

/**
 * Where a task stands for a list: what is overdue, today, tomorrow, the rest of the week, later, or waiting for a
 * day. One done is left out; steps go under their task, not here.
 */
export type TaskGroup = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'someday';
export const TASK_GROUPS: { key: TaskGroup; name: string }[] = [
    { key: 'overdue', name: '待补做' }, { key: 'today', name: '今天' }, { key: 'tomorrow', name: '明天' },
    { key: 'week', name: '未来 7 天' }, { key: 'later', name: '更晚' }, { key: 'someday', name: '还没排日期' },
];
export function taskGroup(task: Task, now: Moment): TaskGroup {
    const at = taskWhen(task);
    if (!at) return 'someday';
    const days = daysBetween(now.date, at.date);
    if (days < 0 || (days === 0 && at.time <= now.min)) return 'overdue';
    return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 7 ? 'week' : 'later';
}
/** The earlier outstanding plan or deadline gives the list its day; both remain visible in the task. */
export function taskWhen(task: Task): { date: string; time: number } | null {
    const times = [task.date ? { date: task.date, time: task.end ?? task.start ?? 1440 } : null,
        task.due ? { date: task.due.date, time: task.due.time ?? 1440 } : null].filter((at): at is { date: string; time: number } => at !== null);
    return times.sort((a, b) => a.date.localeCompare(b.date) || a.time - b.time)[0] ?? null;
}
const orderOf = (left: Task, right: Task) => left.order === undefined ? (right.order === undefined ? 0 : 1) : right.order === undefined ? -1 : left.order - right.order;
/** In a group: where the person put it, if they did; then the earliest first, the most important, the oldest. */
export const taskOrder = (left: Task, right: Task) =>
    orderOf(left, right) || (taskWhen(left)?.date ?? '9999').localeCompare(taskWhen(right)?.date ?? '9999') || (taskWhen(left)?.time ?? 1440) - (taskWhen(right)?.time ?? 1440)
    || (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id);
/** The groups a task can be dragged into, and the day each gives it: none for 还没排日期. */
export const DROP_GROUPS: TaskGroup[] = ['today', 'tomorrow', 'someday'];
/**
 * A task dragged to `index` among the tasks shown in `group` (`shown`, in their order, the dragged one left out):
 * what changes. Into another group it takes that group's day — a plan moves with its time, a deadline keeps its
 * time, one with neither becomes due that day (whichever of plan and deadline comes first is what moves); into 还没排日期 it loses its days. Every task in the group then
 * keeps the place it now has.
 */
export function moveTask(task: Task, group: TaskGroup, index: number, shown: Task[], now: Moment): Omit<Task, 'modified'>[] {
    let moved: Task = task;
    if (group !== taskGroup(task, now)) {
        if (!DROP_GROUPS.includes(group)) return [];
        if (group === 'someday') { const { date, start, end, remind, due, ...rest } = task; moved = rest; }
        else {
            const day = addDays(now.date, group === 'today' ? 0 : 1);
            // What gives it its place in the list moves: its plan, or its deadline when that comes first.
            const planFirst = task.date !== undefined && (!task.due || `${task.date}${String(task.end ?? task.start ?? 1440).padStart(4, '0')}` <= `${task.due.date}${String(task.due.time ?? 1440).padStart(4, '0')}`);
            moved = planFirst ? { ...task, date: day } : { ...task, due: { ...task.due, date: day } };
        }
    }
    const list = shown.filter(item => item.id !== task.id);
    list.splice(Math.max(0, Math.min(index, list.length)), 0, moved);
    return list.flatMap((item, at) => item === moved || item.order !== at ? [{ ...item, order: at }] : []).map(({ modified, ...rest }) => rest);
}
/** Several tasks changed at once, as one write. */
export const saveTasks = (changed: Omit<Task, 'modified'>[]) => {
    const ids = new Set(changed.map(task => task.id));
    return writeTasks(tasks => [...tasks.filter(item => !ids.has(item.id)), ...changed.map(task => ({ ...task, modified: stamp() }))]);
};
/** What reminders a task can have: for one at a time, before it starts; for one due by a day's end, a time that day. */
export const TIMED_REMINDERS = [{ minutes: 0, name: '准时' }, { minutes: 15, name: '提前 15 分钟' }, { minutes: 60, name: '提前 1 小时' }, { minutes: 1440, name: '提前 1 天' }];
export const DAY_REMINDERS = [{ minutes: 8 * 60, name: '当天 8:00' }, { minutes: 12 * 60, name: '当天 12:00' }, { minutes: 20 * 60, name: '当天 20:00' }];
/** When a reminder goes off, as a date and minutes into it. */
export function reminderAt(task: Task, remind: number, anchor: 'plan' | 'due' = 'plan'): { date: string; min: number } | null {
    const day = anchor === 'due' ? task.due?.date : task.date;
    const time = anchor === 'due' ? task.due?.time : task.start;
    if (!day) return null;
    if (time === undefined) return { date: day, min: remind };
    let min = time - remind, date = day;
    while (min < 0) { min += 1440; date = addDays(date, -1); }
    return { date, min };
}

const CN_DIGITS = '零一二三四五六七八九';
/** "3", "十二", "两", "二十五": a number written either way; NaN when it is not one. */
export function chineseNumber(text: string): number {
    if (/^\d+$/.test(text)) return Number(text);
    const value = text.replace(/两/g, '二');
    if (!/^[零一二三四五六七八九十]+$/.test(value)) return NaN;
    const ten = value.indexOf('十');
    if (ten < 0) return value.length === 1 ? CN_DIGITS.indexOf(value) : NaN;
    const tens = ten === 0 ? 1 : CN_DIGITS.indexOf(value.slice(0, ten));
    const ones = ten === value.length - 1 ? 0 : CN_DIGITS.indexOf(value.slice(ten + 1));
    return value.length > 3 || tens < 1 || ones < 0 ? NaN : tens * 10 + ones;
}
const NUM = '(\\d{1,2}|[一二两三四五六七八九十]{1,3})';
const PART = '(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)';
const CLOCK = `(?:(\\d{1,2})[:：](\\d{2})|${NUM}点(?:(半)|(一刻)|(三刻)|(\\d{1,2})分?)?|(\\d{1,2})\\s*(am|pm|AM|PM))`;
/** A clock's minutes into the day, read with the part of the day said before it, or an evening one said before. */
function clockOf(match: string[], at: number, part: string | undefined): number | null {
    let hour: number, min = 0;
    if (match[at] !== undefined) { hour = Number(match[at]); min = Number(match[at + 1]); }
    else if (match[at + 2] !== undefined) {
        // 一点 alone is as often "a little" as one o'clock: it is a time only with a part of the day or minutes.
        if (match[at + 2] === '一' && !part && !match[at + 3] && !match[at + 4] && !match[at + 5] && !match[at + 6]) return null;
        hour = chineseNumber(match[at + 2]!);
        min = match[at + 3] ? 30 : match[at + 4] ? 15 : match[at + 5] ? 45 : match[at + 6] ? Number(match[at + 6]) : 0;
    } else { hour = Number(match[at + 7]); if (/pm/i.test(match[at + 8]!) && hour < 12) hour += 12; if (/am/i.test(match[at + 8]!) && hour === 12) hour = 0; }
    if (Number.isNaN(hour) || hour > 24 || min > 59) return null;
    if (part && /下午|傍晚|晚上/.test(part) && hour < 12) hour += 12;
    else if (part === '中午' && hour < 6) hour += 12;
    else if (!part && match[at + 2] !== undefined && hour >= 1 && hour <= 5) hour += 12;
    return hour === 24 ? null : hour * 60 + min;
}
const weekdayOfDate = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7 + 1;
const validDate = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
};

/** What one line typed for a task was read as. `marks` are the stretches of the line that were read, to show. */
export interface QuickTask { title: string; date?: string; start?: number; end?: number; due?: Task['due']; priority?: Task['priority']; course?: string; marks: [number, number][] }

/**
 * What a task typed in one line says, as a person would say it: a day (今天、明晚、大后天、周三、下周五、周末、
 * 3天后、11月20日、20号、月底), a time or a stretch of it (14:30、下午3点半、3点15、晚上8点到10点、9am), a deadline
 * (截止、之前、ddl, or 前 right after the day), how important (!、!!、!!!) and, after #, one of the person's courses.
 * What is read is taken out of the title. A day and a time plan when to do it; a day alone, or a deadline word, is
 * when it is due.
 */
export function parseQuickTask(input: string, now: Moment, courses: { identity: string; names: string[] }[] = []): QuickTask {
    const line = input.trim();
    const used: [number, number][] = [];
    const free = (from: number, to: number) => used.every(([left, right]) => to <= left || right <= from);
    /** The first match of a pattern on what is not read yet; it is marked read when `read` accepts it. */
    const take = (pattern: RegExp, read: (match: RegExpExecArray) => boolean | void) => {
        const global = new RegExp(pattern.source, 'g' + pattern.flags.replace('g', ''));
        for (let match = global.exec(line); match; match = global.exec(line)) {
            const span: [number, number] = [match.index, match.index + match[0].length];
            // A match on what is read already, or not accepted, may still leave one starting just after it.
            if (!match[0] || !free(...span) || read(match) === false) { global.lastIndex = match.index + 1; continue; }
            used.push(span);
            return span;
        }
        return null;
    };
    let date: string | undefined, start: number | undefined, end: number | undefined, part: string | undefined;
    let deadline = false, priority: Task['priority'], course: string | undefined;
    const days = (count: number) => addDays(now.date, count);
    // The day.
    const daySpan = take(/(大后天|明天早上|明天晚上|后天|明天|今天|今晚|今早|明晚|明早)/, match => {
        const word = match[1]!;
        date = days(word.startsWith('大后') ? 3 : word.startsWith('后') ? 2 : word.startsWith('明') ? 1 : 0);
        if (/晚/.test(word)) part = '晚上'; else if (/早/.test(word)) part = '早上';
    }) ?? take(new RegExp(`${NUM}\\s*(天|周|个星期|星期|个月)(?:后|以后|之后)`), match => {
        const count = chineseNumber(match[1]!);
        if (!(count > 0 && count < 100)) return false;
        if (match[2] === '天') date = days(count);
        else if (match[2] === '个月') { const [year, month, day] = now.date.split('-').map(Number) as [number, number, number]; const total = month - 1 + count, last = new Date(Date.UTC(year + Math.floor(total / 12), total % 12 + 1, 0)).getUTCDate(); date = validDate(year + Math.floor(total / 12), total % 12 + 1, Math.min(day, last)) ?? undefined; }
        else date = days(7 * count);
    }) ?? take(/(下下|下|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天末])/, match => {
        const weekday = match[2] === '末' ? 6 : '一二三四五六日天'.indexOf(match[2]!) % 7 + 1;
        const today = weekdayOfDate(now.date);
        const ahead = match[1] === '下下' ? 14 : match[1] === '下' ? 7 : 0;
        date = ahead ? days(ahead - today + weekday) : days((weekday - today + 7) % 7);
    }) ?? take(/(?<![第\d])(?:(\d{4})\s*[年\-/.])?(\d{1,2})\s*[月\-/.]\s*(\d{1,2})(?![\d节周页章题])(?:\s*[日号])?/, match => {
        const [year, month] = now.date.split('-').map(Number) as [number, number];
        const wanted = Number(match[2]), day = Number(match[3]);
        let found = validDate(match[1] ? Number(match[1]) : year, wanted, day);
        if (found && !match[1] && found < now.date && wanted < month) found = validDate(year + 1, wanted, day);
        if (!found) return false;
        date = found;
    }) ?? take(new RegExp(`${NUM}\\s*[日号]`), match => {
        const day = chineseNumber(match[1]!);
        const [year, month] = now.date.split('-').map(Number) as [number, number];
        let found = validDate(year, month, day);
        if (found && found < now.date) found = month === 12 ? validDate(year + 1, 1, day) : validDate(year, month + 1, day);
        if (!found) return false;
        date = found;
    }) ?? take(/月底/, () => {
        const [year, month] = now.date.split('-').map(Number) as [number, number];
        date = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    });
    // The time, or a stretch of it.
    const timeSpan = take(new RegExp(`${PART}?\\s*${CLOCK}\\s*(?:-|~|–|—|到|至)\\s*${PART}?\\s*${CLOCK}`), match => {
        const from = clockOf(match, 2, match[1] ?? part), to = clockOf(match, 12, match[11] ?? match[1] ?? part);
        if (from === null || to === null) return false;
        start = from; end = to > from ? to : to + 720 > from && to + 720 < 1440 ? to + 720 : undefined;
        if (end === undefined) return false;
    }) ?? take(new RegExp(`${PART}?\\s*${CLOCK}`), match => {
        const at = clockOf(match, 2, match[1] ?? part);
        if (at === null) return false;
        start = at;
    });
    // A deadline: said in words, or 前 right after the day or the time.
    take(/(截止|之前|以前|ddl|DDL)/, () => { deadline = true; });
    const after = Math.max(daySpan?.[1] ?? -1, timeSpan?.[1] ?? -1);
    if (after >= 0 && line[after] === '前' && free(after, after + 1)) { used.push([after, after + 1]); deadline = true; }
    take(/[!！](高|中|低)|[!！]{1,3}/, match => {
        priority = match[1] ? ({ 高: 3, 中: 2, 低: 1 } as const)[match[1] as '高' | '中' | '低'] : match[0].length as 1 | 2 | 3;
    });
    take(/[#＃](\S+)/, match => {
        const word = match[1]!.toLowerCase();
        const found = courses.find(item => item.names.some(name => name.toLowerCase() === word))
            ?? courses.find(item => item.names.some(name => name.toLowerCase().includes(word)));
        if (!found) return false;
        course = found.identity;
    });
    used.sort((left, right) => left[0] - right[0]);
    let title = '', at = 0;
    for (const [from, to] of used) { title += line.slice(at, from) + ' '; at = to; }
    title = (title + line.slice(at)).replace(/\s+/g, ' ').replace(/^[，,、\s]+|[，,、\s]+$/g, '').trim() || line;
    if (start !== undefined && !date) date = now.date;
    const extra = { ...(priority ? { priority } : {}), ...(course ? { course } : {}), marks: used };
    if (date && (start === undefined || deadline)) return { title, due: { date, ...(start !== undefined ? { time: start } : {}) }, ...extra };
    return { title, ...(date ? { date } : {}), ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}), ...extra };
}
