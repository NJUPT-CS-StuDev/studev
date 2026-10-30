import { describe, expect, it } from 'vitest';
import { groupCatalog, catalogId, searchCatalog } from './courseCatalog';
import { meeting } from '../../../../tests/campus-facts';
import { suspendedWeeks } from './weekPattern';
const entry = (id: string, name: string, teacher: string, location: string, weeks: number[]) => meeting({
    id: id + '-m', course: {...meeting().course, name, code: id + 'C'},
    teaching_class: {...meeting().teaching_class, id}, teachers: [{name: teacher, title: null, role: '主讲', weeks}],
    classes: ['B250401'], weekday: 5, periods: [8, 9], location, weeks,
});
describe('course catalog', () => {
    const facts = [entry('a', '中国文化概论', '葛辉', '教3－405', [1, 2, 4, 5, 6, 7, 8, 9, 10]), entry('b', '写作与沟通', '葛辉', '教3－409', [1, 2, 3, 4]), entry('c', '中华文化概论（全英文)', '凌珑', '教1－300', [1, 2, 3, 4])];
    const courses = groupCatalog(facts);
    it('keeps the original meetings and every teacher instead of expanding rows', () => {
        expect(courses[0]?.meetings[0]).toBe(facts[0]);
        const another = {...facts[0]!, id: 'a-second', teachers: [{name: '另一位教师', title: '教授', role: '辅讲', weeks: [4]}]};
        const grouped = groupCatalog([...facts, another]);
        expect(grouped[0]?.meetings).toEqual([facts[0], another]);
        expect(searchCatalog(grouped, '另一位教师').map(catalogId)).toEqual(['a']);
    });
    it('matches course names, codes, teachers and normalized rooms, including electives with no class', () => {
        expect(searchCatalog(courses, '葛辉').map(catalogId).sort()).toEqual(['a', 'b']);
        expect(searchCatalog(courses, '文化 葛辉').map(catalogId)).toEqual(['a']);
        expect(searchCatalog(courses, '教3-405').map(catalogId)).toEqual(['a']);
        expect(searchCatalog(courses, '文化概论').map(catalogId)).toEqual(['a', 'c']);
        expect(searchCatalog(courses, '   ')).toEqual([]);
        const elective = meeting({classes: [], teaching_class: {...meeting().teaching_class, id: null}});
        expect(groupCatalog([elective])[0]?.meetings[0]).toBe(elective);
        expect(searchCatalog(groupCatalog([elective]), 'JS101').map(catalogId)).toEqual([elective.id]);
    });
});
describe('suspended weeks', () => {
    it('finds a hole in a weekly or alternate-week run for grid display', () => {
        expect(suspendedWeeks([1, 2, 4, 5, 6, 7, 8, 9, 10])).toEqual([3]);
        expect(suspendedWeeks([1, 3, 5, 9, 11, 13])).toEqual([7]);
    });
    it('leaves regular and irregular schedules alone', () => {
        for (const weeks of [[1, 2, 3, 4, 5, 6, 7, 8], [2, 4, 6, 8, 10], [1, 2], [1, 2, 9, 10, 15, 16]]) expect(suspendedWeeks(weeks)).toEqual([]);
    });
});
