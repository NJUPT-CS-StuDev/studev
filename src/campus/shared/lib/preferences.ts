// A visitor's own settings, kept in this browser only: their class, their usual
// campus, and the changes they made to their class timetable. One record, so the
// account page and every campus tool read and write the same thing.

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
}

const KEY = 'studev_prefs';
const EVENT = 'studev:preferences';
const LEGACY_CLASS_KEYS = ['SAVED_TIMETABLE_CLASS', 'SAVED_CLASS'];
const LEGACY_CLASSROOM_KEY = 'SAVED_CLASSROOM_QUERY';

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
    return result;
};

/** Settings saved before there was one record move into it once. */
const migrate = (store: Storage): Preferences => {
    const prefs: Preferences = {};
    for (const key of LEGACY_CLASS_KEYS) {
        const value = store.getItem(key)?.trim().toUpperCase();
        if (!prefs.class && isClassName(value)) prefs.class = value;
    }
    try {
        const campus = (JSON.parse(store.getItem(LEGACY_CLASSROOM_KEY) ?? 'null') as { campus?: unknown } | null)?.campus;
        if (typeof campus === 'string') prefs.campus = campus;
    } catch {
        // An unreadable old value is simply dropped.
    }
    for (const key of [...LEGACY_CLASS_KEYS, LEGACY_CLASSROOM_KEY]) store.removeItem(key);
    return prefs;
};

export const readPreferences = (): Preferences => {
    const store = storage();
    if (!store) return {};
    const raw = store.getItem(KEY);
    if (raw === null) {
        const migrated = migrate(store);
        store.setItem(KEY, JSON.stringify(migrated));
        return migrated;
    }
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

export const clearPreferences = (): void => {
    storage()?.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(EVENT));
};

/** Calls listener when settings change in this tab or another one. */
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
