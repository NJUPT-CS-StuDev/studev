import { describe, expect, it } from 'vitest';
import { exam } from '../../../../tests/campus-facts';
import { buildDefaultSelectedExamIds, getExamExportStatus, getExamExportKey, type ExamExportState } from './examSelection';
const first = exam(), second = exam({id: 'exam-2', course: {code: 'JS102', name: '离散数学'}});
const exported: ExamExportState = {className: first.class, snapshotId: 'release-1', sourceUpdatedAt: '2026-06-10', all: [first, second], selected: [first]};
describe('exam export selection', () => {
    it('selects all exams on the first export and remembers deselections', () => {
        expect(buildDefaultSelectedExamIds([first, second], null)).toEqual(new Set([first.id, second.id]));
        expect(buildDefaultSelectedExamIds([first, second], exported)).toEqual(new Set([first.id]));
    });
    it('selects a newly published exam and marks it as new', () => {
        const added = exam({id: 'new'});
        expect(buildDefaultSelectedExamIds([first, second, added], exported)).toEqual(new Set([first.id, added.id]));
        expect(getExamExportStatus(added, exported)).toBe(1);
    });
    it('compares the actual exported facts without a fingerprint', () => {
        expect(getExamExportStatus({...first}, exported)).toBe(0);
        expect(getExamExportStatus({...first, note: '带证件'}, exported)).toBe(2);
        expect(getExamExportStatus({...first, students: null}, exported)).toBe(2);
        expect(getExamExportStatus(second, exported)).toBe(0);
        expect(getExamExportKey(first)).toBe(first.id);
    });
});
