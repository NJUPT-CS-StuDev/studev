// What a person's own line suggests they write down: to revise the day before each exam, and to hand in the report a
// week after each lab. Offered in the list until taken or put aside, they are real things to do and, by doing so,
// show what a task can carry (a deadline, a course). Nothing is added without being asked for.
import { courseIdentity, linkedCourse } from '@/timetable/model/courseColors';
import { upcomingExams, type Timeline } from './events';
import { courseShort } from './names';
import type { Task } from './tasks';
import { addDays, type Moment } from './time';

/** 实验二：组网与路由器配置 → 组网与路由器配置实验报告; Cachelab实验(上) → Cachelab实验(上)报告. */
export const reportTitle = (project: string) => { const name = project.replace(/^实验[一二三四五六七八九十\d]+\s*[：:]\s*/, '').trim() || project; return /实验/.test(name) ? `${name}报告` : `${name}实验报告`; };
export interface Suggestion { key: string; task: Omit<Task, 'id' | 'modified'> }
/** How many are offered at once, so that the list is not taken over. */
const OFFERED = 3;

export function suggestTasks(line: Timeline, now: Moment, setAside: readonly string[]): Suggestion[] {
    const titles = new Set(line.tasks.filter(task => !task.deleted).map(task => task.title));
    const exams = upcomingExams(line, addDays(now.date, 1)).map(({ exam }): Suggestion => {
        const course = courseIdentity(linkedCourse(exam, line.meetings));
        return { key: `exam:${exam.id}`, task: { title: `复习${courseShort(exam.course.name)}`, course, due: { date: addDays(exam.date, -1) } } };
    });
    const seen = new Set<string>();
    const labs = line.labs.filter(lab => lab.date >= now.date).sort((left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start))
        .filter(lab => { const course = courseIdentity(linkedCourse(lab, line.meetings)); if (seen.has(course)) return false; seen.add(course); return true; })
        .map((lab): Suggestion => ({ key: `lab:${lab.id}`, task: { title: reportTitle(lab.project), course: courseIdentity(linkedCourse(lab, line.meetings)), due: { date: addDays(lab.date, 7) } } }));
    return [...exams, ...labs].sort((left, right) => (left.task.due!.date < right.task.due!.date ? -1 : left.task.due!.date > right.task.due!.date ? 1 : left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
        .filter(item => !setAside.includes(item.key) && !titles.has(item.task.title)).slice(0, OFFERED);
}

/** What the list has been told to stop offering, kept on this device: suggestions put aside, and the dragging told of. */
export interface TaskHints { setAside: string[]; dragTold?: true }
const HINTS = 'studev_task_hints';
export function readHints(): TaskHints {
    try {
        const raw = JSON.parse(window.localStorage.getItem(HINTS) ?? '{}') as Record<string, unknown>;
        return { setAside: Array.isArray(raw.setAside) ? raw.setAside.filter((key): key is string => typeof key === 'string').slice(-200) : [], ...(raw.dragTold === true ? { dragTold: true as const } : {}) };
    } catch { return { setAside: [] }; }
}
export function writeHints(change: (hints: TaskHints) => TaskHints): TaskHints {
    const next = change(readHints());
    try { window.localStorage.setItem(HINTS, JSON.stringify(next)); } catch { /* Blocked storage: told again next time. */ }
    return next;
}
/** What one can type, offered while the list is empty: tapping one puts it in the box, read back as typed. */
export const TASK_EXAMPLES = ['明天下午3点 交毛概作业 !!', '周五前 交实验报告', '晚上8点到10点 自习', '下周三 答辩 #'];
