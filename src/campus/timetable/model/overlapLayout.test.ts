import { describe, expect, it } from 'vitest';
import type { TeachingMeeting } from '@/academics/timetable';
import { describeMeetingOverlap, groupOverlappingMeetings } from './overlapLayout';
const meeting = (meetingId: string, weekday: number, startPeriod: number, endPeriod: number, courseCode = meetingId): TeachingMeeting => ({
    course: {
        code: courseCode,
        name: courseCode,
        category: null,
        nature: null,
        credits: null,
        hours: null,
        hours_composition: null,
        assessment: null,
        exam: null
    },
    teaching_class: {
        id: null,
        name: null,
        size: null,
        enrolled: null,
        capacity: null
    },
    teachers: [],
    periods: [startPeriod, endPeriod],
    id: meetingId,
    campus: null,
    room: null,
    location: null,
    weekday: weekday,
    weeks: [1],
    method: null,
    classes: ['B240402']
});
describe('groupOverlappingMeetings', () => {
    it('uses separate deterministic columns for intersecting schedules', () => {
        const groups = groupOverlappingMeetings([
            meeting('later', 1, 2, 4),
            meeting('first', 1, 1, 2),
            meeting('third', 1, 3, 3),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 4, slotCount: 2 });
        expect(groups[0]?.positioned.map(item => [item.meeting.id, item.slot])).toEqual([
            ['first', 0],
            ['later', 1],
            ['third', 0],
        ]);
    });
    it('does not group adjacent or different-day schedules together', () => {
        const groups = groupOverlappingMeetings([
            meeting('one', 1, 1, 2),
            meeting('two', 1, 3, 4),
            meeting('three', 2, 1, 2),
        ]);
        expect(groups).toHaveLength(3);
        expect(groups.every(group => group.slotCount === 1)).toBe(true);
    });
});
describe('describeMeetingOverlap', () => {
    it('recognizes simultaneous arrangements of the same course as parallel', () => {
        const first = meeting('lecture', 1, 6, 7, 'TX100011S');
        const second = meeting('flipped', 1, 6, 7, 'TX100011S');
        expect(describeMeetingOverlap(first, [first, second])).toEqual({ count: 2, kind: 'parallel' });
    });
    it('recognizes intersecting different courses as a time overlap', () => {
        const first = meeting('network', 6, 6, 7, 'JS1111X0S');
        const second = meeting('signals', 6, 6, 7, 'TX100011S');
        expect(describeMeetingOverlap(first, [first, second])).toEqual({ count: 2, kind: 'overlap' });
    });
    it('returns no marker for an isolated arrangement', () => {
        const only = meeting('only', 3, 1, 2);
        expect(describeMeetingOverlap(only, [only])).toBeNull();
    });
});
