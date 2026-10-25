import { describe, expect, it } from 'vitest';
import type { TeachingPeriod } from '@/academics/timetable';
import type { SpaceFamily } from '@/academics/space';
import { clampToTerm, dayStatus, freeRun, isFree, nowInShanghai, occupantsAt, periodAt, roomMatches, weekOf } from './campusDay';
import type { ClassroomDayFile } from './ClassroomAvailabilityClient';

const periods: TeachingPeriod[] = [
    { period: 1, start_time: '08:00', end_time: '08:45', day_part: '上午' },
    { period: 2, start_time: '08:50', end_time: '09:35', day_part: '上午' },
    { period: 3, start_time: '09:50', end_time: '10:35', day_part: '上午' },
];

describe('campus day', () => {
    it('reads the time in Nanjing whatever the browser zone is', () => {
        // 10:51 UTC is 18:51 in Nanjing (and 03:51 in California).
        expect(nowInShanghai(new Date('2026-10-25T10:51:00Z'))).toEqual({ date: '2026-10-25', minutes: 18 * 60 + 51 });
        expect(nowInShanghai(new Date('2026-10-25T17:30:00Z')).date).toBe('2026-10-26');
    });

    it('picks the running period, else the next one, else the last', () => {
        expect(periodAt(periods, 7 * 60)).toBe(1);
        expect(periodAt(periods, 8 * 60 + 10)).toBe(1);
        expect(periodAt(periods, 9 * 60 + 40)).toBe(3);
        expect(periodAt(periods, 22 * 60)).toBe(3);
    });

    it('places a date in the term', () => {
        const weeks = [{ week: 1, start_date: '2026-08-31', end_date: '2026-09-06' }, { week: 2, start_date: '2026-09-07', end_date: '2026-09-13' }];
        expect(clampToTerm(weeks, '2026-07-01')).toBe('2026-08-31');
        expect(clampToTerm(weeks, '2027-01-01')).toBe('2026-09-13');
        expect(weekOf(weeks, '2026-09-09')).toEqual({ week: 2, weekday: 3 });
    });

    it('marks rooms taken by courses and by exams overlapping a period', () => {
        const day = {
            date: '2026-10-26', week: 9, weekday: 1,
            periods: { 1: [{ meeting_id: 'm', course_name: '高数', course_code: null, class_ids: [], teacher: null, location: null, space_family_id: '教4-306', floor_id: '教4/3', start_period: 1, end_period: 2 }],
                2: [{ meeting_id: 'm', course_name: '高数', course_code: null, class_ids: [], teacher: null, location: null, space_family_id: '教4-306', floor_id: '教4/3', start_period: 1, end_period: 2 }] },
            exams: [{ exam_id: 'e', stable_key: 'e', class_name: 'B1', course_name: '物理', course_code: '', teacher: '', count: 30, date: '2026-10-26', start_timestamp: '2026-10-26T09:00:00+08:00', end_timestamp: '2026-10-26T10:00:00+08:00', duration_minutes: 60, location: '', campus: '', space_family_id: '教4-308', floor_id: '教4/3' }],
        } as ClassroomDayFile;
        const status = dayStatus(day, periods);
        expect(isFree(status, '教4-306', 1)).toBe(false);
        expect(isFree(status, '教4-306', 3)).toBe(true);
        expect(isFree(status, '教4-308', 1)).toBe(true);
        expect(isFree(status, '教4-308', 2)).toBe(false);
        expect(isFree(status, '教4-308', 3)).toBe(false);
        expect(freeRun(status, '教4-310', 1, 3)).toBe(3);
        expect(isFree(dayStatus(null, periods), '教4-306', 1, 3)).toBe(true);

        // Checked free periods decide; a taken room without a booking is held by something else.
        const checked = dayStatus({ ...day, free: { 1: ['教4-308'], 2: ['教4-306'], 3: ['教4-306', '教4-310'] }, checked_at: '2026-10-25T06:00:00Z' }, periods);
        expect(checked.checkedAt).toBe('2026-10-25T06:00:00Z');
        expect(isFree(checked, '教4-310', 1)).toBe(false);
        expect(occupantsAt(checked, '教4-310', 1)).toBe('other');
        expect(isFree(checked, '教4-306', 2)).toBe(true);
        expect(occupantsAt(checked, '教4-306', 1)).toHaveLength(1);
        expect(freeRun(checked, '教4-306', 2, 3)).toBe(2);
    });

    it('matches rooms by number, id, building and alias', () => {
        const room: SpaceFamily = { space_family_id: '图科楼-409', building_id: '图科楼', floor_id: '图科楼/4', room_number: '409', aliases: ['图409'], kinds: [], availability_eligible: 'eligible' };
        for (const query of ['409', '图科楼-409', '图科楼', '图409', '图科楼409', '']) expect(roomMatches(room, query)).toBe(true);
        expect(roomMatches(room, '306')).toBe(false);
    });
});
