import { describe, expect, it } from 'vitest';
import { campusTime, distance, momentAt, openingStatus, recommendations } from './homePolicy';
import type { Place } from './space';

const time = (hour: number, minute = 0, day = 5) => ({ hour, minute, day });
const hours = (start: string, end: string): NonNullable<Place['hours']> => ({ week: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), [[start, end]]])) });
const place = (id: string, category: string, schedule?: Place['hours'], featured = true): Place => ({ id, kind: 'building', parent: 'campus', names: [id], centre: [118.926, 32.114], sources: ['fixture'], use: '测试用途', routing: { type: 'target', id }, category, hours: schedule, featured });

describe('Android HomeRecommendations parity', () => {
    it('opening boundaries, closing threshold and unknown hours', () => {
        const schedule = hours('08:00', '22:00');
        for (const [h, m, state] of [[7, 59, 'closed'], [8, 0, 'open'], [21, 29, 'open'], [21, 30, 'closing'], [22, 0, 'closed']] as const) expect(openingStatus(schedule, time(h, m)).state).toBe(state);
        expect(openingStatus(undefined, time(12))).toEqual({ state: 'unknown', today: '' });
    });
    it('overnight Sunday, breaks, continuous windows and 24 hours', () => {
        const sunday = { week: { '7': [['22:00', '02:00'] as [string, string]] } };
        expect(openingStatus(sunday, time(1, 50, 1)).state).toBe('closing');
        expect(openingStatus(sunday, time(2, 0, 1)).state).toBe('closed');
        expect(openingStatus({ week: { '5': [['08:00', '12:00'], ['13:30', '17:00']] } }, time(12, 30)).state).toBe('closed');
        expect(openingStatus(hours('00:00', '24:00'), time(23, 59)).state).toBe('open');
        expect(openingStatus({ week: { '5': [['08:00', '12:00'], ['12:00', '17:00']] } }, time(11, 55))).toMatchObject({ state: 'open', closesAt: '17:00' });
    });
    it('changes candidates by time, never recommends closed food, category includes closed', () => {
        const items = [place('class', '教学楼'), place('library', '图书馆', hours('08:00', '22:00')), place('canteen', '食堂', hours('07:00', '21:00')), place('closed', '食堂', hours('17:00', '21:00')), place('dorm', '宿舍'), place('store', '超市', hours('00:00', '24:00')), place('unfeatured', '教学楼', undefined, false)];
        expect(recommendations(items, time(7))[0]!.place.id).toBe('class');
        expect(recommendations(items, time(12))[0]!.place.id).toBe('canteen');
        expect(recommendations(items, time(12)).some(p => p.place.id === 'closed')).toBe(false);
        expect(recommendations(items, time(20))[0]!.place.id).toBe('library');
        expect(new Set(recommendations(items, time(23)).map(p => p.place.id))).toEqual(new Set(['dorm', 'store']));
        expect(recommendations(items, time(12), null, '食堂')).toHaveLength(2);
    });
    it('uses position or explicit centre and caps each featured category at three', () => {
        const p = place('near', '教学楼');
        expect(recommendations([p], time(8), p.centre)[0]!.distance).toBeCloseTo(0);
        expect(recommendations([p], time(8))[0]!.distance).toBeGreaterThan(0);
        expect(distance([0, 0], [0, 0])).toBe(0);
        expect(recommendations(['d', 'c', 'b', 'a'].map(id => place(id, '教学楼')), time(8)).map(i => i.place.id)).toEqual(['a', 'b', 'c']);
    });
    it('uses campus timezone and tests moment boundaries', () => {
        expect(campusTime(new Date('2026-10-30T23:40:00Z'))).toEqual(time(7, 40, 6));
        expect([4, 5, 10, 11, 13, 14, 16, 17, 18, 19, 21, 22].map(h => momentAt(h).categories[0])).toEqual(['宿舍', '教学楼', '教学楼', '食堂', '食堂', '教学楼', '教学楼', '食堂', '食堂', '图书馆', '图书馆', '宿舍']);
    });
});
