import type { Exam } from '@/world/facts';

// Every exam the class's rows name is one's own until one says otherwise: missing an exam is the failure that
// matters, so nothing is taken away by inference. What one takes away stays in sight, greyed, and comes back in a tap.

/** The exams one sits: all of them, but those one has explicitly said one does not take. */
export function attendingExams(exams: Exam[], choices: Readonly<Record<string, boolean | undefined>>): Exam[] {
    return exams.filter(exam => choices[exam.id] !== false);
}

/** The exams one has taken away, kept to show greyed and to restore. */
export function skippedExams(exams: Exam[], choices: Readonly<Record<string, boolean | undefined>>): Exam[] {
    return exams.filter(exam => choices[exam.id] === false);
}

/** Exams of courses one's timetable does not have, for the one-tap clean-up. An exam without a course code is never
 * offered: there is nothing to compare it with, so it stays. */
export function outsideTimetable(exams: Exam[], ownCodes: ReadonlySet<string>): Exam[] {
    return exams.filter(exam => exam.course.code && !ownCodes.has(exam.course.code));
}
