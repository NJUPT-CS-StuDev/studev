import { describe, expect, it } from 'vitest';
import golden from '@/academics/parity/golden.json';
import type { Exam } from '@/academics/exam/records';
import { attendingExams } from './examAttendance';

describe('personal attendance on real published exams', () => {
    it('matches the shared Android vectors', () => {
        for (const test of golden.edgeCases.examAttendance) {
            const exams = golden.exams.find(group => group.class === test.class)!.exams as Exam[];
            expect(attendingExams(exams, test.choices, test.ownCodes && new Set(test.ownCodes)).map(exam => exam.id)).toEqual(test.expected);
        }
    });
    it('keeps an exclusion when the school changes the time or room of that event', () => {
        const exams = golden.exams[0]!.exams as Exam[];
        const first = exams[0]!;
        expect(attendingExams([{ ...first, start: '09:00', room: '教3-410' }], { [first.id]: false })).toEqual([]);
    });
});
