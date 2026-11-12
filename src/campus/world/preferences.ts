// A visitor's own settings, kept in this browser only: their class, their usual
// campus, and the changes they made to their class timetable. One record, so the
// account page and every campus tool read and write the same thing.
import { LAYER_ORDER, type EventKind } from './events';

export interface TimetableEdits {
    /** Teaching classes of the class timetable this person does not attend. */
    hidden: string[];
    /** Teaching classes added from course search (retakes, electives). */
    added: string[];
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
            const next = { hidden: ids(value.hidden), added: ids(value.added) };
            if (next.hidden.length || next.added.length) result.timetable[term] = next;
        }
        if (!Object.keys(result.timetable).length) delete result.timetable;
    }
    if (Array.isArray(record.examReminders)) result.examReminders = [...new Set(record.examReminders.filter((key): key is string => typeof key === 'string' && key.length < 10))];
    // Only a whole ordering of every kind is kept: a partial one would leave some kind nowhere.
    if (Array.isArray(record.layers) && record.layers.length === LAYER_ORDER.length && LAYER_ORDER.every(kind => (record.layers as unknown[]).includes(kind))) result.layers = record.layers as EventKind[];
    if (typeof record.examsSeen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.examsSeen)) result.examsSeen = record.examsSeen;
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
        return sanitize(JSON.parse(raw));
    } catch {
        return {};
    }
};

export const writePreferences = (update: (current: Preferences) => Preferences): Preferences => {
    const next = sanitize(update(readPreferences()));
    const store = storage();
    if (store) {
        try {
            store.setItem(KEY, JSON.stringify(next));
        } catch {
            // Full or blocked storage: the change lasts for this page only.
        }
    }
    window.dispatchEvent(new CustomEvent(EVENT));
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
