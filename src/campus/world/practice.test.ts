import { describe, expect, it } from 'vitest';
import { practiceName, practiceProgress, practiceTeachers } from './practice';

const p = (name: string, text: string, weeks = [15, 16]) => ({ name, text, weeks });

describe('practice coursework read from the timetable string', () => {
    it('names the people after a proven course name, none where the name is not proven', () => {
        expect(practiceTeachers(p('算法与数据结构设计', '算法与数据结构设计陈兴国(共2周)/15-16周'))).toEqual(['陈兴国']);
        expect(practiceTeachers(p('课程设计', '课程设计李琴,杨洁(共1周)/第11周'))).toEqual(['李琴', '杨洁']);
        expect(practiceTeachers(p('形势与政策实践III陈凡', '形势与政策实践III陈凡(共19周)/1-19周'))).toEqual([]);
    });
    it('restores an opening quote the source dropped', () => {
        expect(practiceName(p('习近平新时代中国特色社会主义思想概论”实践', ''))).toBe('“习近平新时代中国特色社会主义思想概论”实践');
        expect(practiceName(p('“毛概”实践', ''))).toBe('“毛概”实践');
    });
    it('says where it stands in the term', () => {
        expect(practiceProgress([15, 16], 12)).toEqual({ state: 'ahead', text: '3 周后开始' });
        expect(practiceProgress([9, 10, 11, 12, 13], 12)).toEqual({ state: 'now', text: '进行中 · 第 4 / 5 周' });
        expect(practiceProgress([1, 2, 3], 12)).toEqual({ state: 'done', text: '已结束' });
    });
});
