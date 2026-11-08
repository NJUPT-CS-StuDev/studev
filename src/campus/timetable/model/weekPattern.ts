import type { TeachingMeeting } from '@/world/facts';

export const alternatingWeekLabel = (meeting: TeachingMeeting): '单周' | '双周' | null => {
    if (meeting.weeks.length < 2) return null;
    const first = meeting.weeks[0];
    if (first === undefined) return null;
    const parity = first % 2;
    return meeting.weeks.every(week => week % 2 === parity) ? (parity === 1 ? '单周' : '双周') : null;
};

/** A lesson within its run of weeks that does not meet this week: it keeps its place, greyed. */
export const offThisWeek = (meeting: TeachingMeeting, week: number): boolean =>
    !meeting.weeks.includes(week) && week >= Math.min(...meeting.weeks) && week <= Math.max(...meeting.weeks);

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
