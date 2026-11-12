// A person or room unfolded along time: lessons, labs, exams, the school calendar, 早锻炼 and one's own tasks on one line.
import type { Exam, Lab, TeachingMeeting, TeachingPeriod, TeachingTerm } from '@/world/facts';
import { courseName, courseShort } from './names';
import type { CalendarTerm, MorningRun } from './data';
import type { Task } from './tasks';
import { addDays, daysBetween, minutesOf, startOfWeek, weekdayOf, type Moment } from './time';

export interface CampusEvent {
    kind: 'class' | 'lab' | 'exam' | 'run' | 'task';
    id: string; date: string; name: string; short: string; start: number; end: number;
    room: string | null; teachers: string[];
    meeting?: TeachingMeeting; lab?: Lab; exam?: Exam; task?: Task;
}
export type EventKind = CampusEvent['kind'];

/**
 * Things on the line may share a time: a lab during a lecture, two labs at once, later one's own task during a
 * lesson. Sharing a time says only that they clash; neither is called off. Which one shows in front is a choice
 * of the person looking, front first. By default an exam; then one's own task, a plan made for that time; then a
 * lab, a lesson, 早锻炼.
 */
export const LAYER_ORDER: readonly EventKind[] = ['exam', 'task', 'lab', 'class', 'run'];
/** A task given a time but no end takes this long on the line. */
export const TASK_MINUTES = 30;
const clash = (left: CampusEvent, right: CampusEvent) => left !== right && left.date === right.date && left.start < right.end && right.start < left.end;
const frontFirst = (order: readonly EventKind[]) => (left: CampusEvent, right: CampusEvent) =>
    order.indexOf(left.kind) - order.indexOf(right.kind) || left.start - right.start || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
/**
 * A day's events as layers, back to front, the order they are drawn in. `under` is how many it overlaps lie
 * behind it, `over` how many in front: one in front shows the count of those behind; those behind show their
 * edges beside it and whatever part of them it does not reach.
 */
export function layers(events: CampusEvent[], order: readonly EventKind[] = LAYER_ORDER) {
    const front = [...events].sort(frontFirst(order));
    return front.map((event, rank) => ({
        event,
        over: front.slice(0, rank).filter(other => clash(other, event)).length,
        under: front.slice(rank + 1).filter(other => clash(other, event)).length,
    })).reverse();
}
/**
 * Where there is no room to stack them, a day's events in runs that overlap one another: each run is one tile
 * from its first start to its last end, named by the one in front.
 */
export function clusters(events: CampusEvent[], order: readonly EventKind[] = LAYER_ORDER) {
    const runs: CampusEvent[][] = [];
    for (const event of [...events].sort((left, right) => left.start - right.start || left.end - right.end)) {
        const last = runs.at(-1);
        if (last && event.start < Math.max(...last.map(item => item.end))) last.push(event);
        else runs.push([event]);
    }
    return runs.map(run => ({ front: [...run].sort(frontFirst(order))[0]!, events: run, start: run[0]!.start, end: Math.max(...run.map(item => item.end)) }));
}
/**
 * The mornings someone put down for 早锻炼, and the bonus or penalty the sports office recorded.
 * A morning put down and gone by counts as run: people mostly go, so only a missed one is touched
 * (taken off). There is nothing to mark after the fact.
 */
export interface RunPlan { rule: MorningRun; days: string[]; adjust: number }
export interface Timeline {
    term: TeachingTerm; periods: TeachingPeriod[]; meetings: TeachingMeeting[]; labs: Lab[]; exams: Exam[];
    holidays: Map<string, string>; run: RunPlan | null;
    /** One's own tasks, steps included; only someone's own line has any. */
    tasks: Task[];
}

export const weekOfDate = (term: TeachingTerm, date: string) => term.weeks.find(week => week.start <= date && date <= week.end)?.week ?? null;
/**
 * The days without lessons, by name. The school calendar writes public holidays and a few school
 * events (运动会, 校庆日); it does not say the events stop lessons, but they do, all day, by custom.
 * The calendar data keeps only such events in `events`, so every one of them is a day off here.
 */
export function holidayMap(terms: CalendarTerm[]) {
    const days = new Map<string, string>();
    for (const term of terms) {
        for (const item of [...term.holidays, ...term.events]) {
            for (let date = item.start; date <= item.end; date = addDays(date, 1)) days.set(date, days.has(date) ? `${days.get(date)}、${item.name}` : item.name);
        }
    }
    return days;
}
const isRunDay = (rule: MorningRun, holidays: Map<string, string>, date: string) =>
    date >= rule.start && date <= rule.end && weekdayOf(date) <= 5 && !holidays.has(date);

const lessonEvent = (meeting: TeachingMeeting, date: string, periods: TeachingPeriod[]): CampusEvent | null => {
    const first = periods.find(period => period.period === meeting.periods[0]);
    const last = periods.find(period => period.period === meeting.periods[1]);
    if (!first || !last) return null;
    return {
        kind: 'class', id: `${meeting.id}@${date}`, date, name: courseName(meeting.course.name), short: courseShort(meeting.course.name),
        start: minutesOf(first.start), end: minutesOf(last.end), room: meeting.room ?? meeting.location, teachers: meeting.teachers.map(teacher => teacher.name), meeting,
    };
};

export function eventsOn(line: Timeline, date: string): CampusEvent[] {
    const week = weekOfDate(line.term, date);
    const weekday = weekdayOf(date);
    const out: CampusEvent[] = [];
    // The school calendar decides: nobody has lessons on a public holiday.
    if (week && !line.holidays.has(date)) {
        for (const meeting of line.meetings) {
            if (meeting.weekday !== weekday || !meeting.weeks.includes(week)) continue;
            const event = lessonEvent(meeting, date, line.periods);
            if (event) out.push(event);
        }
    }
    // A lab is set for its date, so it stands even on a day the school calendar stops lessons: the sheet does not
    // say it moved, and the day's name shows beside it for the person to judge.
    for (const lab of line.labs) {
        if (lab.date !== date) continue;
        out.push({
            kind: 'lab', id: lab.id, date, name: courseName(lab.course.name), short: courseShort(lab.course.name),
            start: minutesOf(lab.start), end: minutesOf(lab.end), room: lab.room ?? lab.place, teachers: lab.teachers, lab,
        });
    }
    for (const exam of line.exams) {
        if (exam.date !== date) continue;
        out.push({
            kind: 'exam', id: exam.id, date, name: courseName(exam.course.name), short: courseShort(exam.course.name),
            start: minutesOf(exam.start), end: minutesOf(exam.end), room: exam.room ?? exam.location, teachers: exam.teacher ? [exam.teacher] : [], exam,
        });
    }
    // A task with a time stands at it; its steps go with it, not on the line.
    for (const task of line.tasks) {
        if (task.parent || task.date !== date || task.start === undefined) continue;
        out.push({ kind: 'task', id: task.id, date, name: task.title, short: task.title, start: task.start, end: task.end ?? Math.min(1440, task.start + TASK_MINUTES), room: null, teachers: [], task });
    }
    if (line.run?.days.includes(date)) {
        out.push({ kind: 'run', id: `run@${date}`, date, name: '早锻炼', short: '早锻炼', start: minutesOf(line.run.rule.time[0]), end: minutesOf(line.run.rule.time[1]), room: null, teachers: [] });
    }
    return out.sort((left, right) => left.start - right.start || frontFirst(LAYER_ORDER)(left, right));
}

/** The tasks due by the end of a day, with no time of their own. */
export const dueOn = (line: Timeline, date: string) => line.tasks.filter(task => !task.parent && task.date === date && task.start === undefined);

/** What else is on at the same time as an event. */
export const overlapping = (line: Timeline, event: CampusEvent) => eventsOn(line, event.date).filter(other => other.id !== event.id && clash(other, event));

/** Other lessons at this lesson's weekday and periods that do not meet this week: the week view shows one block per slot, these are hidden behind it. */
export function sharingSlot(line: Timeline, event: CampusEvent): TeachingMeeting[] {
    const own = event.meeting;
    const week = weekOfDate(line.term, event.date);
    if (!own || week === null) return [];
    return line.meetings.filter(other => other.id !== own.id && other.weekday === own.weekday && !other.weeks.includes(week)
        && other.periods[0] <= own.periods[1] && own.periods[0] <= other.periods[1] && week >= Math.min(...other.weeks) && week <= Math.max(...other.weeks));
}

/** A lesson where it next meets from a date on, or else where it last met: what a lesson off that week opens. */
export function meetingAround(line: Timeline, meetingId: string, from: string): CampusEvent | null {
    const find = (date: string) => eventsOn(line, date).find(event => event.meeting?.id === meetingId) ?? null;
    for (let date = from; date <= line.term.weeks.at(-1)!.end; date = addDays(date, 1)) { const found = find(date); if (found) return found; }
    for (let date = addDays(from, -1); date >= line.term.weeks[0]!.start; date = addDays(date, -1)) { const found = find(date); if (found) return found; }
    return null;
}

/** The next lesson, lab or exam: not 早锻炼, optional on any given morning, nor one's own task. Of two starting together, the one in front. */
export function nextEvent(line: Timeline, now: Moment, horizon = 40): CampusEvent | null {
    for (let offset = 0; offset < horizon; offset++) {
        const date = addDays(now.date, offset);
        for (const event of eventsOn(line, date)) if (event.kind !== 'run' && event.kind !== 'task' && (offset > 0 || event.end > now.min)) return event;
    }
    return null;
}

export function upcomingExams(line: Timeline, today: string) {
    return line.exams.filter(exam => exam.date >= today).sort((left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start))
        .map(exam => ({ exam, days: daysBetween(today, exam.date) }));
}

/** A morning put down counts as run once its time is over. */
export const runGone = (rule: MorningRun, date: string, now: Moment) => date < now.date || (date === now.date && now.min >= minutesOf(rule.time[1]));

export function runTally({ rule, days, adjust }: RunPlan, now: Moment) {
    const done = days.filter(date => runGone(rule, date, now)).length;
    const planned = days.length - done;
    const count = done + adjust;
    return { done, planned, count, need: Math.max(0, rule.required - count - planned), nextBonus: rule.bonus.find(([at]) => at > count + planned) ?? null };
}

/** One tap puts a morning down or takes it off, past or ahead. */
export const toggleRun = (days: string[], date: string): string[] =>
    days.includes(date) ? days.filter(day => day !== date) : [...days, date].sort();

/** Every morning in the term one can run, in order. */
export function runDates(rule: MorningRun, holidays: Map<string, string>) {
    const dates: string[] = [];
    for (let date = rule.start; date <= rule.end; date = addDays(date, 1)) if (isRunDay(rule, holidays, date)) dates.push(date);
    return dates;
}

/**
 * Lays out what is still needed: evenly over the mornings left, so rain costs little, and within
 * each stretch on a day with an early class, when one is up anyway. Mornings already begun stay;
 * earlier plans for mornings still ahead are replaced.
 */
export function planRuns(plan: RunPlan, line: Timeline, now: Moment): string[] {
    const from = now.min < minutesOf(plan.rule.time[0]) ? now.date : addDays(now.date, 1);
    const days = plan.days.filter(date => date < from);
    const open = runDates(plan.rule, line.holidays).filter(date => date >= from);
    const need = Math.min(open.length, Math.max(0, runTally({ ...plan, days }, now).need));
    let last = '';
    for (let part = 0; part < need; part++) {
        const start = Math.floor(part * open.length / need);
        const stretch = open.slice(start, Math.floor((part + 1) * open.length / need));
        const middle = (stretch.length - 1) / 2;
        const score = (date: string, position: number) =>
            (eventsOn(line, date).some(event => (event.kind === 'class' || event.kind === 'lab') && event.start <= 8 * 60) ? 4 : 0)
            + (last && daysBetween(last, date) < 2 ? -3 : 0) - Math.abs(position - middle) / Math.max(1, stretch.length);
        let best = 0;
        stretch.forEach((date, position) => { if (score(date, position) > score(stretch[best]!, best)) best = position; });
        last = stretch[best]!;
        days.push(last);
    }
    return days.sort();
}

/** The grade a class is in during the given academic year's term: 1 for 大一. */
export const gradeOf = (classGrade: string | null | undefined, term: TeachingTerm) => classGrade ? term.year - Number(classGrade) + 1 : null;

/**
 * The week a "now" view shows: this one while something in it is still ahead, otherwise the week of
 * the next thing. On a Sunday evening that is next week. Same rule as the day: what is left, or the
 * next day that has something.
 */
export function weekShown(line: Timeline, now: Moment): string {
    const next = nextEvent(line, now, 60);
    return startOfWeek(next ? next.date : now.date);
}

/** The last day with a lesson or a lab on this line: where the term's teaching ends. */
export function lastLesson(line: Timeline): string | null {
    const first = line.term.weeks[0]?.start;
    for (let date = line.term.weeks.at(-1)?.end; first && date && date >= first; date = addDays(date, -1)) {
        if (eventsOn(line, date).some(event => event.kind === 'class' || event.kind === 'lab')) return date;
    }
    return null;
}

/** Exams still ahead, one entry per day, in order: people prepare by the day, not by the paper. */
export function examDays(line: Timeline, today: string) {
    const days = new Map<string, Exam[]>();
    for (const { exam } of upcomingExams(line, today)) days.set(exam.date, [...(days.get(exam.date) ?? []), exam]);
    return [...days].map(([date, exams]) => ({ date, days: daysBetween(today, date), exams }));
}
