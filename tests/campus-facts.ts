import type { Exam, TeachingMeeting } from '../src/campus/academics/facts';

export const meeting = (overrides: Partial<TeachingMeeting> = {}): TeachingMeeting => ({
    id: 'meeting-1',
    course: { code: 'JS101', name: '算法', category: null, nature: null, credits: 2, hours: 32, hours_composition: null, assessment: null, exam: null },
    teaching_class: { id: 'teaching-1', name: '教学班1', size: null, enrolled: null, capacity: null },
    teachers: [], campus: '仙林', location: '教1-101', room: '教1-101',
    weekday: 1, periods: [1, 2], weeks: [1, 2, 3], method: null, classes: ['B240402'], ...overrides,
});

export const exam = (overrides: Partial<Exam> = {}): Exam => ({
    id: 'exam-1', class: 'B240402', course: { code: 'JS101', name: '算法' }, teacher: '张三',
    campus: '仙林', location: '教1-101', room: '教1-101', date: '2026-07-01',
    start: '08:00', end: '09:50', students: 30, note: null, ...overrides,
});
