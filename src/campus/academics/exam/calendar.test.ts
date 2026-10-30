import { describe, expect, it } from 'vitest';
import type { Exam } from './records';
import { generateICSContent, getExamCalendarIdentity } from './calendar';
const baseExam: Exam = {
    course: {
        code: 'DG1011X0S',
        name: '数字电路与逻辑设计B'
    },
    start: '2026-07-01T18:30:00+08:00'.slice(11, 16),
    end: '2026-07-01T20:20:00+08:00'.slice(11, 16),
    id: 'exam-a',
    campus: '仙林',
    class: 'B240402',
    teacher: '张晶',
    location: '教2－410',
    students: 31,
    note: '携带铅笔,橡皮;证件',
    date: '2026-07-01',
    room: null
};
describe('exam calendar export', () => {
    it('generates Shanghai-time events and escapes text', () => {
        const content = generateICSContent([baseExam], 'B240402', [30]);
        expect(content).toContain('VERSION:2.0');
        expect(content).toContain('DTSTART;TZID=Asia/Shanghai:20260701T183000');
        expect(content).toContain('备注: 携带铅笔\\,橡皮\\;证件');
        expect(content).toContain('TRIGGER:-PT30M');
    });
    it('uses the published identity regardless of display changes', () => {
        expect(getExamCalendarIdentity({ ...baseExam, location: '教3－308' }))
            .toBe(getExamCalendarIdentity(baseExam));
        expect(getExamCalendarIdentity({ ...baseExam, id: 'exam-b' }))
            .not.toBe(getExamCalendarIdentity(baseExam));
    });
});
