import type { CSSProperties } from 'react';
import type { TeachingMeeting } from '@/world/facts';
import tokens from '../../../../design/tokens.json';
import { courseName } from '@/world/names';

const COURSE_TONE_COUNT = Object.keys(tokens.course.light).length;
type CourseIdentityInput = { course: Pick<TeachingMeeting['course'], 'code' | 'name'> };
export const courseIdentity = (meeting: CourseIdentityInput): string => (
    meeting.course.code?.trim().toUpperCase() || meeting.course.name.trim().replace(/\s+/g, ' ')
);
/** Where each tone sits on the hue circle, in steps of 30° (design/tokens.json course.light borders). */
const TONE_POSITION = [7, 5, 4, 3, 2, 1, 0, 11, 10, 9, 8, 6];
/** Which tone to prefer when all else is equal: the first three 120° apart, the first six 60° apart. */
const TONE_ORDER = [0, 7, 3, 9, 5, 1, 10, 6, 2, 8, 4, 11];
const apart = (left: number, right: number) => { const steps = Math.abs(TONE_POSITION[left]! - TONE_POSITION[right]!); return Math.min(steps, COURSE_TONE_COUNT - steps); };
/**
 * One timetable's colours. Courses that meet on the same day are neighbours: they appear side by side.
 * The busiest courses choose first, each taking a tone no neighbour has and, where it can, at least one
 * tone away from each neighbour's; then the least used, so a tone is shared only by courses that never
 * meet on the same day and so never show together. Adding or hiding a course can move others along.
 */
export const courseTones = (meetings: (CourseIdentityInput & { weekday: number })[]): Map<string, number> => {
    const days = new Map<string, Set<number>>();
    for (const meeting of meetings) days.set(courseIdentity(meeting), (days.get(courseIdentity(meeting)) ?? new Set()).add(meeting.weekday));
    const ids = [...days.keys()].sort();
    const neighbours = new Map(ids.map(id => [id, ids.filter(other => other !== id && [...days.get(id)!].some(day => days.get(other)!.has(day)))]));
    const tones = new Map<string, number>();
    const used = new Array<number>(COURSE_TONE_COUNT).fill(0);
    for (const id of [...ids].sort((left, right) => neighbours.get(right)!.length - neighbours.get(left)!.length || (left < right ? -1 : left > right ? 1 : 0))) {
        const near = neighbours.get(id)!.flatMap(other => tones.has(other) ? [tones.get(other)!] : []);
        // Unlike its neighbours, then at least one tone away from each, then the least used, then the usual order.
        const score = (tone: number) => [near.includes(tone) ? 0 : 1, Math.min(2, ...near.map(other => apart(tone, other))), -used[tone]!, -TONE_ORDER.indexOf(tone)];
        const better = (left: number[], right: number[]) => { for (let at = 0; at < left.length; at++) if (left[at] !== right[at]) return left[at]! > right[at]!; return false; };
        let best = TONE_ORDER[0]!;
        for (const tone of TONE_ORDER) if (better(score(tone), score(best))) best = tone;
        tones.set(id, best);
        used[best]!++;
    }
    return tones;
};
/**
 * A lab belongs to a lesson's course when the two carry the same course code, or the same name: the lab sheet
 * often gives a lab its own code (Linux 编程 labs are B0301371S, its lessons JS113701S), never a different name.
 */
export const sameCourse = (left: CourseIdentityInput, right: CourseIdentityInput) =>
    courseIdentity(left) === courseIdentity(right) || courseName(left.course.name).toLowerCase() === courseName(right.course.name).toLowerCase();
/** The course a lab's colour and links follow: that of the lesson it belongs to, or its own. */
export const linkedCourse = (lab: CourseIdentityInput, meetings: CourseIdentityInput[]) => meetings.find(meeting => sameCourse(lab, meeting)) ?? lab;
/** One timetable's colours: a lab takes its course's tone, and a course that only has labs gets one too. */
export const timelineTones = (line: { meetings: (CourseIdentityInput & { weekday: number })[]; labs: (CourseIdentityInput & { weekday: number })[] }) =>
    courseTones([...line.meetings, ...line.labs.map(lab => ({ course: linkedCourse(lab, line.meetings).course, weekday: lab.weekday }))]);
/** The tone of something on a timeline: a lesson's own, a lab its course's. */
export const eventTone = (tones: Map<string, number>, event: { meeting?: CourseIdentityInput; lab?: CourseIdentityInput }, meetings: CourseIdentityInput[]) =>
    event.meeting ? tones.get(courseIdentity(event.meeting)) : event.lab ? tones.get(courseIdentity(linkedCourse(event.lab, meetings))) : undefined;
export const courseToneStyle = (index: number): CSSProperties => {
    const key = `tone${index % COURSE_TONE_COUNT}` as keyof typeof tokens.course.light;
    return Object.fromEntries(['light', 'dark'].flatMap(theme => Object.entries(tokens.course[theme as 'light' | 'dark'][key]).map(([part, value]) => [`--course-${theme}-${part}`, value]))) as CSSProperties;
};
