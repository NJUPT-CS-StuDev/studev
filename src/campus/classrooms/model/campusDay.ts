import { PRODUCT_CONFIG } from '@/app/config/product';
import type { TeachingPeriod, TeachingWeek, Room, RoomDay, RoomOccupant } from '@/academics/facts';
import type { ClassroomIndexFile } from './ClassroomAvailabilityClient';
import { campusConfig } from '../../../../campus.config';

/** Today's date and the minute of the day in Nanjing, wherever the browser is. */
export const nowInShanghai = (now = new Date()): { date: string; minutes: number } => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: PRODUCT_CONFIG.TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
};

const clock = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** The period under way, else the next one to start; the last one late at night. */
export const periodAt = (periods: TeachingPeriod[], minutes: number): number => {
    const sorted = [...periods].sort((left, right) => left.period - right.period);
    const running = sorted.find(period => clock(period.start) <= minutes && minutes <= clock(period.end));
    const next = sorted.find(period => clock(period.start) > minutes);
    return (running ?? next ?? sorted[sorted.length - 1])?.period ?? 1;
};

export const addDays = (date: string, days: number): string => {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
};

export const termRange = (weeks: TeachingWeek[]): { first: string; last: string } => ({
    first: weeks[0]?.start ?? '',
    last: weeks[weeks.length - 1]?.end ?? '',
});

/** A date inside the term: the requested one, else today, else the nearest end of the term. */
export const clampToTerm = (weeks: TeachingWeek[], date: string): string => {
    const { first, last } = termRange(weeks);
    if (!first) return date;
    return date < first ? first : date > last ? last : date;
};

export const weekOf = (weeks: TeachingWeek[], date: string): { week: number; weekday: number } | null => {
    const week = weeks.find(item => date >= item.start && date <= item.end);
    if (!week) return null;
    const weekday = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${week.start}T00:00:00Z`)) / 86_400_000) + 1;
    return { week: week.week, weekday };
};

// The published occupancy already has the periods for both classes and exams.
export type Occupant = RoomOccupant;
export type DayStatus = RoomDay;
const freeAt = (day: RoomDay, room: string, period: number): boolean => day.free
    ? day.free[String(period)]?.includes(room) ?? false
    : !(day.occupied[room] ?? []).some(o => o.periods[0] <= period && o.periods[1] >= period);
export const isFree = (day: RoomDay, room: string, from: number, to = from): boolean => {
    for (let p = from; p <= to; p++) if (!freeAt(day, room, p)) return false;
    return true;
};
export const freeRun = (day: RoomDay, room: string, from: number, last: number): number => {
    let count = 0;
    for (let p = from; p <= last && isFree(day, room, p); p++) count++;
    return count;
};
export const occupantsAt = (day: RoomDay, room: string, period: number): RoomOccupant[] | 'other' => {
    if (freeAt(day, room, period)) return [];
    const occupants = (day.occupied[room] ?? []).filter(o => o.periods[0] <= period && o.periods[1] >= period);
    return occupants.length ? occupants : 'other';
};

export interface BuildingView {
    id: string;
    floors: Array<{ level: string; rooms: Room[] }>;
    rooms: Room[];
}

const naturalCompare = (left: string, right: string) => left.localeCompare(right, 'zh-CN', { numeric: true });
const buildingRank = (name: string) => /其他场地$/.test(name) ? 2 : /^教/.test(name) ? 0 : 1;

/**
 * The rooms of a campus building by building, top floor first: classrooms, or
 * with everything every place (labs, studios, sports grounds…). Rooms without a
 * known floor come last.
 */
export const campusBuildings = (space: ClassroomIndexFile, campus: string, everything = false): BuildingView[] => space.buildings
    .filter(building => building.campus === campus)
    // Teaching buildings first, then the rest, the campus's unplaced rooms last.
    .sort((left, right) => buildingRank(left.id) - buildingRank(right.id) || naturalCompare(left.id, right.id))
    .map(building => {
        const rooms = space.rooms
            .filter(room => room.building === building.id && room.listed && (everything || room.kinds.some(kind => campusConfig.classrooms.eligibleKinds.some(word => kind.includes(word)))))
            .sort((left, right) => naturalCompare(left.number, right.number));
        const floors = building.floors
            .map(level => ({ level, rooms: rooms.filter(room => room.floor === level) }))
            .filter(floor => floor.rooms.length)
            .sort((left, right) => (left.level ? 0 : 1) - (right.level ? 0 : 1) || naturalCompare(right.level, left.level));
        return { id: building.id, floors, rooms };
    })
    .filter(building => building.rooms.length);

const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[－—–\s]/g, '');

/** Rooms whose id, number, building or alias contains the query ("306", "教4-3", "图409"). */
export const roomMatches = (room: Room, query: string): boolean => {
    const needle = fold(query);
    if (!needle) return true;
    return [room.id, room.number, room.building, ...room.names].some(value => fold(value).includes(needle))
        || fold(`${room.building}${room.number}`).includes(needle);
};
