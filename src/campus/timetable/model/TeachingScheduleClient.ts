import type {
    TeachingClass,
    TeachingClassIndexEntry,
    TeachingMeeting,
    TeachingPeriods,
    TeachingTerm,
    TimetableClassFile,
    TimetableIndexFile,
} from '@/academics/timetable';
import { forwardAbort, waitForAbort } from '@/shared/lib/abort';
import { fetchJson } from '@/shared/lib/fetch';

export interface LoadedTeachingIndex {
    manifest: { observed_at: string };
    term: TeachingTerm;
    periods: TeachingPeriods;
    index: { classes: TeachingClassIndexEntry[] };
}

export interface LoadedClassSchedule extends LoadedTeachingIndex {
    classInfo: TeachingClass;
    meetings: TeachingMeeting[];
}

const normalized = (value: string): string => value.trim().toUpperCase();

export class TeachingScheduleClient {
    readonly #baseUrl: string;
    #indexPromise: Promise<LoadedTeachingIndex> | null = null;
    #activeClassController: AbortController | null = null;
    #classCache = new Map<string, LoadedClassSchedule>();

    constructor(baseUrl: string) {
        this.#baseUrl = baseUrl.replace(/\/+$/, '');
    }

    initialize(signal?: AbortSignal): Promise<LoadedTeachingIndex> {
        this.#indexPromise ??= fetchJson<TimetableIndexFile>(`${this.#baseUrl}/index.json`)
            .then(file => ({
                manifest: { observed_at: file.observed_at },
                term: file.term,
                periods: { periods: file.periods },
                index: { classes: file.classes },
            }))
            .catch(error => {
                this.#indexPromise = null;
                throw error;
            });
        return waitForAbort(this.#indexPromise, signal);
    }

    async suggest(query: string, signal?: AbortSignal): Promise<string[]> {
        const loaded = await this.initialize(signal);
        const needle = normalized(query);
        if (!needle) return [];
        return loaded.index.classes
            .filter(entry => normalized(entry.class_name).includes(needle) || normalized(entry.class_id).includes(needle))
            .slice(0, 20)
            .map(entry => entry.class_name);
    }

    async loadClass(className: string, signal?: AbortSignal): Promise<LoadedClassSchedule> {
        this.#activeClassController?.abort();
        const controller = new AbortController();
        this.#activeClassController = controller;
        const detach = forwardAbort(signal, controller);
        try {
            const loaded = await this.initialize(controller.signal);
            const target = normalized(className);
            const entry = loaded.index.classes.find(item => normalized(item.class_name) === target || normalized(item.class_id) === target);
            if (!entry) throw new Error(`没有找到班级 ${className}`);
            const cached = this.#classCache.get(entry.class_id);
            if (cached) return cached;
            const file = await fetchJson<TimetableClassFile>(
                `${this.#baseUrl}/classes/${encodeURIComponent(entry.class_id)}.json`,
                { signal: controller.signal },
            );
            const result = { ...loaded, classInfo: file.class, meetings: file.meetings };
            this.#classCache.set(entry.class_id, result);
            return result;
        } finally {
            detach();
            if (this.#activeClassController === controller) this.#activeClassController = null;
        }
    }

    dispose(): void {
        this.#activeClassController?.abort();
        this.#classCache.clear();
    }
}
