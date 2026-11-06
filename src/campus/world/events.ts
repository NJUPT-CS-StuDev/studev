// A person or room unfolded along time: lessons, exams, the school calendar and 早锻炼 on one line.
import type { Exam, TeachingMeeting, TeachingPeriod, TeachingTerm } from '@/academics/facts';
import { courseName, courseShort } from './names';
import type { CalendarTerm, MorningRun } from './data';
import { addDays, daysBetween, minutesOf, weekdayOf, type Moment } from './time';

export interface CampusEvent {
    kind: 'class' | 'exam' | 'run';
    runMark?: RunMark;
    id: string; date: string; name: string; short: string; start: number; end: number;
    room: string | null; teachers: string[];
    meeting?: TeachingMeeting; exam?: Exam;
}
export type RunMark = 'done' | 'plan';
/** Which mornings are run or planned, and the bonus or penalty the sports office recorded. */
export interface RunPlan { rule: MorningRun; days: Record<string, RunMark>; adjust: number }
export interface Timeline {
    term: TeachingTerm; periods: TeachingPeriod[]; meetings: TeachingMeeting[]; exams: Exam[];
    holidays: Map<string, string>; run: RunPlan | null;
}

export const weekOfDate = (term: TeachingTerm, date: string) => term.weeks.find(week => week.start <= date && date <= week.end)?.week ?? null;
export function holidayMap(terms: CalendarTerm[]) {
    const days = new Map<string, string>();
    for (const term of terms) {
        for (const item of term.holidays) {
            for (let date = item.start; date <= item.end; date = addDays(date, 1)) days.set(date, days.has(date) ? `${days.get(date)}、${item.name}` : item.name);
        }
    }
    return days;
}
export const isRunDay = (rule: MorningRun, holidays: Map<string, string>, date: string) =>
    date >= rule.start && date <= rule.end && weekdayOf(date) <= 5 && !holidays.has(date);

const lessonEvent = (meeting: TeachingMeeting, date: string, periods: TeachingPeriod[]): CampusEvent | null => {
    const first = periods.find(period => period.period === meeting.periods[0]);
    const last = periods.find(period => period.period === meeting.periods[1]);
    if (!first || !last) return null;
    return {
        kind: 'class', id: `${meeting.id}@${date}`, date, name: courseName(meeting.course.name), short: courseShort(meeting.course.name),
        start: minutesOf(first.start), end: minutesOf(last.end), room: meeting.room, teachers: meeting.teachers.map(teacher => teacher.name), meeting,
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
    if (line.run?.days[date]) {
        out.push({ kind: 'run', id: `run@${date}`, date, name: '早锻炼', short: '早锻炼', start: minutesOf(line.run.rule.time[0]), end: minutesOf(line.run.rule.time[1]), room: null, teachers: [], runMark: line.run.days[date] });
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

export function runTally({ rule, days, adjust }: RunPlan) {
    const marks = Object.values(days);
    const done = marks.filter(mark => mark === 'done').length;
    const planned = marks.length - done;
    const count = done + adjust;
    return { done, planned, count, need: Math.max(0, rule.required - count - planned), nextBonus: rule.bonus.find(([at]) => at > count + planned) ?? null };
}

/** Every morning in the term one can run, in order. */
export function runDates(rule: MorningRun, holidays: Map<string, string>) {
    const dates: string[] = [];
    for (let date = rule.start; date <= rule.end; date = addDays(date, 1)) if (isRunDay(rule, holidays, date)) dates.push(date);
    return dates;
}

/**
 * Lays out what is still needed: evenly over the mornings left, so rain costs little, and within
 * each stretch on a day with an early class, when one is up anyway. Done mornings stay; earlier plans
 * for mornings still ahead are replaced.
 */
export function planRuns(plan: RunPlan, line: Timeline, now: Moment): Record<string, RunMark> {
    const from = now.min < minutesOf(plan.rule.time[0]) ? now.date : addDays(now.date, 1);
    const days = Object.fromEntries(Object.entries(plan.days).filter(([date, mark]) => mark === 'done' || date < from)) as Record<string, RunMark>;
    const open = runDates(plan.rule, line.holidays).filter(date => date >= from && !days[date]);
    const need = Math.min(open.length, Math.max(0, runTally({ ...plan, days }).need));
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
        days[last] = 'plan';
    }
    return days;
}

/** The grade a class is in during the given academic year's term: 1 for 大一. */
export const gradeOf = (classGrade: string | null | undefined, term: TeachingTerm) => classGrade ? term.year - Number(classGrade) + 1 : null;
