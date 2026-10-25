import type { TeachingMeeting } from '@/academics/timetable';

/** One meeting as timetable/courses.json stores it. */
type MeetingRow = [
    id: string, weekday: number, start: number, end: number, weeks: number[],
    location: string | null, room: string | null, teacher: string | null, title: string | null, role: string | null,
];

/** One teaching class of timetable/courses.json; fields that are null are left out. */
export interface CatalogEntry {
    teaching_class_id: string;
    teaching_class_name?: string;
    course_code?: string;
    course_name: string;
    course_category?: string;
    course_nature?: string;
    campus?: string;
    teaching_method?: string;
    assessment_method?: string;
    exam_method?: string;
    credits?: number;
    class_hours?: number;
    class_hours_composition?: string;
    teaching_class_size?: number;
    enrollment_count?: number;
    capacity?: number;
    class_ids: string[];
    meetings: MeetingRow[];
}

export interface CourseCatalogFile {
    observed_at: string;
    courses: CatalogEntry[];
}

/** A teaching class ready to show: its meetings in the shape the timetable draws. */
export interface CatalogCourse {
    id: string;
    name: string;
    code: string | null;
    teachers: string[];
    campus: string | null;
    category: string | null;
    credits: number | null;
    classIds: string[];
    meetings: TeachingMeeting[];
    /** Lower-cased text the search matches against. */
    haystack: string;
}

export const expandCatalogEntry = (entry: CatalogEntry): CatalogCourse => {
    const meetings: TeachingMeeting[] = entry.meetings.map(([id, weekday, start, end, weeks, location, room, teacher, title, role]) => ({
        meeting_id: id,
        teaching_class_id: entry.teaching_class_id,
        teaching_class_name: entry.teaching_class_name ?? null,
        course_code: entry.course_code ?? null,
        course_name: entry.course_name,
        course_category: entry.course_category ?? null,
        course_nature: entry.course_nature ?? null,
        teacher,
        teacher_title: title,
        instructor_role: role,
        campus: entry.campus ?? null,
        room_id: room,
        location,
        weekday,
        start_period: start,
        end_period: end,
        week_numbers: weeks,
        teaching_method: entry.teaching_method ?? null,
        assessment_method: entry.assessment_method ?? null,
        exam_method: entry.exam_method ?? null,
        credits: entry.credits ?? null,
        class_hours: entry.class_hours ?? null,
        course_total_hours: entry.class_hours ?? null,
        class_hours_composition: entry.class_hours_composition ?? null,
        teaching_class_size: entry.teaching_class_size ?? null,
        enrollment_count: entry.enrollment_count ?? null,
        capacity: entry.capacity ?? null,
        enrollment_note: null,
        direction: null,
        online_information: null,
        class_ids: entry.class_ids,
    }));
    const teachers = [...new Set(meetings.flatMap(meeting => (meeting.teacher ?? '').split(/[,，]/).map(name => name.trim()).filter(Boolean)))];
    const locations = [...new Set(meetings.map(meeting => meeting.location ?? ''))];
    return {
        id: entry.teaching_class_id,
        name: entry.course_name,
        code: entry.course_code ?? null,
        teachers,
        campus: entry.campus ?? null,
        category: entry.course_category ?? null,
        credits: entry.credits ?? null,
        classIds: entry.class_ids,
        meetings,
        haystack: normalize([entry.course_name, entry.course_code ?? '', ...teachers, ...locations, ...entry.class_ids].join(' ')),
    };
};

/** Full-width punctuation and spacing differ between sources ("教3－405", "教3-405"). */
export const normalize = (value: string): string => value
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
        if (!words.every(word => course.haystack.includes(word))) continue;
        const name = normalize(course.name);
        const score = words.reduce((sum, word) => sum
            + (name.startsWith(word) ? 6 : name.includes(word) ? 4 : 0)
            + (course.teachers.some(teacher => normalize(teacher) === word) ? 3 : 0)
            + (course.code && normalize(course.code) === word ? 5 : 0), 0);
        scored.push({ course, score });
    }
    return scored
        .sort((left, right) => right.score - left.score
            || left.course.name.localeCompare(right.course.name, 'zh-CN')
            || (left.course.teachers[0] ?? '').localeCompare(right.course.teachers[0] ?? '', 'zh-CN'))
        .slice(0, limit)
        .map(item => item.course);
};
