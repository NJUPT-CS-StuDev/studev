import { beforeEach, describe, expect, it } from 'vitest';
import { readPreferences, timetableEdits, updateTimetableEdits, writePreferences } from './preferences';

// A browser-like window with storage, enough for this module.
const store = new Map<string, string>();
const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
};
Object.assign(globalThis, { window: Object.assign(new EventTarget(), { localStorage }) });

describe('preferences', () => {
    beforeEach(() => localStorage.clear());

    it('keeps timetable edits per term and drops malformed values', () => {
        updateTimetableEdits('2026-2027-1', edits => ({ ...edits, added: [...edits.added, 'x', 'x'] }));
        updateTimetableEdits('2026-2027-1', edits => ({ ...edits, hidden: ['y'] }));
        const prefs = readPreferences();
        expect(timetableEdits(prefs, '2026-2027-1')).toEqual({ hidden: ['y'], added: ['x'] });
        expect(timetableEdits(prefs, '2026-2027-2')).toEqual({ hidden: [], added: [] });
        localStorage.setItem('studev_prefs', JSON.stringify({ class: 'not a class', timetable: { bad: { added: ['z'] } } }));
        expect(readPreferences()).toEqual({});
    });

    it('accepts class names with a direction suffix', () => {
        writePreferences(current => ({ ...current, class: 'Q230101(TG)' }));
        expect(readPreferences().class).toBe('Q230101(TG)');
    });
});
