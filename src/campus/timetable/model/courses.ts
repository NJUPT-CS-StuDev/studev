// What a person changed about their courses beyond hiding and adding: a name of their own for a course (板块课
// becomes 男生足球), and courses of their own (an elective, a lab the sheets miss, a practical that takes the week).
// A course of one's own becomes ordinary meetings, so everything a timetable does works on it unchanged.
import type { TeachingMeeting } from '@/world/facts';
import { courseIdentity, linkedCourse } from './courseColors';

export interface CustomCourse {
    id: string; name: string;
    /** The weekdays it meets, 1 for Monday. */
    days: number[];
    periods: [number, number];
    weeks: number[];
    room?: string; teacher?: string;
}

/** A course of one's own as the meetings a timetable draws, one for each of its days. */
export const customMeetings = (course: CustomCourse): TeachingMeeting[] => course.days.map(day => ({
    id: `custom:${course.id}:${day}`,
    course: { code: null, name: course.name, category: null, nature: null, credits: null, hours: null, hours_composition: null, assessment: null, exam: null },
    teachers: course.teacher ? [{ id: course.teacher, name: course.teacher, title: null, role: null, weeks: course.weeks }] : [],
    teaching_class: { id: `custom:${course.id}`, size: null },
    campus: null, room: course.room ?? null, location: course.room ?? null, weekday: day, periods: course.periods, weeks: course.weeks, method: null, classes: [],
}));

/** An authored display name never rewrites the public course fact or passes through name shortening. */
export const personalCourseName = (item: { course: { code: string | null; name: string }; teaching_class?: { id: string } }, meetings: TeachingMeeting[], names: Record<string, string> | undefined) =>
    names?.[courseIdentity(linkedCourse(item, meetings))] ?? (item.teaching_class?.id.startsWith('custom:') ? item.course.name : undefined);

/** "1-16", "1-8,10,12-14", "单1-15", "双 2-16": the weeks written; null when the text is not weeks. */
export function parseWeeks(text: string, last: number): number[] | null {
    const parity = /^\s*单/.test(text) ? 1 : /^\s*双/.test(text) ? 0 : null;
    const body = text.replace(/^\s*[单双]\s*/, '').replace(/周/g, '');
    const weeks = new Set<number>();
    for (const part of body.split(/[,，、\s]+/).filter(Boolean)) {
        const match = /^(\d{1,2})(?:[-~–](\d{1,2}))?$/.exec(part);
        if (!match) return null;
        const from = Number(match[1]), to = Number(match[2] ?? match[1]);
        if (from < 1 || to < from || to > last) return null;
        for (let week = from; week <= to; week++) if (parity === null || week % 2 === parity) weeks.add(week);
    }
    return weeks.size ? [...weeks].sort((a, b) => a - b) : null;
}
