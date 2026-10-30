import type { CSSProperties } from 'react';
import type { TeachingMeeting } from '@/academics/timetable';
import tokens from '../../../../design/tokens.json';

export const COURSE_TONE_COUNT = Object.keys(tokens.course.light).length;
/** FNV-1a over Unicode scalar values, unsigned 32-bit wrap after each multiply. */
export const courseHash = (value: string): number => {
    let result = 2166136261;
    for (const character of value) {
        result ^= character.codePointAt(0) ?? 0;
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
};
type CourseIdentityInput = { course: Pick<TeachingMeeting['course'], 'code' | 'name'> };
export const courseIdentity = (meeting: CourseIdentityInput): string => (
    meeting.course.code?.trim().toUpperCase() || meeting.course.name.trim().replace(/\s+/g, ' ')
);
/** Independent of classmates, electives, ordering and the chosen week. Collisions are allowed. */
export const courseToneIndex = (meeting: CourseIdentityInput): number => courseHash(courseIdentity(meeting)) % COURSE_TONE_COUNT;
export const allocateCourseTones = (meetings: TeachingMeeting[]): Map<string, number> => new Map(meetings.map(meeting => [courseIdentity(meeting), courseToneIndex(meeting)]));
export const courseToneStyle = (index: number): CSSProperties => {
    const key = `tone${index % COURSE_TONE_COUNT}` as keyof typeof tokens.course.light;
    return Object.fromEntries(['light', 'dark'].flatMap(theme => Object.entries(tokens.course[theme as 'light' | 'dark'][key]).map(([part, value]) => [`--course-${theme}-${part}`, value]))) as CSSProperties;
};
