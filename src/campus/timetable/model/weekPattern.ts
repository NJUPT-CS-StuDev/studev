import type { TeachingMeeting } from '@/world/facts';
import { roomLabel } from '@/world/names';
import { courseIdentity } from './courseColors';

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

/**
 * The lessons of a week that do not meet that week, within their run of weeks: a hint of what is usually
 * there, greyed in place. One that would overlap an earlier one is left out; the view leaves out any that
 * would overlap something on that week, and the lesson in front names it in its sheet.
 */
export function offWeekLessons(meetings: TeachingMeeting[], week: number, tones: Map<string, number>) {
    const off = meetings.filter(meeting => offThisWeek(meeting, week))
        .sort((left, right) => left.weekday - right.weekday || left.periods[0] - right.periods[0] || left.periods[1] - right.periods[1] || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const kept: TeachingMeeting[] = [];
    for (const meeting of off) if (!kept.some(other => other.weekday === meeting.weekday && other.periods[0] <= meeting.periods[1] && meeting.periods[0] <= other.periods[1])) kept.push(meeting);
    return kept.map(meeting => ({
        id: meeting.id, day: meeting.weekday, periods: meeting.periods, course: meeting.course.name, room: roomLabel(meeting.room),
        colourIndex: tones.get(courseIdentity(meeting))!, label: [alternatingWeekLabel(meeting), '本周不上课'].filter(Boolean).join(' · '),
    }));
}
