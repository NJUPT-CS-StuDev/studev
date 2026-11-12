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
    if (typeof record.date === 'string' && DATE.test(record.date)) task.date = record.date;
    const start = minute(record.start), end = minute(record.end);
    if (task.date && start !== undefined) { task.start = start; if (end !== undefined && end > start) task.end = end; }
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
        const tasks = list.map(sanitizeTask).filter((task): task is Task => task !== null);
        const migrated = tasks.map(migrateTaskTimes);
        if (tasks.some((task, index) => task !== migrated[index])) { try { storage()?.setItem(KEY, JSON.stringify(migrated)); } catch { /* Readable even when storage cannot be updated. */ } }
        return migrated;
    } catch { return []; }
}
/** Persist the old date-only deadline as a deadline before any current reader uses it. Timed plans stay put. */
export function migrateTaskTimes(task: Task): Task {
    if (!task.date || task.start !== undefined) return task;
    const { date, start, end, remind, ...rest } = task;
    return { ...rest, due: task.due ?? { date, ...(remind?.length ? { remind } : {}) } };
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
/** In a group: the earliest first, then the most important, then the oldest. */
export const taskOrder = (left: Task, right: Task) =>
    (taskWhen(left)?.date ?? '9999').localeCompare(taskWhen(right)?.date ?? '9999') || (taskWhen(left)?.time ?? 1440) - (taskWhen(right)?.time ?? 1440)
    || (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id);
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

const WEEKDAY_WORDS = '一二三四五六日天';
/**
 * What a task typed in one line says of its day and time: 今天、明天、后天, 周三 (the next one, today included),
 * 下周三, and a clock such as 14:30 or 下午3点. The words are taken out of the title; anything else stays in it.
 */
export function parseQuickTask(input: string, now: Moment): { title: string; date?: string; start?: number; due?: Task['due'] } {
    let title = input.trim();
    let date: string | undefined;
    let start: number | undefined;
    const take = (pattern: RegExp, read: (match: RegExpExecArray) => void) => {
        const match = pattern.exec(title);
        if (!match) return;
        read(match);
        title = (title.slice(0, match.index) + title.slice(match.index + match[0].length)).replace(/\s+/g, ' ').trim();
    };
    take(/(今天|明天|后天)/, match => { date = addDays(now.date, ['今天', '明天', '后天'].indexOf(match[1]!)); });
    if (!date) take(/(下)?(?:周|星期|礼拜)([一二三四五六日天])/, match => {
        const weekday = WEEKDAY_WORDS.indexOf(match[2]!) % 7 + 1;
        const today = (new Date(`${now.date}T00:00:00Z`).getUTCDay() + 6) % 7 + 1;
        date = match[1] ? addDays(now.date, 7 - today + weekday) : addDays(now.date, (weekday - today + 7) % 7);
    });
    take(/(\d{1,2})[:：](\d{2})/, match => { const hour = Number(match[1]), min = Number(match[2]); if (hour < 24 && min < 60) start = hour * 60 + min; });
    if (start === undefined) take(/(上午|中午|下午|晚上)?(\d{1,2})点(半)?/, match => {
        let hour = Number(match[2]);
        if ((match[1] === '下午' || match[1] === '晚上') && hour < 12) hour += 12;
        if (match[1] === '中午' && hour < 6) hour += 12;
        if (hour < 24) start = hour * 60 + (match[3] ? 30 : 0);
    });
    if (start !== undefined && !date) date = now.date;
    const deadline = date && (start === undefined || /截止|之前|^前/.test(title));
    if (deadline && date) return { title: title.replace(/截止|之前|^前/, '').trim() || input.trim(), due: { date, ...(start !== undefined ? { time: start } : {}) } };
    return { title: title || input.trim(), ...(date ? { date } : {}), ...(start !== undefined ? { start } : {}) };
}
