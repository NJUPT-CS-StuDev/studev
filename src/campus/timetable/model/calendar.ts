// The timeline written as iCalendar, once, from the person's own timetable: what they see is what
// their calendar gets. Keeping a calendar up to date is the Android app's job.
import type { Exam, Lab, TeachingMeeting } from '@/world/facts';
import type { CalendarTerm } from '@/world/data';
import { eventsOn, weekOfDate, type RunPlan, type Timeline } from '@/world/events';
import { courseName, roomLabel } from '@/world/names';
import { addDays, minutesOf } from '@/world/time';

/** What can go into the file; the Android app writes each as its own calendar on the phone. */
export const CALENDARS = [
    { kind: 'lessons', name: '课程' },
    { kind: 'exams', name: '考试' },
    { kind: 'run', name: '早锻炼' },
] as const;
export type CalendarKind = typeof CALENDARS[number]['kind'];

/** When an exam reminds: a few days to prepare, the evening before to check, an hour or two to leave. */
export const EXAM_REMINDERS = [
    { key: 'week', name: '一周前' },
    { key: 'days', name: '三天前' },
    { key: 'eve', name: '前一天 20:00' },
    { key: 'early', name: '两小时前' },
    { key: 'hour', name: '一小时前' },
] as const;
export type ExamReminder = typeof EXAM_REMINDERS[number]['key'];
export const DEFAULT_EXAM_REMINDERS: ExamReminder[] = ['eve', 'hour'];
/** Minutes before an exam starting at `start` (minutes into its day). */
export const examReminderMinutes = (key: ExamReminder, start: number): number =>
    key === 'week' ? 7 * 1440 : key === 'days' ? 3 * 1440 : key === 'eve' ? start + 240 : key === 'early' ? 120 : 60;
export const LESSON_REMINDER = 15;
export const RUN_REMINDER = 30;

interface Entry {
    uid: string; summary: string; location: string; description: string; date: string;
    /** Minutes into the day; absent for a whole-day entry, which then runs to `last`. */
    start?: number; end?: number; last?: string;
    /** A weekly series: its final date, and the weeks it skips. */
    until?: string; skip?: string[];
    reminders: number[];
}

const pad = (value: number) => String(value).padStart(2, '0');
const day = (date: string) => date.replaceAll('-', '');
const local = (date: string, minutes: number) => `${day(date)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
/** Campus time is UTC+8 all year. */
const utc = (date: string, minutes: number) => minutes >= 480 ? `${local(date, minutes - 480)}Z` : `${local(addDays(date, -1), minutes + 960)}Z`;
const text = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
/** Lines longer than 75 octets continue on the next line after a space. */
const fold = (line: string) => {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const parts: string[] = [];
    let current = '';
    let size = 0;
    for (const char of line) {
        const width = new TextEncoder().encode(char).length;
        if (size + width > (parts.length ? 74 : 75)) { parts.push(current); current = ''; size = 0; }
        current += char;
        size += width;
    }
    return [...parts, current].join('\r\n ');
};
const ZONE = ['BEGIN:VTIMEZONE', 'TZID:Asia/Shanghai', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800', 'TZNAME:CST', 'END:STANDARD', 'END:VTIMEZONE'];

/** One calendar file; `stamp` is when it was written. */
export function calendarFile(name: string, entries: Entry[], stamp: Date): string {
    const now = stamp.toISOString().replace(/[-:]|\.\d+/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//studev//ZH-CN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${text(name)}`, 'X-WR-TIMEZONE:Asia/Shanghai', ...ZONE];
    for (const entry of entries) {
        lines.push('BEGIN:VEVENT', `UID:${entry.uid}@studev`, `DTSTAMP:${now}`);
        if (entry.start === undefined) lines.push(`DTSTART;VALUE=DATE:${day(entry.date)}`, `DTEND;VALUE=DATE:${day(addDays(entry.last ?? entry.date, 1))}`);
        else lines.push(`DTSTART;TZID=Asia/Shanghai:${local(entry.date, entry.start)}`, `DTEND;TZID=Asia/Shanghai:${local(entry.date, entry.end!)}`);
        if (entry.until) lines.push(`RRULE:FREQ=WEEKLY;UNTIL=${utc(entry.until, entry.end!)}`);
        if (entry.skip?.length) lines.push(`EXDATE;TZID=Asia/Shanghai:${entry.skip.map(date => local(date, entry.start!)).join(',')}`);
        lines.push(`SUMMARY:${text(entry.summary)}`);
        if (entry.location) lines.push(`LOCATION:${text(entry.location)}`);
        if (entry.description) lines.push(`DESCRIPTION:${text(entry.description)}`);
        for (const minutes of entry.reminders) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(entry.summary)}`, `TRIGGER:-PT${minutes}M`, 'END:VALARM');
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Each lesson is one weekly series over the dates the timeline holds it: its weeks, minus holidays and the times a lab or an exam takes its place. */
export function lessonEntries(line: Timeline): Entry[] {
    return line.meetings.flatMap((meeting: TeachingMeeting) => {
        const first = line.periods.find(period => period.period === meeting.periods[0]);
        const last = line.periods.find(period => period.period === meeting.periods[1]);
        const dates = line.term.weeks.filter(week => meeting.weeks.includes(week.week)).map(week => addDays(week.start, meeting.weekday - 1))
            .filter(date => !line.holidays.has(date) && !eventsOn(line, date).find(event => event.meeting?.id === meeting.id)?.covered);
        if (!first || !last || !dates.length) return [];
        const skip: string[] = [];
        for (let date = dates[0]!; date < dates.at(-1)!; date = addDays(date, 7)) if (!dates.includes(date)) skip.push(date);
        const weeks = dates.map(date => weekOfDate(line.term, date));
        return [{
            uid: `${meeting.id}`, summary: courseName(meeting.course.name), location: roomLabel(meeting.room ?? meeting.location),
            description: [`第 ${weeks[0]}–${weeks.at(-1)} 周`, meeting.teachers.map(teacher => teacher.name).join('、')].filter(Boolean).join(' · '),
            date: dates[0]!, start: minutesOf(first.start), end: minutesOf(last.end), until: dates.at(-1)!, skip, reminders: [LESSON_REMINDER],
        }];
    });
}

/** Each lab sitting the timeline holds, on its own date; one an exam covers is left out. */
export const labEntries = (line: Timeline): Entry[] => line.labs.filter(lab => eventsOn(line, lab.date).some(event => event.lab?.id === lab.id && !event.covered)).map((lab: Lab) => ({
    uid: lab.id, summary: `实验 · ${courseName(lab.course.name)}`, location: roomLabel(lab.room ?? lab.place),
    description: [lab.project, lab.teachers.join('、')].filter(Boolean).join(' · '),
    date: lab.date, start: minutesOf(lab.start), end: minutesOf(lab.end), reminders: [LESSON_REMINDER],
}));

export const examEntries = (exams: Exam[], reminders: ExamReminder[]): Entry[] => exams.map(exam => ({
    uid: exam.id, summary: `考试 · ${courseName(exam.course.name)}`, location: roomLabel(exam.room ?? exam.location),
    description: [exam.teacher ? `任课老师 ${exam.teacher}` : '', exam.students ? `本考场 ${exam.students} 人` : ''].filter(Boolean).join(' · '),
    date: exam.date, start: minutesOf(exam.start), end: minutesOf(exam.end),
    reminders: reminders.map(key => examReminderMinutes(key, minutesOf(exam.start))),
}));

export const runEntries = ({ rule, days }: RunPlan): Entry[] => days.map(date => ({
    uid: `run-${date}`, summary: '早锻炼', location: rule.xianlin?.route.join(' ↔ ') ?? '', description: '',
    date, start: minutesOf(rule.time[0]), end: minutesOf(rule.time[1]), reminders: [RUN_REMINDER],
}));

/**
 * The days in a term without lessons, whole-day, so a gap among the lessons says why it is there.
 * The break and holidays outside the term are left out: nobody follows lessons through them.
 */
export const daysOffEntries = (terms: CalendarTerm[]): Entry[] => terms.flatMap(term => [...term.holidays, ...term.events]
    .filter(item => item.start >= term.start && item.start <= term.end)
    .map(item => ({ uid: `off-${item.start}-${item.name}`, summary: `${item.name} · 不上课`, location: '', description: '', date: item.start, last: item.end, reminders: [] })))

export function downloadCalendar(filename: string, content: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
