import type { CoursePlanFile, TeachingClass, TeachingClassEntityFile, TeachingMeeting, TeachingPeriod, TeachingTerm, TimetableClassFile } from '@/academics/timetable';
import { forwardAbort, waitForAbort } from '@/shared/lib/abort';
import { fetchJson } from '@/shared/lib/fetch';
import { groupCatalog, type CatalogCourse } from './courseCatalog';

export interface LoadedTeachingIndex { term: TeachingTerm; periods: TeachingPeriod[]; classes: TeachingClass[]; coursePlans: CoursePlanFile['items']; teachingClasses: TeachingClassEntityFile['items'] }
export interface LoadedClassSchedule extends LoadedTeachingIndex { classInfo: TeachingClass; meetings: TeachingMeeting[] }
const normalized = (value: string) => value.trim().toUpperCase();
const enrichMeeting = (meeting: TeachingMeeting, entities: Map<string, TeachingClassEntityFile['items'][number]>): TeachingMeeting => {
    const entity = entities.get(meeting.teaching_class.id);
    return entity ? { ...meeting, teaching_class: { ...meeting.teaching_class, name: entity.names[0] ?? null, size: entity.size, enrolled: entity.enrolled, capacity: entity.capacity } } : meeting;
};

export class TeachingScheduleClient {
    readonly #baseUrl: string;
    #indexPromise: Promise<LoadedTeachingIndex> | null = null;
    #activeClassController: AbortController | null = null;
    #classCache = new Map<string, LoadedClassSchedule>();
    #catalogPromise: Promise<CatalogCourse[]> | null = null;
    readonly #coursePlansUrl: string;
    readonly #teachingClassesUrl: string;
    constructor(baseUrl: string, coursePlansUrl: string, teachingClassesUrl: string) { this.#baseUrl = baseUrl.replace(/\/+$/, ''); this.#coursePlansUrl = coursePlansUrl; this.#teachingClassesUrl = teachingClassesUrl; }
    initialize(signal?: AbortSignal): Promise<LoadedTeachingIndex> {
        this.#indexPromise ??= Promise.all([
            fetchJson<TeachingTerm>(this.#baseUrl + '/term.json'),
            fetchJson<TeachingPeriod[]>(this.#baseUrl + '/periods.json'),
            fetchJson<TeachingClass[]>(this.#baseUrl + '/classes.json'),
            fetchJson<CoursePlanFile>(this.#coursePlansUrl),
            fetchJson<TeachingClassEntityFile>(this.#teachingClassesUrl),
        ]).then(([term, periods, classes, plans, teachingClasses]) => ({ term, periods, classes, coursePlans: plans.items, teachingClasses: teachingClasses.items.filter(item => item.subtype === 'agent:teaching-class') })).catch(error => {
            this.#indexPromise = null; throw error;
        });
        return waitForAbort(this.#indexPromise, signal);
    }
    async suggest(query: string, signal?: AbortSignal): Promise<string[]> {
        const loaded = await this.initialize(signal);
        const needle = normalized(query);
        if (!needle) return [];
        return loaded.classes.filter(c => normalized(c.name).includes(needle) || normalized(c.id).includes(needle)).slice(0, 20).map(c => c.name);
    }
    async loadClass(className: string, signal?: AbortSignal): Promise<LoadedClassSchedule> {
        this.#activeClassController?.abort();
        const controller = new AbortController(); this.#activeClassController = controller;
        const detach = forwardAbort(signal, controller);
        try {
            const loaded = await this.initialize(controller.signal);
            const target = normalized(className);
            const entry = loaded.classes.find(c => normalized(c.name) === target || normalized(c.id) === target);
            if (!entry) throw new Error('没有找到班级 ' + className);
            const cached = this.#classCache.get(entry.id);
            if (cached) return cached;
            const file = await fetchJson<TimetableClassFile>(this.#baseUrl + '/classes/' + encodeURIComponent(entry.id) + '.json', {signal: controller.signal});
            const entities = new Map(loaded.teachingClasses.map(item => [item.id, item]));
            const meetings = file.meetings.map(meeting => enrichMeeting(meeting, entities));
            const result = { ...loaded, classInfo: file.class, meetings };
            this.#classCache.set(entry.id, result); return result;
        } finally { detach(); if(this.#activeClassController === controller) this.#activeClassController = null; }
    }
    /** Every fact meeting, including electives and retakes outside a class schedule. */
    loadCatalog(signal?: AbortSignal): Promise<CatalogCourse[]> {
        this.#catalogPromise ??= Promise.all([this.initialize(signal), fetchJson<TeachingMeeting[]>(this.#baseUrl + '/meetings.json')]).then(([loaded, meetings]) => {
            const entities = new Map(loaded.teachingClasses.map(item => [item.id, item]));
            return groupCatalog(meetings.map(meeting => enrichMeeting(meeting, entities)), loaded.coursePlans);
        }).catch(error => {
            this.#catalogPromise = null; throw error;
        });
        return waitForAbort(this.#catalogPromise, signal);
    }
    dispose(): void { this.#activeClassController?.abort(); this.#classCache.clear(); }
}
