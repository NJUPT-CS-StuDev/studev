import type { TeachingMeeting } from '@/academics/timetable';
/** One displayed teaching class, retaining every original meeting. */
export interface CatalogCourse { meetings: TeachingMeeting[] }
export const catalogId = (course: CatalogCourse): string => course.meetings[0]!.teaching_class.id ?? course.meetings[0]!.id;
export const groupCatalog = (meetings: TeachingMeeting[]): CatalogCourse[] => {
    const groups = new Map<string, CatalogCourse>();
    for (const meeting of meetings) {
        const id = meeting.teaching_class.id ?? meeting.id;
        const group = groups.get(id) ?? { meetings: [] };
        group.meetings.push(meeting); groups.set(id, group);
    }
    return [...groups.values()];
};
const catalogText = (course: CatalogCourse): string => normalize(course.meetings.flatMap(m => [
    m.course.name, m.course.code ?? '', ...m.teachers.map(t => t.name), m.location ?? '', ...m.classes,
]).join(' '));

/** Full-width punctuation and spacing differ between sources ("教3－405", "教3-405"). */
const normalize = (value: string): string => value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[－—–]/g, '-')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Courses whose name, code, teacher, room or classes contain every word of the
 * query. A name match ranks above a teacher or room match.
 */
export const searchCatalog = (courses: CatalogCourse[], query: string, limit = 60): CatalogCourse[] => {
    const words = normalize(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    const scored: Array<{ course: CatalogCourse; score: number }> = [];
    for (const course of courses) {
        if (!words.every(word => catalogText(course).includes(word))) continue;
        const name = normalize(course.meetings[0]!.course.name);
        const score = words.reduce((sum, word) => sum
            + (name.startsWith(word) ? 6 : name.includes(word) ? 4 : 0)
            + (course.meetings.flatMap(m => m.teachers.map(t => t.name)).some(teacher => normalize(teacher) === word) ? 3 : 0)
            + (course.meetings[0]!.course.code && normalize(course.meetings[0]!.course.code) === word ? 5 : 0), 0);
        scored.push({ course, score });
    }
    return scored
        .sort((left, right) => right.score - left.score
            || left.course.meetings[0]!.course.name.localeCompare(right.course.meetings[0]!.course.name, 'zh-CN')
            || (left.course.meetings.flatMap(m => m.teachers.map(t => t.name))[0] ?? '').localeCompare(right.course.meetings.flatMap(m => m.teachers.map(t => t.name))[0] ?? '', 'zh-CN'))
        .slice(0, limit)
        .map(item => item.course);
};
