import { useCallback, useMemo, useState } from 'react';
import type { Exam } from '@/academics/exam/records';
import { examAttendanceScope, readPreferences, updateExamAttendance } from '@/shared/lib/preferences';
import { usePreferences } from '@/shared/lib/usePreferences';
import { attendingExams } from './examAttendance';
import {
    buildDefaultSelectedExamIds,
    buildExamSelectionScope,
    getExamExportStatus,
    readExamExportState,
    writeExamExportState,
} from './examSelection';

export const useSelectedExamIds = (
    className: string | null,
    exams: Exam[],
    snapshotId: string | null,
    examPeriodId: string | null,
    sourceUpdatedAt: string | null,
    ownCodes: Set<string> | null = null,
) => {
    const { prefs } = usePreferences();
    const [, refreshExportState] = useState(0);
    const examIds = useMemo(() => exams.map(exam => exam.id), [exams]);
    const scope = useMemo(() => buildExamSelectionScope(className, examPeriodId, snapshotId), [className, snapshotId, examPeriodId]);
    const exportState = className && examPeriodId ? readExamExportState(examPeriodId, className) : null;
    const defaultSelectedIds = useMemo(
        () => buildDefaultSelectedExamIds(exams, exportState),
        [exams, exportState]
    );

    const attendanceScope = className && examPeriodId ? examAttendanceScope(examPeriodId, className) : null;
    const legacyChoices = exportState ? Object.fromEntries(exportState.all.map(exam => [exam.id, defaultSelectedIds.has(exam.id)])) : {};
    const choices = attendanceScope ? prefs.examAttendance?.[attendanceScope] ?? legacyChoices : {};
    const selectedIds = new Set(attendingExams(exams, choices, ownCodes).map(exam => exam.id));

    const toggleExamSelection = useCallback((id: string) => {
        if (!scope) return;

        if (!className || !examPeriodId) return;
        const currentChoices = readPreferences().examAttendance?.[examAttendanceScope(examPeriodId, className)] ?? legacyChoices;
        const selected = attendingExams(exams, currentChoices, ownCodes).some(exam => exam.id === id);
        updateExamAttendance(examPeriodId, className, { ...currentChoices, [id]: !selected });
    }, [className, examPeriodId, exams, legacyChoices, ownCodes, scope]);

    const selectAllExamIds = useCallback(() => {
        if (!scope) return;
        if (className && examPeriodId) updateExamAttendance(examPeriodId, className, Object.fromEntries(examIds.map(id => [id, true])));
    }, [className, examPeriodId, examIds, scope]);

    const clearExamSelection = useCallback(() => {
        if (!scope) return;
        if (className && examPeriodId) updateExamAttendance(examPeriodId, className, Object.fromEntries(examIds.map(id => [id, false])));
    }, [className, examPeriodId, examIds, scope]);

    const markExamsExported = useCallback((exportedExams: Exam[]) => {
        if (!className || !snapshotId || !examPeriodId || !sourceUpdatedAt) return;
        writeExamExportState(className, exams, exportedExams, examPeriodId, snapshotId, sourceUpdatedAt);
        refreshExportState(value => value + 1);
    }, [sourceUpdatedAt, className, snapshotId, examPeriodId, exams]);

    const getExamStatus = useCallback((exam: Exam) => {
        return getExamExportStatus(exam, exportState);
    }, [exportState]);

    return {
        selectedIds,
        toggleExamSelection,
        selectAllExamIds,
        clearExamSelection,
        markExamsExported,
        getExamStatus,
    };
};
