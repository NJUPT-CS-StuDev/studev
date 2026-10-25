import type { TeachingPeriod, TeachingRoomBooking, TeachingWeek } from '@/academics/timetable';
import type { RoomBooking } from '@/academics/room';
import type { SpaceFamily, SpaceIndex } from '@/academics/space';
import type { ClassroomDayFile } from './ClassroomAvailabilityClient';

/** Today's date and the minute of the day in Nanjing, wherever the browser is. */
export const nowInShanghai = (now = new Date()): { date: string; minutes: number } => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
};

const clock = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** The period under way, else the next one to start; the last one late at night. */
export const periodAt = (periods: TeachingPeriod[], minutes: number): number => {
    const sorted = [...periods].sort((left, right) => left.period - right.period);
    const running = sorted.find(period => clock(period.start_time) <= minutes && minutes <= clock(period.end_time));
    const next = sorted.find(period => clock(period.start_time) > minutes);
    return (running ?? next ?? sorted[sorted.length - 1])?.period ?? 1;
};

export const addDays = (date: string, days: number): string => {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
};

export const termRange = (weeks: TeachingWeek[]): { first: string; last: string } => ({
    first: weeks[0]?.start_date ?? '',
    last: weeks[weeks.length - 1]?.end_date ?? '',
});

/** A date inside the term: the requested one, else today, else the nearest end of the term. */
export const clampToTerm = (weeks: TeachingWeek[], date: string): string => {
    const { first, last } = termRange(weeks);
    if (!first) return date;
    return date < first ? first : date > last ? last : date;
};

export const weekOf = (weeks: TeachingWeek[], date: string): { week: number; weekday: number } | null => {
    const week = weeks.find(item => date >= item.start_date && date <= item.end_date);
    if (!week) return null;
    const weekday = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${week.start_date}T00:00:00Z`)) / 86_400_000) + 1;
    return { week: week.week, weekday };
};

export type Occupant =
    | { kind: 'course'; booking: TeachingRoomBooking }
    | { kind: 'exam'; booking: RoomBooking };

/** For each room, what occupies it in each period of one day. */
export type DayOccupancy = Map<string, Map<number, Occupant[]>>;

export const occupancyOf = (day: ClassroomDayFile | null, periods: TeachingPeriod[]): DayOccupancy => {
    const result: DayOccupancy = new Map();
    const put = (room: string, period: number, occupant: Occupant) => {
        const byPeriod = result.get(room) ?? new Map<number, Occupant[]>();
        result.set(room, byPeriod);
        const list = byPeriod.get(period) ?? [];
        if (occupant.kind === 'course' && list.some(item => item.kind === 'course' && item.booking.meeting_id === occupant.booking.meeting_id)) return;
        byPeriod.set(period, [...list, occupant]);
    };
    if (!day) return result;
    for (const [period, bookings] of Object.entries(day.periods)) {
        for (const booking of bookings) put(booking.space_family_id, Number(period), { kind: 'course', booking });
    }
    for (const exam of day.exams) {
        // Exam times carry +08:00; compare the wall clock written in them.
        const start = clock(exam.start_timestamp.slice(11, 16));
        const end = clock(exam.end_timestamp.slice(11, 16));
        for (const period of periods) {
            if (clock(period.start_time) < end && clock(period.end_time) > start) put(exam.space_family_id, period.period, { kind: 'exam', booking: exam });
        }
    }
    return result;
};

export const isFree = (occupancy: DayOccupancy, room: string, from: number, to = from): boolean => {
    const byPeriod = occupancy.get(room);
    if (!byPeriod) return true;
    for (let period = from; period <= to; period++) if (byPeriod.get(period)?.length) return false;
    return true;
};

/** How many periods in a row the room stays free from `from` (0 when taken). */
export const freeRun = (occupancy: DayOccupancy, room: string, from: number, last: number): number => {
    let count = 0;
    for (let period = from; period <= last && isFree(occupancy, room, period); period++) count++;
    return count;
};

export interface BuildingView {
    id: string;
    floors: Array<{ level: string; rooms: SpaceFamily[] }>;
    rooms: SpaceFamily[];
}

const naturalCompare = (left: string, right: string) => left.localeCompare(right, 'zh-CN', { numeric: true });

/** The rooms of a campus that can be borrowed for study, building by building, top floor first. */
export const campusBuildings = (space: SpaceIndex, campus: string): BuildingView[] => space.buildings
    .filter(building => building.campus_id === campus)
    .sort((left, right) => naturalCompare(left.building_id, right.building_id))
    .map(building => {
        const rooms = space.families
            .filter(room => room.building_id === building.building_id && room.availability_eligible === 'eligible')
            .sort((left, right) => naturalCompare(left.room_number, right.room_number));
        const floors = space.floors
            .filter(floor => floor.building_id === building.building_id)
            .map(floor => ({ level: floor.level, rooms: rooms.filter(room => room.floor_id === floor.floor_id) }))
            .filter(floor => floor.rooms.length)
            .sort((left, right) => naturalCompare(right.level, left.level));
        return { id: building.building_id, floors, rooms };
    })
    .filter(building => building.rooms.length);

const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[－—–\s]/g, '');

/** Rooms whose id, number, building or alias contains the query ("306", "教4-3", "图409"). */
export const roomMatches = (room: SpaceFamily, query: string): boolean => {
    const needle = fold(query);
    if (!needle) return true;
    return [room.space_family_id, room.room_number, room.building_id, ...room.aliases].some(value => fold(value).includes(needle))
        || fold(`${room.building_id}${room.room_number}`).includes(needle);
};
