import { describe, expect, it } from 'vitest';
import { expandCatalogEntry, searchCatalog, type CatalogEntry } from './courseCatalog';
import { suspendedWeeks } from './weekPattern';

const entry = (id: string, name: string, teacher: string, location: string, weeks: number[]): CatalogEntry => ({
    teaching_class_id: id,
    course_name: name,
    course_code: `${id}C`,
    credits: 2,
    class_ids: ['B250401'],
    meetings: [[`${id}-m`, 5, 8, 9, weeks, location, null, teacher, null, '主讲']],
});

describe('course catalog', () => {
    const courses = [
        entry('a', '中国文化概论', '葛辉', '教3－405', [1, 2, 4, 5, 6, 7, 8, 9, 10]),
        entry('b', '写作与沟通', '葛辉', '教3－409', [1, 2, 3, 4]),
        entry('c', '中华文化概论（全英文)', '凌珑', '教1－300', [1, 2, 3, 4]),
    ].map(expandCatalogEntry);

    it('expands stored rows into timetable meetings', () => {
        const [first] = courses;
        expect(first?.meetings[0]).toMatchObject({ course_name: '中国文化概论', teacher: '葛辉', weekday: 5, start_period: 8, end_period: 9, location: '教3－405' });
    });

    it('matches every word against name, teacher and room, ranking name matches first', () => {
        expect(searchCatalog(courses, '葛辉').map(course => course.id).sort()).toEqual(['a', 'b']);
        expect(searchCatalog(courses, '文化 葛辉').map(course => course.id)).toEqual(['a']);
        expect(searchCatalog(courses, '教3-405').map(course => course.id)).toEqual(['a']);
        expect(searchCatalog(courses, '文化概论').map(course => course.id)).toEqual(['a', 'c']);
        expect(searchCatalog(courses, '   ')).toEqual([]);
    });
});

describe('suspended weeks', () => {
    it('finds a hole in a weekly run', () => {
        expect(suspendedWeeks([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])).toEqual([3]);
        expect(suspendedWeeks([1, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([2]);
    });

    it('finds a hole in an alternate-week run', () => {
        expect(suspendedWeeks([1, 3, 5, 9, 11, 13])).toEqual([7]);
    });

    it('leaves regular and irregular schedules alone', () => {
        expect(suspendedWeeks([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([]);
        expect(suspendedWeeks([2, 4, 6, 8, 10])).toEqual([]);
        expect(suspendedWeeks([1, 2])).toEqual([]);
        expect(suspendedWeeks([1, 2, 9, 10, 15, 16])).toEqual([]);
    });
});
