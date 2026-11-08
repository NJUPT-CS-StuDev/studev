import { describe, expect, it } from 'vitest';
import type { Exam, TeachingMeeting, TeachingPeriod, TeachingTerm } from '@/world/facts';
import type { Timeline } from '@/world/events';
import { calendarFile, examEntries, lessonEntries } from './calendar';

const term = { term: '2026-2027-1', weeks: [1, 2, 3, 4, 5].map(week => ({ week, start: `2026-09-${String(7 * week - 6).padStart(2, '0')}`, end: `2026-09-${String(7 * week).padStart(2, '0')}` })) } as TeachingTerm;
const periods = [{ period: 1, start: '08:00', end: '08:45' }, { period: 2, start: '08:50', end: '09:35' }] as TeachingPeriod[];
const meeting = { id: 'm', weekday: 1, periods: [1, 2], weeks: [1, 2, 4, 5], course: { code: 'X', name: '操作系统基础' }, room: '仙林/教4-309', location: null, teachers: [{ name: '某老师' }] } as unknown as TeachingMeeting;
const line: Timeline = { term, periods, meetings: [meeting], exams: [], holidays: new Map([['2026-09-29', '国庆']]), run: null };

describe('the timeline as a calendar', () => {
    it('writes a lesson as one weekly series that skips its off weeks and holidays', () => {
        const file = calendarFile('t', lessonEntries(line), new Date('2026-11-08T00:00:00Z'));
        expect(file).toContain('DTSTART;TZID=Asia/Shanghai:20260901T080000');
        expect(file).toContain('RRULE:FREQ=WEEKLY;UNTIL=20260922T013500Z');
        expect(file).not.toContain('20260929');
        expect(file).toContain('EXDATE;TZID=Asia/Shanghai:20260915T080000');
        expect(file).toContain('LOCATION:教4-309');
    });
    it('reminds of an exam the evening before at eight and keeps every line within 75 octets', () => {
        const exam = { id: 'e', course: { code: 'X', name: '毛泽东思想和中国特色社会主义理论体系概论' }, date: '2026-11-11', start: '13:30', end: '15:20', room: '仙林/教2-519', location: null, teacher: '甲、乙、丙、丁', students: 81 } as Exam;
        const file = calendarFile('t', examEntries([exam], ['eve', 'hour']), new Date('2026-11-08T00:00:00Z'));
        expect(file).toContain('TRIGGER:-PT1050M');
        expect(file).toContain('TRIGGER:-PT60M');
        for (const row of file.split('\r\n')) expect(new TextEncoder().encode(row).length).toBeLessThanOrEqual(75);
    });
});
