import type { TeachingMeeting } from '@/academics/timetable';

export const alternatingWeekLabel = (meeting: TeachingMeeting): '单周' | '双周' | null => {
    if (meeting.weeks.length < 2) return null;
    const first = meeting.weeks[0];
    if (first === undefined) return null;
    const parity = first % 2;
    return meeting.weeks.every(week => week % 2 === parity) ? (parity === 1 ? '单周' : '双周') : null;
};

/**
 * Weeks a regular course skips: a weekly or alternate-week run with one or two
 * holes inside it means the class was called off those weeks (停课). Irregular
 * schedules (blocks of weeks, two-week labs) are not guessed at.
 */
export const suspendedWeeks = (weeks: number[]): number[] => {
    const sorted = [...new Set(weeks)].sort((left, right) => left - right);
    if (sorted.length < 4) return [];
    const first = sorted[0] as number;
    const last = sorted[sorted.length - 1] as number;
    const present = new Set(sorted);
    for (const step of [1, 2]) {
        if (step === 2 && sorted.some(week => (week - first) % 2 !== 0)) continue;
        const expected: number[] = [];
        for (let week = first; week <= last; week += step) expected.push(week);
        const missing = expected.filter(week => !present.has(week));
        if (step === 1 && missing.length > 2) continue;
        if (missing.length >= 1 && missing.length <= 2 && expected.length - missing.length >= 3) return missing;
        if (!missing.length) return [];
    }
    return [];
};

export const showAsSuspended = (meeting: TeachingMeeting, week: number): boolean => suspendedWeeks(meeting.weeks).includes(week);

export const showAsInactiveAlternating = (meeting: TeachingMeeting, week: number): boolean => {
    if (meeting.weeks.includes(week) || !alternatingWeekLabel(meeting)) return false;
    const first = Math.min(...meeting.weeks);
    const last = Math.max(...meeting.weeks);
    return week >= first - 1 && week <= last + 1;
};

export const formatWeekNumbers = (weeks: number[]): string => {
    if (!weeks.length) return '未注明';
    const sorted = [...new Set(weeks)].sort((left, right) => left - right);
    const first = sorted[0];
    if (first === undefined) return '未注明';
    const parity = sorted.length >= 2 && sorted.every(week => week % 2 === first % 2)
        ? (first % 2 === 1 ? '单周' : '双周')
        : null;
    if (parity) return `第${first}–${sorted[sorted.length - 1] ?? first}周（${parity}）`;
    const ranges: string[] = [];
    let start = first;
    let end = first;
    for (const week of sorted.slice(1)) {
        if (week === end + 1) end = week;
        else {
            ranges.push(start === end ? String(start) : `${start}–${end}`);
            start = week;
            end = week;
        }
    }
    ranges.push(start === end ? String(start) : `${start}–${end}`);
    return `第${ranges.join('、')}周`;
};
