import type { TeachingPeriod, TeachingRoomDay, TeachingWeek } from '@/academics/timetable';
import type { RoomBooking } from '@/academics/room';
import type { SpaceIndex } from '@/academics/space';
import { waitForAbort } from '@/shared/lib/abort';
import { fetchJson } from '@/shared/lib/fetch';

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
    /** Rooms free in each period as last checked; absent when only the timetable is known. */
    free?: Record<string, string[]>;
    checked_at?: string;
}

/** The rooms of every campus and, one file per date, what occupies them. */
export class ClassroomAvailabilityClient {
    readonly #baseUrl: string;
    #indexPromise: Promise<ClassroomIndexFile> | null = null;
    #days = new Map<string, Promise<ClassroomDayFile | null>>();

    constructor(baseUrl: string) {
        this.#baseUrl = baseUrl.replace(/\/+$/, '');
    }

    initialize(signal?: AbortSignal): Promise<ClassroomIndexFile> {
        this.#indexPromise ??= fetchJson<ClassroomIndexFile>(`${this.#baseUrl}/index.json`).catch(error => {
            this.#indexPromise = null;
            throw error;
        });
        return waitForAbort(this.#indexPromise, signal);
    }

    /** Course and exam bookings of every room on one date; null when nothing is booked. */
    day(date: string, signal?: AbortSignal): Promise<ClassroomDayFile | null> {
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

    dispose(): void {
        this.#days.clear();
    }
}
