import type { TeachingPeriod, TeachingWeek, Room, Building, Campus, RoomDay } from '@/academics/facts';
import { waitForAbort } from '@/shared/lib/abort';
import { fetchJson } from '@/shared/lib/fetch';
/** rooms/index.json */
export interface ClassroomIndexFile {
    term: string; weeks: TeachingWeek[]; periods: TeachingPeriod[];
    rooms: Room[]; buildings: Building[]; campuses: Campus[];
}
export type ClassroomDayFile = RoomDay;
export class ClassroomAvailabilityClient {
    readonly #baseUrl: string;
    #indexPromise: Promise<ClassroomIndexFile> | null = null;
    #days = new Map<string, Promise<RoomDay | null>>();
    constructor(baseUrl: string) { this.#baseUrl = baseUrl.replace(/\/+$/, ''); }
    initialize(signal?: AbortSignal): Promise<ClassroomIndexFile> {
        this.#indexPromise ??= fetchJson<ClassroomIndexFile>(this.#baseUrl + '/index.json').catch(error => {
            this.#indexPromise = null; throw error;
        });
        return waitForAbort(this.#indexPromise, signal);
    }
    day(date: string, signal?: AbortSignal): Promise<RoomDay | null> {
        let day = this.#days.get(date);
        if (!day) {
            day = this.initialize().then(index => fetch(this.#baseUrl + '/' + index.term + '/' + date + '.json')).then(response => {
                if (response.status === 404) return null;
                if (!response.ok) throw new Error('教室占用请求失败: HTTP ' + response.status);
                return response.json() as Promise<RoomDay>;
            });
            day.catch(() => this.#days.delete(date)); this.#days.set(date, day);
        }
        return waitForAbort(day, signal);
    }
    dispose(): void { this.#days.clear(); }
}
