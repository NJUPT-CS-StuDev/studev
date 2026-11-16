import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import type { TeachingMeeting } from '@/world/facts';
import { customMeetings, managedCourses, personalCourseName, type CustomCourse } from './courses';

let own: TeachingMeeting[], all: TeachingMeeting[];
beforeAll(async () => {
    const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
    const base = `public${release.base}/teaching/${release.teaching}`;
    own = JSON.parse(await readFile(`${base}/classes/B240402.json`, 'utf8')).meetings;
    all = JSON.parse(await readFile(`${base}/meetings.json`, 'utf8'));
});

describe('a person manages the same courses the timetable draws', () => {
    it('keeps all released arrangements together by teaching class, including hidden courses', () => {
        const hidden = own[0]!.teaching_class.id;
        const groups = managedCourses(own, [], { hidden: [hidden], added: [] });
        expect(groups).toHaveLength(new Set(own.map(meeting => meeting.teaching_class.id)).size);
        expect(groups.flatMap(group => group.meetings).map(meeting => meeting.id).sort()).toEqual(own.map(meeting => meeting.id).sort());
        expect(groups.filter(group => group.hidden).map(group => group.id)).toEqual([hidden]);
        expect(groups.find(group => group.id === hidden)?.meetings.length).toBeGreaterThan(0);
    });
    it('keeps separately taught classes distinct and edits a personal course without changing its id', () => {
        const another = all.find(meeting => !own.some(item => item.teaching_class.id === meeting.teaching_class.id))!;
        const personal: CustomCourse = { id: 'personal-course', name: own[0]!.course.name, days: [2, 4], periods: [3, 4], weeks: [1, 3, 5], teacher: '任课教师', room: '仙林/教1-101' };
        const edits = { hidden: [], added: [another.teaching_class.id], custom: [personal] };
        const groups = managedCourses(own, all, edits);
        expect(groups.find(group => group.id === another.teaching_class.id)?.source).toBe('added');
        expect(groups.find(group => group.id === 'custom:personal-course')?.meetings).toEqual(customMeetings(personal));
        expect(personalCourseName(customMeetings(personal)[0]!, own, { [personal.name]: '另一门课的显示名称' })).toBe(personal.name);
        const changed = { ...personal, name: '调整后的课程', days: [5], periods: [6, 7] as [number, number], room: '仙林/教1-102' };
        const next = managedCourses(own, all, { ...edits, custom: [changed] });
        expect(next).toHaveLength(groups.length);
        expect(next.find(group => group.id === 'custom:personal-course')?.meetings[0]).toMatchObject({ weekday: 5, periods: [6, 7], room: '仙林/教1-102', course: { name: '调整后的课程' } });
        expect(next.find(group => group.id === own[0]!.teaching_class.id)?.meetings).toEqual(groups.find(group => group.id === own[0]!.teaching_class.id)?.meetings);
    });
});
