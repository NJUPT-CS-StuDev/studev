// A visitor's own settings, kept in this browser: their class, their usual campus,
// and the changes they made to their class timetable. One record, so the account
// page and every campus tool read and write the same thing. Signed in, its parts
// go with them to their other devices (sync.ts); each part notes when it changed.
import { LAYER_ORDER, type EventKind } from './events';
import type { CustomCourse } from '@/timetable/model/courses';
import type { EventPreferences } from './schedule';
import { initialModified, SECTIONS } from './merge.mjs';

/** A part of the settings that goes with one to one's other devices. */
export type Section = 'class' | 'campus' | 'timetable' | 'examAttendance' | 'examReminders' | 'labs' | 'layers' | 'events' | 'run';

export interface TimetableEdits {
    /** Teaching classes of the class timetable this person does not attend. */
    hidden: string[];
    /** Teaching classes added from course search (retakes, electives). */
    added: string[];
    /** Names of one's own for courses, by course identity. */
    names?: Record<string, string>;
    /** Courses of one's own. */
    custom?: CustomCourse[];
}

export interface Preferences {
    class?: string;
    campus?: string;
    /** Keyed by term, e.g. "2026-2027-1": edits never leak into the next term. */
    timetable?: Record<string, TimetableEdits>;
    /** Explicit attendance choices, scoped to exam term and class. */
    examAttendance?: Record<string, Record<string, boolean>>;
    /** 早锻炼: the count is copied by hand from the school's mini program. */
    run?: RunSettings;
    /** The latest exam change this person has been shown. */
    examsSeen?: string;
    /** When exams in a downloaded calendar remind; absent means the default. */
    examReminders?: string[];
    /** Which kind shows in front when things overlap, front first; absent means the default. */
    layers?: EventKind[];
    /** Lab sheets left out, lab courses not taken and single sittings missed. */
    labs?: { off?: string[]; drop?: string[]; skip?: string[]; classes?: string[] };
    events?: EventPreferences;
    /** When each part last changed here or on another device, so that the later change wins when they meet. */
    modified?: Partial<Record<Section, string>>;
}

/** The mornings put down in this browser, plus the bonus or penalty entered from the sports office. */
export interface RunSettings { on?: boolean; days: string[]; adjust: number }

const KEY = 'studev_prefs';
const EVENT = 'studev:preferences';

const storage = (): Storage | null => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

const isClassName = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]\d{6}(\([A-Z]{2}\))?$/.test(value);
const ids = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length < 120))] : [];

const sanitize = (raw: unknown): Preferences => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const record = raw as Record<string, unknown>;
    const result: Preferences = {};
    if (isClassName(record.class)) result.class = record.class;
    if (typeof record.campus === 'string' && record.campus.length < 20) result.campus = record.campus;
    if (record.timetable && typeof record.timetable === 'object' && !Array.isArray(record.timetable)) {
        result.timetable = {};
        for (const [term, edits] of Object.entries(record.timetable as Record<string, unknown>)) {
            if (!/^\d{4}-\d{4}-\d$/.test(term) || !edits || typeof edits !== 'object') continue;
            const value = edits as Record<string, unknown>;
            const next: TimetableEdits = { hidden: ids(value.hidden), added: ids(value.added) };
            if (value.names && typeof value.names === 'object' && !Array.isArray(value.names)) {
                const names = Object.fromEntries(Object.entries(value.names as Record<string, unknown>).filter((entry): entry is [string, string] => entry[0].length < 200 && typeof entry[1] === 'string' && entry[1].trim().length > 0).map(([key, name]) => [key, name.trim().slice(0, 60)]));
                if (Object.keys(names).length) next.names = names;
            }
            if (Array.isArray(value.custom)) {
                const custom = value.custom.flatMap((raw): CustomCourse[] => {
                    if (!raw || typeof raw !== 'object') return [];
                    const item = raw as Record<string, unknown>;
                    const days = Array.isArray(item.days) ? [...new Set(item.days.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7))].sort() : [];
                    const periods = Array.isArray(item.periods) && item.periods.length === 2 && item.periods.every(period => Number.isInteger(period) && period >= 1 && period <= 14) && item.periods[0] <= item.periods[1] ? item.periods as [number, number] : null;
                    const weeks = Array.isArray(item.weeks) ? [...new Set(item.weeks.filter((week): week is number => Number.isInteger(week) && week >= 1 && week <= 30))].sort((a, b) => a - b) : [];
                    if (typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim() || !days.length || !periods || !weeks.length) return [];
                    return [{ id: item.id.slice(0, 60), name: item.name.trim().slice(0, 60), days, periods, weeks,
                        ...(typeof item.room === 'string' && item.room.trim() ? { room: item.room.trim().slice(0, 60) } : {}),
                        ...(typeof item.teacher === 'string' && item.teacher.trim() ? { teacher: item.teacher.trim().slice(0, 40) } : {}) }];
                });
                if (custom.length) next.custom = custom;
            }
            if (next.hidden.length || next.added.length || next.names || next.custom) result.timetable[term] = next;
        }
        if (!Object.keys(result.timetable).length) delete result.timetable;
    }
    if (Array.isArray(record.examReminders)) result.examReminders = [...new Set(record.examReminders.filter((key): key is string => typeof key === 'string' && key.length < 10))];
    // Only a whole ordering of every kind is kept: a partial one would leave some kind nowhere.
    if (Array.isArray(record.layers) && record.layers.length === LAYER_ORDER.length && LAYER_ORDER.every(kind => (record.layers as unknown[]).includes(kind))) result.layers = record.layers as EventKind[];
    if (record.labs && typeof record.labs === 'object' && !Array.isArray(record.labs)) {
        const labs = record.labs as Record<string, unknown>;
        const kept = Object.fromEntries((['off', 'drop', 'skip', 'classes'] as const).map(key => [key, ids(labs[key])] as const).filter(([, value]) => value.length > 0));
        if (Object.keys(kept).length) result.labs = kept;
    }
    if (typeof record.examsSeen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.examsSeen)) result.examsSeen = record.examsSeen;
    if (record.events && typeof record.events === 'object' && !Array.isArray(record.events)) {
        const events: EventPreferences = {};
        for (const [key, raw] of Object.entries(record.events)) {
            if (key.length > 300 || !raw || typeof raw !== 'object') continue;
            const value = raw as Record<string, unknown>, next: EventPreferences[string] = {};
            if (value.avoid === 'must' || value.avoid === 'prefer' || value.avoid === 'allow') next.avoid = value.avoid;
            if (typeof value.layer === 'number' && Number.isSafeInteger(value.layer) && Math.abs(value.layer) < 1e15) next.layer = value.layer;
            if (Object.keys(next).length) events[key] = next;
        }
        if (Object.keys(events).length) result.events = events;
    }
    if (record.examAttendance && typeof record.examAttendance === 'object' && !Array.isArray(record.examAttendance)) {
        const attendance: NonNullable<Preferences['examAttendance']> = {};
        for (const [scope, rawChoices] of Object.entries(record.examAttendance)) {
            if (!/^\d{4}-\d{4}-\d:[A-Z]\d{6}(\([A-Z]{2}\))?$/.test(scope) || !rawChoices || typeof rawChoices !== 'object' || Array.isArray(rawChoices)) continue;
            const choices: Record<string, boolean> = {};
            for (const [id, value] of Object.entries(rawChoices)) if (id.length > 0 && id.length < 200 && typeof value === 'boolean') choices[id] = value;
            attendance[scope] = choices;
        }
        if (Object.keys(attendance).length) result.examAttendance = attendance;
    }
    if (record.modified && typeof record.modified === 'object' && !Array.isArray(record.modified)) {
        const modified = Object.fromEntries(Object.entries(record.modified as Record<string, unknown>).filter((entry): entry is [Section, string] => (SECTIONS as string[]).includes(entry[0]) && typeof entry[1] === 'string' && entry[1].length < 40));
        if (Object.keys(modified).length) result.modified = modified;
    }
    if (record.run && typeof record.run === 'object' && !Array.isArray(record.run)) {
        const run = record.run as Record<string, unknown>;
        const listed = Array.isArray(run.days) ? run.days : [];
        const days = [...new Set(listed.filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
        result.run = { days, adjust: Math.max(-200, Math.min(200, Math.trunc(Number(run.adjust)) || 0)) };
        if (typeof run.on === 'boolean') result.run.on = run.on;
    }
    return result;
};

export const readPreferences = (): Preferences => {
    const store = storage();
    if (!store) return {};
    const raw = store.getItem(KEY);
    if (raw === null) return {};
    try {
        const prefs = sanitize(JSON.parse(raw));
        const modified = initialModified(prefs);
        if (Object.keys(modified).length && JSON.stringify(modified) !== JSON.stringify(prefs.modified)) {
            prefs.modified = modified;
            try { store.setItem(KEY, JSON.stringify(prefs)); } catch { /* Readable even when storage is full. */ }
        }
        return prefs;
    } catch {
        return {};
    }
};

/**
 * Settings changed here: each part that changed notes now as when. `adopt` writes parts taken from another device as
 * they came, their own times kept, so that taking them is not a change made here.
 */
export const writePreferences = (update: (current: Preferences) => Preferences, adopt = false): Preferences => {
    const before = readPreferences();
    const next = sanitize(update(before));
    if (!adopt) {
        const now = new Date().toISOString();
        for (const section of SECTIONS as Section[]) if (JSON.stringify(before[section] ?? null) !== JSON.stringify(next[section] ?? null)) next.modified = { ...next.modified, [section]: now };
    }
    const store = storage();
    if (store) {
        try {
            store.setItem(KEY, JSON.stringify(next));
        } catch {
            // Full or blocked storage: the change lasts for this page only.
        }
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { adopt } }));
    return next;
};

export const subscribePreferences = (listener: () => void): (() => void) => {
    const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
    window.addEventListener(EVENT, listener);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(EVENT, listener);
        window.removeEventListener('storage', onStorage);
    };
};

export const timetableEdits = (prefs: Preferences, term: string): TimetableEdits =>
    prefs.timetable?.[term] ?? { hidden: [], added: [] };

export const updateTimetableEdits = (term: string, change: (edits: TimetableEdits) => TimetableEdits): Preferences =>
    writePreferences(current => ({
        ...current,
        timetable: { ...current.timetable, [term]: change(timetableEdits(current, term)) },
    }));

export const examAttendanceScope = (term: string, className: string): string => `${term}:${className.toUpperCase()}`;

export const updateExamAttendance = (term: string, className: string, choices: Record<string, boolean>): Preferences =>
    writePreferences(current => {
        const scope = examAttendanceScope(term, className);
        return { ...current, examAttendance: { ...current.examAttendance, [scope]: { ...current.examAttendance?.[scope], ...choices } } };
    });

export const updateRun = (patch: Partial<RunSettings>) => writePreferences(current => ({ ...current, run: { days: [], adjust: 0, ...current.run, ...patch } }));
