import type { TeachingPeriod, TeachingRoomBooking, TeachingRoomDay, TeachingWeek } from '@/academics/timetable';
import type { RoomBooking } from '@/academics/room';
import type { SpaceIndex } from '@/academics/space';
import { forwardAbort, waitForAbort } from '@/shared/lib/abort';
import { fetchJson } from '@/shared/lib/fetch';
import { listFamilies } from '@/space/model/SpaceClient';
import type { SpaceFamilyView } from '@/space/model/SpaceClient';

export interface ClassroomQuery {
    date?: string | null;
    week?: number | null;
    weekday?: number | null;
    period: number;
    campus?: string | null;
    building?: string | null;
    floor?: string | null;
    query?: string | null;
}

/** classrooms/index.json */
export interface ClassroomIndexFile {
    term: { academic_year: string; term_number: number };
    weeks: TeachingWeek[];
    periods: TeachingPeriod[];
    space: SpaceIndex;
}

/** classrooms/days/<date>.json */
export interface ClassroomDayFile extends TeachingRoomDay {
    date: string;
    week: number;
    weekday: number;
    exams: RoomBooking[];
}

export interface ClassroomIndex {
    manifest: { weeks: TeachingWeek[]; periods: TeachingPeriod[] };
    space: SpaceIndex;
}

export interface ClassroomAvailability {
    manifest: ClassroomIndex['manifest'];
    space: SpaceIndex;
    date: string;
    week: number;
    weekday: number;
    spatialFamilies: SpaceFamilyView[];
    candidates: SpaceFamilyView[];
    freeRooms: SpaceFamilyView[];
    occupied: Map<string, { teaching: TeachingRoomBooking[]; exams: RoomBooking[] }>;
}

export interface ClassroomRoomDaySchedule {
    date: string;
    week: number;
    weekday: number;
    teaching: TeachingRoomBooking[];
    exams: RoomBooking[];
}

export const collectRoomTeachingBookings = (day: TeachingRoomDay | null, spaceFamilyId: string): TeachingRoomBooking[] => {
    const unique = new Map<string, TeachingRoomBooking>();
    for (const bookings of Object.values(day?.periods ?? {})) {
        for (const booking of bookings) {
            if (booking.space_family_id === spaceFamilyId) unique.set(booking.meeting_id, booking);
        }
    }
    return [...unique.values()].sort((left, right) => (
        left.start_period - right.start_period
        || left.end_period - right.end_period
        || left.course_name.localeCompare(right.course_name, 'zh-CN')
    ));
};

const isoDate = (startDate: string, offsetDays: number): string => {
    const date = new Date(`${startDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return date.toISOString().slice(0, 10);
};

export const resolveClassroomMoment = (
    weeks: TeachingWeek[],
    query: Pick<ClassroomQuery, 'date' | 'week' | 'weekday'>,
): { date: string; week: number; weekday: number } => {
    const explicitDate = query.date?.trim() ?? '';
    if (explicitDate && !/^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) throw new Error('日期格式不正确');
    const week = explicitDate
        ? weeks.find(item => explicitDate >= item.start_date && explicitDate <= item.end_date)
        : weeks.find(item => item.week === query.week);
    if (!week) throw new Error(explicitDate ? `当前学期不包含 ${explicitDate}` : `没有第 ${query.week} 周的数据`);
    const date = explicitDate || isoDate(week.start_date, (query.weekday ?? 1) - 1);
    const offsetDays = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${week.start_date}T00:00:00Z`)) / 86_400_000);
    const weekday = explicitDate ? offsetDays + 1 : query.weekday ?? 1;
    if (weekday < 1 || weekday > 7) throw new Error(`${date} 不在第 ${week.week} 周内`);
    return { date, week: week.week, weekday };
};

/** Free and occupied rooms at a period: course bookings and exams from one file per date. */
export class ClassroomAvailabilityClient {
    readonly #baseUrl: string;
    #indexPromise: Promise<ClassroomIndex> | null = null;
    #activeQueryController: AbortController | null = null;
    #days = new Map<string, Promise<ClassroomDayFile | null>>();

    constructor(baseUrl: string) {
        this.#baseUrl = baseUrl.replace(/\/+$/, '');
    }

    initialize(signal?: AbortSignal): Promise<ClassroomIndex> {
        this.#indexPromise ??= fetchJson<ClassroomIndexFile>(`${this.#baseUrl}/index.json`)
            .then(file => ({ manifest: { weeks: file.weeks, periods: file.periods }, space: file.space }))
            .catch(error => {
                this.#indexPromise = null;
                throw error;
            });
        return waitForAbort(this.#indexPromise, signal);
    }

    #day(date: string, signal?: AbortSignal): Promise<ClassroomDayFile | null> {
        let day = this.#days.get(date);
        if (!day) {
            day = fetch(`${this.#baseUrl}/days/${date}.json`).then(response => {
                if (response.status === 404) return null;
                if (!response.ok) throw new Error(`教室占用请求失败: HTTP ${response.status}`);
                return response.json() as Promise<ClassroomDayFile>;
            });
            day.catch(() => this.#days.delete(date));
            this.#days.set(date, day);
        }
        return waitForAbort(day, signal);
    }

    async query(query: ClassroomQuery, signal?: AbortSignal): Promise<ClassroomAvailability> {
        this.#activeQueryController?.abort();
        const controller = new AbortController();
        this.#activeQueryController = controller;
        const detach = forwardAbort(signal, controller);
        try {
            const { manifest, space } = await this.initialize(controller.signal);
            const moment = resolveClassroomMoment(manifest.weeks, query);
            const day = await this.#day(moment.date, controller.signal);
            const spatialFamilies = listFamilies(space, query);
            const candidates = spatialFamilies.filter(item => item.family.availability_eligible === 'eligible');
            const candidateKeys = new Set(candidates.map(item => item.family.space_family_id));
            const occupied = new Map<string, { teaching: TeachingRoomBooking[]; exams: RoomBooking[] }>();
            const entry = (id: string) => {
                const current = occupied.get(id) ?? { teaching: [], exams: [] };
                occupied.set(id, current);
                return current;
            };
            for (const booking of day?.periods[String(query.period)] ?? []) {
                if (candidateKeys.has(booking.space_family_id)) entry(booking.space_family_id).teaching.push(booking);
            }
            const period = manifest.periods.find(item => item.period === query.period);
            if (!period) throw new Error(`没有第 ${query.period} 节的数据`);
            const start = `${moment.date}T${period.start_time}:00+08:00`;
            const end = `${moment.date}T${period.end_time}:00+08:00`;
            for (const booking of day?.exams ?? []) {
                if (candidateKeys.has(booking.space_family_id) && booking.start_timestamp < end && booking.end_timestamp > start) {
                    entry(booking.space_family_id).exams.push(booking);
                }
            }
            return {
                manifest,
                space,
                ...moment,
                spatialFamilies,
                candidates,
                freeRooms: candidates.filter(item => !occupied.has(item.family.space_family_id)),
                occupied,
            };
        } finally {
            detach();
            if (this.#activeQueryController === controller) this.#activeQueryController = null;
        }
    }

    async queryRoomDay(
        query: Pick<ClassroomQuery, 'date' | 'week' | 'weekday'>,
        spaceFamilyId: string,
        signal?: AbortSignal,
    ): Promise<ClassroomRoomDaySchedule> {
        const { manifest } = await this.initialize(signal);
        const moment = resolveClassroomMoment(manifest.weeks, query);
        const day = await this.#day(moment.date, signal);
        const exams = (day?.exams ?? [])
            .filter(item => item.space_family_id === spaceFamilyId)
            .sort((left, right) => left.start_timestamp.localeCompare(right.start_timestamp) || left.course_name.localeCompare(right.course_name, 'zh-CN'));
        return { ...moment, teaching: collectRoomTeachingBookings(day, spaceFamilyId), exams };
    }

    dispose(): void {
        this.#activeQueryController?.abort();
        this.#days.clear();
    }
}
