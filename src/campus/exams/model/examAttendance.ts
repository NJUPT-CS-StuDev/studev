import type { Exam } from '@/academics/exam/records';

/** Explicit choices win over the same-term timetable; an unknown timetable never excludes exams. */
export function attendingExams(exams: Exam[], choices: Readonly<Record<string, boolean | undefined>>, ownCodes: Set<string> | null = null): Exam[] {
    return exams.filter(exam => choices[exam.id] ?? (!ownCodes || !exam.course.code || ownCodes.has(exam.course.code)));
}
