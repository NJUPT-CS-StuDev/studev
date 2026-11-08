import { describe, expect, it } from 'vitest';
import type { TeachingMeeting } from '@/world/facts';
import { alternatingWeekLabel, formatWeekNumbers, offThisWeek } from './weekPattern';
const value = (weekNumbers: number[]) => ({ weeks: weekNumbers } as TeachingMeeting);
describe('teaching week patterns', () => {
    it('keeps a lesson greyed in place on the weeks it skips within its run, and nowhere outside it', () => {
        const even = value([2, 4, 6, 8, 10, 12, 14, 16, 18]);
        expect(alternatingWeekLabel(even)).toBe('双周');
        expect(offThisWeek(even, 3)).toBe(true);
        expect(offThisWeek(even, 2)).toBe(false);
        expect(offThisWeek(even, 1)).toBe(false);
        expect(offThisWeek(even, 19)).toBe(false);
        expect(formatWeekNumbers(even.weeks)).toBe('第2–18周（双周）');
        expect(offThisWeek(value([1, 2, 3, 5, 6]), 4)).toBe(true);
    });
    it('shows nothing before or after an ordinary run of weeks', () => {
        const ordinary = value([3, 4, 5, 6]);
        expect(alternatingWeekLabel(ordinary)).toBeNull();
        expect(offThisWeek(ordinary, 2)).toBe(false);
        expect(offThisWeek(ordinary, 7)).toBe(false);
        expect(formatWeekNumbers(ordinary.weeks)).toBe('第3–6周');
    });
});
