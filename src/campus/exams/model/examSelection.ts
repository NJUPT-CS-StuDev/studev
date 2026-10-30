import { getExamCalendarIdentity } from '@/academics/exam/calendar';
import type { Exam } from '@/academics/exam/records';

const STORAGE_PREFIX = 'studev:exam-selection:';

export type ExamExportStatus = 0 | 1 | 2;

export interface ExamExportState {
    className: string;
    snapshotId: string;
    sourceUpdatedAt: string;
    all: Exam[];
    selected: Exam[];
}

const storageKey = (examPeriodId: string, className: string): string => (
    `${STORAGE_PREFIX}${examPeriodId}:${className.toUpperCase()}`
);

const hasExportableTime = (exam: Exam): boolean => (
    Boolean(exam.date && exam.start && exam.end)
);

export const getExamExportKey = (exam: Exam): string => getExamCalendarIdentity(exam);

export const buildExamSelectionScope = (
    className: string | null,
    examPeriodId: string | null,
    snapshotId: string | null
): string | null => {
    if (!className || !examPeriodId || !snapshotId) return null;
    return `${examPeriodId}\u001f${className.toUpperCase()}\u001f${snapshotId}`;
};

export const buildDefaultSelectedExamIds = (
    exams: Exam[],
    exported: ExamExportState | null
): Set<string> => {
    if (!exported) {
        return new Set(exams.filter(hasExportableTime).map(exam => exam.id));
    }
    const selectedKeys = new Set(exported.selected.map(item => item.id));
    const knownKeys = new Set(exported.all.map(item => item.id));
    return new Set(
        exams
            .filter(hasExportableTime)
            .filter(exam => {
                const key = getExamExportKey(exam);
                return selectedKeys.has(key) || !knownKeys.has(key);
            })
            .map(exam => exam.id)
    );
};

export const getExamExportStatus = (
    exam: Exam,
    exported: ExamExportState | null
): ExamExportStatus => {
    if (!exported) return 0;
    const key = getExamExportKey(exam);
    const selected = exported.selected.find(item => item.id === key);
    if (!selected) {
        return exported.all.some(item => item.id === key) ? 0 : 1;
    }
    const fields = ['date', 'start', 'end', 'location', 'campus', 'teacher', 'students', 'note'] as const;
    return fields.every(field => selected[field] === exam[field])
        && selected.course.code === exam.course.code && selected.course.name === exam.course.name ? 0 : 2;
};

const isExamStateList = (value: unknown): value is Exam[] => Array.isArray(value) && value.every(item => {
    if (!item || typeof item !== 'object') return false;
    const exam = item as Exam;
    return typeof exam.id === 'string' && typeof exam.class === 'string'
        && typeof exam.course?.name === 'string' && typeof exam.date === 'string'
        && typeof exam.start === 'string' && typeof exam.end === 'string';
});

const isExamExportState = (value: unknown): value is ExamExportState => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const state = value as Partial<ExamExportState>;
    return typeof state.className === 'string'
        && typeof state.snapshotId === 'string'
        && typeof state.sourceUpdatedAt === 'string'
        && isExamStateList(state.all)
        && isExamStateList(state.selected);
};

export const readExamExportState = (
    examPeriodId: string,
    className: string
): ExamExportState | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(storageKey(examPeriodId, className));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isExamExportState(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

export const writeExamExportState = (
    className: string,
    allExams: Exam[],
    exportedExams: Exam[],
    examPeriodId: string,
    snapshotId: string,
    sourceUpdatedAt: string
): void => {
    if (typeof window === 'undefined') return;
    const payload: ExamExportState = {
        className: className.toUpperCase(),
        snapshotId,
        sourceUpdatedAt,
        all: allExams.filter(hasExportableTime),
        selected: exportedExams.filter(hasExportableTime)
    };
    try {
        window.localStorage.setItem(storageKey(examPeriodId, className), JSON.stringify(payload));
    } catch {
        return;
    }
};
