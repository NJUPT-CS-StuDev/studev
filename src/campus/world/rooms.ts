// A room at a moment: free or not, and for how long.
import type { Room, RoomDay, RoomOccupant, TeachingPeriod } from '@/world/facts';
import { minutesOf } from './time';
import { campusConfig } from '../../../campus.config';

export type RoomTier = 'long' | 'mid' | 'short' | 'busy' | 'other';
export interface RoomState {
    tier: RoomTier; busy: boolean; until: number; minutes: number;
    occupants: (RoomOccupant & { start: number; end: number })[];
    current: (RoomOccupant & { start: number; end: number }) | null;
}
export const isClassroom = (room: Room) => Boolean(room.listed) && room.kinds.some(kind => campusConfig.classrooms.eligibleKinds.some(word => kind.includes(word)));

export const makeRoomReader = (periods: TeachingPeriod[]) => {
    const sorted = [...periods].sort((left, right) => left.period - right.period);
    const clock = new Map(sorted.map(period => [period.period, { start: minutesOf(period.start), end: minutesOf(period.end) }]));
    const dayEnd = Math.max(...[...clock.values()].map(period => period.end));
    const freeIn = (day: RoomDay, id: string, period: number) => day.free
        ? day.free[String(period)]?.includes(id) ?? false
        : !(day.occupied[id] ?? []).some(occupant => occupant.periods[0] <= period && period <= occupant.periods[1]);
    return (day: RoomDay | null, id: string, min: number): RoomState => {
        const occupants = (day?.occupied[id] ?? []).map(occupant => ({ ...occupant, start: clock.get(occupant.periods[0])!.start, end: clock.get(occupant.periods[1])!.end })).sort((left, right) => left.start - right.start);
        if (!day) return { tier: 'other', busy: false, until: min, minutes: 0, occupants, current: null };
        const current = occupants.find(occupant => occupant.start <= min && min < occupant.end) ?? null;
        const running = sorted.find(period => clock.get(period.period)!.start <= min && min < clock.get(period.period)!.end);
        if (current || (running && !freeIn(day, id, running.period))) {
            let until = current?.end ?? clock.get(running!.period)!.end;
            for (const period of sorted) {
                const span = clock.get(period.period)!;
                if (span.start >= until && span.start - until <= 25 && !freeIn(day, id, period.period)) until = span.end;
            }
            return { tier: 'busy', busy: true, until, minutes: 0, occupants, current };
        }
        if (min >= dayEnd) return { tier: 'short', busy: false, until: dayEnd, minutes: 0, occupants, current: null };
        const next = sorted.find(period => clock.get(period.period)!.start >= min && !freeIn(day, id, period.period));
        const until = next ? clock.get(next.period)!.start : dayEnd;
        const minutes = until - min;
        return { tier: minutes >= 180 ? 'long' : minutes >= 60 ? 'mid' : 'short', busy: false, until, minutes, occupants, current: null };
    };
};

/** A building as said, as the room data writes it: 教三楼 → 教3. */
export const buildingWord = (said: string) => said.trim().replace(/[一二三四五六七八九]/g, digit => String('一二三四五六七八九'.indexOf(digit) + 1)).replace(/(?<=.)楼$/, '');
