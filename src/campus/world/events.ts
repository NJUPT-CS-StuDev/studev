// A person or room unfolded along time: lessons, exams, the school calendar and 早锻炼 on one line.
import type { Exam, TeachingMeeting, TeachingPeriod, TeachingTerm } from '@/world/facts';
import { courseName, courseShort } from './names';
import type { CalendarTerm, MorningRun } from './data';
import { addDays, daysBetween, minutesOf, startOfWeek, weekdayOf, type Moment } from './time';

export interface CampusEvent {
    kind: 'class' | 'exam' | 'run';
    id: string; date: string; name: string; short: string; start: number; end: number;
    room: string | null; teachers: string[];
    meeting?: TeachingMeeting; exam?: Exam;
}
/**
 * The mornings someone put down for 早锻炼, and the bonus or penalty the sports office recorded.
 * A morning put down and gone by counts as run: people mostly go, so only a missed one is touched
 * (taken off). There is nothing to mark after the fact.
 */
export interface RunPlan { rule: MorningRun; days: string[]; adjust: number }
export interface Timeline {
    term: TeachingTerm; periods: TeachingPeriod[]; meetings: TeachingMeeting[]; exams: Exam[];
    holidays: Map<string, string>; run: RunPlan | null;
}

export const weekOfDate = (term: TeachingTerm, date: string) => term.weeks.find(week => week.start <= date && date <= week.end)?.week ?? null;
/**
 * The days without lessons, by name. The school calendar writes public holidays and a few school
 * events (运动会, 校庆日); it does not say the events stop lessons, but they do, all day, by custom.
 * njupt-data keeps only such events in `events`, so every one of them is a day off here.
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
    for (const exam of line.exams) {
        if (exam.date !== date) continue;
        out.push({
            kind: 'exam', id: exam.id, date, name: courseName(exam.course.name), short: courseShort(exam.course.name),
            start: minutesOf(exam.start), end: minutesOf(exam.end), room: exam.room ?? exam.location, teachers: exam.teacher ? [exam.teacher] : [], exam,
        });
    }
    if (line.run?.days.includes(date)) {
        out.push({ kind: 'run', id: `run@${date}`, date, name: '早锻炼', short: '早锻炼', start: minutesOf(line.run.rule.time[0]), end: minutesOf(line.run.rule.time[1]), room: null, teachers: [] });
    }
    return out.sort((left, right) => left.start - right.start);
}

/** What comes next, not counting 早锻炼: it is optional on any given morning. */
export function nextEvent(line: Timeline, now: Moment, horizon = 40): CampusEvent | null {
    for (let offset = 0; offset < horizon; offset++) {
        const date = addDays(now.date, offset);
        for (const event of eventsOn(line, date)) if (event.kind !== 'run' && (offset > 0 || event.end > now.min)) return event;
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
            (eventsOn(line, date).some(event => event.kind === 'class' && event.start <= 8 * 60) ? 4 : 0)
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

/** The last day with a lesson on this line: where the term's teaching ends. */
export function lastLesson(line: Timeline): string | null {
    const first = line.term.weeks[0]?.start;
    for (let date = line.term.weeks.at(-1)?.end; first && date && date >= first; date = addDays(date, -1)) {
        if (eventsOn(line, date).some(event => event.kind === 'class')) return date;
    }
    return null;
}

/** Exams still ahead, one entry per day, in order: people prepare by the day, not by the paper. */
export function examDays(line: Timeline, today: string) {
    const days = new Map<string, Exam[]>();
    for (const { exam } of upcomingExams(line, today)) days.set(exam.date, [...(days.get(exam.date) ?? []), exam]);
    return [...days].map(([date, exams]) => ({ date, days: daysBetween(today, date), exams }));
}
