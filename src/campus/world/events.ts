// A person or room unfolded along time: lessons, exams, the school calendar and 早锻炼 on one line.
import type { Exam, TeachingMeeting, TeachingPeriod, TeachingTerm } from '@/academics/facts';
import { courseName, courseShort } from './names';
import type { CalendarTerm, MorningRun } from './data';
import { addDays, daysBetween, minutesOf, weekdayOf, type Moment } from './time';

export interface CampusEvent {
    kind: 'class' | 'exam' | 'run';
    id: string; date: string; name: string; short: string; start: number; end: number;
    room: string | null; teachers: string[];
    meeting?: TeachingMeeting; exam?: Exam;
}
export interface RunPlan { rule: MorningRun; done: number }
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
const isRunDay = (rule: MorningRun, holidays: Map<string, string>, date: string) =>
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
    if (line.run && isRunDay(line.run.rule, line.holidays, date)) {
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

const EARLY_WEEKS = 3;
export function runProgress(plan: RunPlan, holidays: Map<string, string>, now: Moment) {
    const { rule, done } = plan;
    let left = 0;
    let date = now.min > minutesOf(rule.time[1]) ? addDays(now.date, 1) : now.date;
    for (; date <= rule.end; date = addDays(date, 1)) if (isRunDay(rule, holidays, date)) left++;
    const need = Math.max(0, rule.required - done);
    const weeks = Math.max(1, Math.ceil(left / 5) - EARLY_WEEKS);
    return { left, need, perWeek: Math.ceil(need / weeks), earlyWeeks: EARLY_WEEKS, nextBonus: rule.bonus.find(([count]) => count > done) ?? null, reachable: need <= left };
}

/** The grade a class is in during the given academic year's term: 1 for 大一. */
export const gradeOf = (classGrade: string | null | undefined, term: TeachingTerm) => classGrade ? term.year - Number(classGrade) + 1 : null;
