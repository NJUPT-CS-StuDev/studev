import { describe, expect, it } from 'vitest';
import type { Exam } from '@/academics/facts';
import { attendingExams } from './examAttendance';

const exam = (id: string, code: string | null) => ({ id, course: { code, name: id } }) as Exam;
const exams = [exam('a', 'X1'), exam('b', 'X2'), exam('c', null)];

describe('which exams someone attends', () => {
    it('keeps every exam while the timetable is unknown', () => {
        expect(attendingExams(exams, {}, null).map(item => item.id)).toEqual(['a', 'b', 'c']);
    });
    it('follows the timetable, never hiding an exam without a course code', () => {
        expect(attendingExams(exams, {}, new Set(['X1'])).map(item => item.id)).toEqual(['a', 'c']);
    });
    it('lets an explicit choice win over the timetable', () => {
        expect(attendingExams(exams, { a: false, b: true }, new Set(['X1'])).map(item => item.id)).toEqual(['b', 'c']);
    });
    it('keeps an exclusion when the school changes the time or room of that exam', () => {
        expect(attendingExams([{ ...exams[0]!, start: '09:00', room: '教3-401' }], { a: false }).length).toBe(0);
    });
});
