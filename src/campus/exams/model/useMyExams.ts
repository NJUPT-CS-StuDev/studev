import { catalogId } from '@/timetable/model/courseCatalog';
import { examTimestamp } from '@/exams/ui/examDateTime';
import { useEffect, useState } from 'react';
import type { Exam } from '@/academics/exam/records';
import type { TeachingMeeting } from '@/academics/timetable';
import { timetableEdits } from '@/shared/lib/preferences';
import { usePreferences } from '@/shared/lib/usePreferences';
import type { TeachingScheduleClient } from '@/timetable/model/TeachingScheduleClient';
import type { ExamSnapshotClient } from './ExamSnapshotClient';

export interface MyExams {
    /** Course codes of the visitor's own timetable, or null when it cannot be told (another class, another term). */
    ownCodes: Set<string> | null;
    /** Exams of courses the visitor added to their timetable, found under the classes that take them. */
    addedExams: Exam[];
}

const NONE: MyExams = { ownCodes: null, addedExams: [] };
const teachingClassOf = (meeting: TeachingMeeting) => meeting.teaching_class.id ?? meeting.id;

/**
 * Which exams of a class are the visitor's own. A class exam list also holds the
 * exams some classmates sit for retakes, electives or graded language classes;
 * what decides it is whether the course is in the visitor's timetable of the
 * same term (their class courses, minus those they skip, plus those they added).
 */
export function useMyExams(
    className: string | null,
    examPeriodId: string | null,
    exams: Exam[],
    teaching: TeachingScheduleClient,
    examClient: ExamSnapshotClient,
): MyExams {
    const { prefs, ready } = usePreferences();
    const [result, setResult] = useState<{ key: string; value: MyExams } | null>(null);
    const key = [className, examPeriodId, JSON.stringify(prefs), exams.length].join('|');

    useEffect(() => {
        if (!ready || !className || !examPeriodId || className !== prefs.class) return;
        const controller = new AbortController();
        void (async () => {
            const loaded = await teaching.loadClass(className, controller.signal);
            const term = loaded.term.term;
            if (term !== examPeriodId) return setResult({ key, value: NONE });
            const edits = timetableEdits(prefs, term);
            const hidden = new Set(edits.hidden);
            const ownCodes = new Set(loaded.meetings.filter(meeting => !hidden.has(teachingClassOf(meeting))).map(meeting => meeting.course.code ?? ''));
            const addedExams: Exam[] = [];
            if (edits.added.length) {
                const catalog = await teaching.loadCatalog(controller.signal);
                const seen = new Set(exams.map(exam => `${exam.course.code}|${examTimestamp(exam, 'start')}`));
                for (const course of catalog.filter(item => edits.added.includes(catalogId(item)))) {
                    if (course.meetings[0]!.course.code) ownCodes.add(course.meetings[0]!.course.code);
                    for (const other of course.meetings[0]!.classes.slice(0, 3)) {
                        const file = await examClient.classFile(other, controller.signal).catch(() => null);
                        for (const exam of file?.exams ?? []) {
                            const id = `${exam.course.code}|${examTimestamp(exam, 'start')}`;
                            if (exam.course.code === course.meetings[0]!.course.code && !seen.has(id)) {
                                seen.add(id);
                                addedExams.push(exam);
                            }
                        }
                    }
                }
            }
            setResult({ key, value: { ownCodes, addedExams } });
        })().catch(() => setResult({ key, value: NONE }));
        return () => controller.abort();
    }, [className, examClient, examPeriodId, exams, key, prefs, ready, teaching]);

    return result?.key === key ? result.value : NONE;
}
