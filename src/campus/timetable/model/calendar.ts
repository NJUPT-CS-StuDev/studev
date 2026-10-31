import { PRODUCT_CONFIG } from '@/app/config/product';
import type { TeachingMeeting, TeachingPeriod, TeachingWeek } from '@/academics/timetable';

const escape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
const compact = (value: string): string => value.replace(/[-:]/g, '');

export const todayInShanghai = (): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: PRODUCT_CONFIG.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
};

export const weekdayInShanghai = (): number => {
    const weekday = new Date(`${todayInShanghai()}T00:00:00Z`).getUTCDay();
    return weekday === 0 ? 7 : weekday;
};

export const meetingDate = (week: TeachingWeek, weekday: number): string => {
    const date = new Date(`${week.start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + weekday - 1);
    return date.toISOString().slice(0, 10);
};

export const buildClassCalendar = (
    className: string,
    meetings: TeachingMeeting[],
    weeks: TeachingWeek[],
    periods: TeachingPeriod[],
): string => {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//studev//Teaching Schedule//ZH-CN', 'CALSCALE:GREGORIAN'];
    for (const meeting of meetings) {
        const startPeriod = periods.find(item => item.period === meeting.periods[0]);
        const endPeriod = periods.find(item => item.period === meeting.periods[1]);
        if (!startPeriod || !endPeriod) continue;
        for (const weekNumber of meeting.weeks) {
            const week = weeks.find(item => item.week === weekNumber);
            if (!week) continue;
            const date = meetingDate(week, meeting.weekday);
            const uid = `${meeting.id}-${weekNumber}@${new URL(PRODUCT_CONFIG.ORIGIN).hostname}`;
            lines.push(
                'BEGIN:VEVENT',
                `UID:${uid}`,
                `DTSTAMP:${compact(new Date().toISOString().slice(0, 19))}Z`,
                `DTSTART;TZID=${PRODUCT_CONFIG.TIME_ZONE}:${compact(date)}T${compact(startPeriod.start)}00`,
                `DTEND;TZID=${PRODUCT_CONFIG.TIME_ZONE}:${compact(date)}T${compact(endPeriod.end)}00`,
                `SUMMARY:${escape(meeting.course.name)}`,
                `LOCATION:${escape(meeting.location ?? '')}`,
                `DESCRIPTION:${escape([className, meeting.teachers.map(t => t.name).join(',')].filter(Boolean).join(' · '))}`,
                'END:VEVENT',
            );
        }
    }
    lines.push('END:VCALENDAR');
    return `${lines.join('\r\n')}\r\n`;
};

export const downloadCalendar = (filename: string, content: string): void => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
