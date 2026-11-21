import { describe, expect, it } from 'vitest';
import type { Exam } from '@/world/facts';
import { attendingExams, outsideTimetable, skippedExams } from './examAttendance';

const exam = (id: string, code: string | null) => ({ id, course: { code, name: id } }) as Exam;
const exams = [exam('a', 'X1'), exam('b', 'X2'), exam('c', null)];
const ids = (list: Exam[]) => list.map(item => item.id);

describe('which exams someone attends', () => {
    it('keeps every exam the class is named on, whatever the timetable says', () => {
        expect(ids(attendingExams(exams, {}))).toEqual(['a', 'b', 'c']);
    });
    it('takes away only what one took away, and keeps it to restore', () => {
        expect(ids(attendingExams(exams, { a: false, b: true }))).toEqual(['b', 'c']);
        expect(ids(skippedExams(exams, { a: false, b: true }))).toEqual(['a']);
    });
    it('offers exams of other courses for clean-up, never one without a course code', () => {
        expect(ids(outsideTimetable(exams, new Set(['X1'])))).toEqual(['b']);
    });
    it('keeps an exclusion when the school changes the time or room of that exam', () => {
        expect(attendingExams([{ ...exams[0]!, start: '09:00', room: '教3-401' }], { a: false }).length).toBe(0);
    });
});
