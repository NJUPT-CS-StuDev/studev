import { describe, expect, it } from 'vitest';
import type { RoomDay, Room } from '@/academics/facts';
import { clampToTerm, freeRun, isFree, nowInShanghai, occupantsAt, periodAt, roomMatches, weekOf } from './campusDay';
const periods = [{period: 1, start: '08:00', end: '08:45', part: '上午'}, {period: 2, start: '08:50', end: '09:35', part: '上午'}, {period: 3, start: '09:50', end: '10:35', part: '上午'}];
describe('campus day', () => {
    it('reads the time in Nanjing wherever the browser is', () => {
        expect(nowInShanghai(new Date('2026-10-25T10:51:00Z'))).toEqual({date: '2026-10-25', minutes: 18 * 60 + 51});
        expect(nowInShanghai(new Date('2026-10-25T17:30:00Z')).date).toBe('2026-10-26');
    });
    it('picks the running period, else next, else last', () => {
        expect([7*60, 8*60+10, 9*60+40, 22*60].map(time => periodAt(periods, time))).toEqual([1,1,3,3]);
    });
    it('places a date in the published weeks', () => {
        const weeks = [{week: 1, start: '2026-08-31', end: '2026-09-06'}, {week: 2, start: '2026-09-07', end: '2026-09-13'}];
        expect(clampToTerm(weeks, '2026-07-01')).toBe('2026-08-31');
        expect(clampToTerm(weeks, '2027-01-01')).toBe('2026-09-13');
        expect(weekOf(weeks, '2026-09-09')).toEqual({week: 2, weekday: 3});
    });
    it('reads course and exam occupants using their published period spans', () => {
        const day: RoomDay = {date: '2026-10-26', week: 9, weekday: 1, occupied: {
            '教4-306': [{kind: 'class', id: 'm', course: '高数', teachers: ['甲'], classes: ['B1'], periods: [1,2]}],
            '教4-308': [{kind: 'exam', id: 'e', course: '物理', teachers: ['乙'], classes: ['B1','B2'], periods: [2,3]}],
        }};
        expect(isFree(day, '教4-306', 1)).toBe(false);
        expect(isFree(day, '教4-306', 3)).toBe(true);
        expect(isFree(day, '教4-308', 1)).toBe(true);
        expect(isFree(day, '教4-308', 2)).toBe(false);
        expect(isFree(day, '教4-308', 3)).toBe(false);
        expect(occupantsAt(day, '教4-308', 2)).toEqual(day.occupied['教4-308']);
        expect(freeRun(day, '教4-310', 1, 3)).toBe(3);
        const checked: RoomDay = {...day, free: {1: ['教4-308'], 2: ['教4-306'], 3: ['教4-306','教4-310']}, observed_at: '2026-10-25T06:00:00Z'};
        expect(isFree(checked, '教4-310', 1)).toBe(false);
        expect(occupantsAt(checked, '教4-310', 1)).toBe('other');
        expect(occupantsAt(checked, '教4-306', 2)).toEqual([]);
        expect(occupantsAt(checked, '教4-306', 1)).toEqual(day.occupied['教4-306']);
        expect(freeRun(checked, '教4-306', 2, 3)).toBe(2);
    });
    it('matches rooms by their published id, number, building and names', () => {
        const room: Room = {id: '图科楼-409', building: '图科楼', floor: '4', number: '409', campus: '仙林', names: ['图409'], kinds: [], listed: true};
        for (const q of ['409','图科楼-409','图科楼','图409','图科楼409','']) expect(roomMatches(room,q)).toBe(true);
        expect(roomMatches(room, '306')).toBe(false);
    });
});
