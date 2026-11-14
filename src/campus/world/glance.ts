// What a glance outside the app shows: the home-screen widgets on Android and the desktop widgets on Windows read
// the same line through these rules, so both say the same thing at the same moment. Two kinds of glance mirror the
// app's two kinds of view: the calendar (next, day, week, term) and the list (today, everything). The parity golden
// locks the Android and Windows ports to this file.
import { addDays, daysBetween, startOfWeek, weekdayOf, type Moment } from './time';
import { eventsOn, weekShown, type CampusEvent, type Timeline } from './events';
import type { Task } from './tasks';

/** How far ahead a glance looks for the next day that has something, and for what is due. */
export const GLANCE_HORIZON = 30;
export const GLANCE_DUE_DAYS = 7;
export const GLANCE_EXAM_DAYS = 14;

const open = (event: CampusEvent) => event.kind !== 'run' && !event.task?.done;

/** The rest of today, or the next day that has something: the day a glance shows. */
export function glanceDay(line: Timeline, now: Moment): { date: string; events: CampusEvent[] } {
    const left = eventsOn(line, now.date).filter(event => open(event) && event.end > now.min);
    if (left.length) return { date: now.date, events: left };
    for (let offset = 1; offset <= GLANCE_HORIZON; offset++) {
        const date = addDays(now.date, offset);
        const events = eventsOn(line, date).filter(open);
        if (events.length) return { date, events };
    }
    return { date: now.date, events: [] };
}

/** The week a glance shows, Monday to Sunday, the weekend only when something happens on it. */
export function glanceWeek(line: Timeline, now: Moment): { date: string; events: CampusEvent[] }[] {
    const monday = weekShown(line, now);
    return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
        .map(date => ({ date, events: eventsOn(line, date).filter(open) }))
        .filter(day => weekdayOf(day.date) <= 5 || day.events.length > 0);
}

/** The term as weeks of days, each day with how many lessons it has and whether an exam falls on it. */
export function glanceTerm(line: Timeline): { week: number; start: string; days: { date: string; lessons: number; exam: boolean; off: boolean }[] }[] {
    return line.term.weeks.map(week => ({
        week: week.week,
        start: startOfWeek(week.start),
        days: Array.from({ length: 7 }, (_, day) => addDays(startOfWeek(week.start), day)).map(date => {
            const events = eventsOn(line, date);
            return { date, lessons: events.filter(event => event.kind === 'class' || event.kind === 'lab').length, exam: events.some(event => event.kind === 'exam'), off: line.holidays.has(date) };
        }),
    }));
}

/** Open tasks due soon or already late, in the order they are due, the more important first on the same day. */
export function glanceDue(line: Timeline, now: Moment): Task[] {
    const last = addDays(now.date, GLANCE_DUE_DAYS);
    return line.tasks.filter(task => !task.parent && !task.done && task.due && task.due.date <= last)
        .sort((left, right) => left.due!.date.localeCompare(right.due!.date) || (left.due!.time ?? 1440) - (right.due!.time ?? 1440) || (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id));
}

/** Exams in the next two weeks, after today, with how many days away. */
export function glanceExams(line: Timeline, now: Moment): { date: string; days: number; events: CampusEvent[] }[] {
    const days: { date: string; days: number; events: CampusEvent[] }[] = [];
    for (const date of [...new Set(line.exams.map(exam => exam.date))].sort()) {
        const away = daysBetween(now.date, date);
        if (away < 1 || away > GLANCE_EXAM_DAYS) continue;
        days.push({ date, days: away, events: eventsOn(line, date).filter(event => event.kind === 'exam') });
    }
    return days;
}

/** The next moment a glance reads differently: something starting or ending today, else the next midnight. */
export function glanceNextChange(line: Timeline, now: Moment): Moment {
    const minutes = eventsOn(line, now.date).flatMap(event => [event.start, event.end]).filter(minute => minute > now.min);
    return minutes.length ? { date: now.date, min: Math.min(...minutes) } : { date: addDays(now.date, 1), min: 0 };
}
