import { beforeEach, describe, expect, it } from 'vitest';
import { readPreferences, timetableEdits, updateTimetableEdits, writePreferences, updateExamAttendance, examAttendanceScope } from './preferences';

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
    it('saves attendance immediately, isolates class and term, and preserves explicit restoration', () => {
        updateExamAttendance('2025-2026-2', 'b240402', { 'exam-1': false });
        updateExamAttendance('2025-2026-2', 'B240403', { 'exam-1': true });
        expect(readPreferences().examAttendance?.[examAttendanceScope('2025-2026-2', 'B240402')]).toEqual({ 'exam-1': false });
        expect(readPreferences().examAttendance?.[examAttendanceScope('2026-2027-1', 'B240402')]).toBeUndefined();
        updateExamAttendance('2025-2026-2', 'B240402', { 'exam-1': true });
        expect(readPreferences().examAttendance?.['2025-2026-2:B240402']).toEqual({ 'exam-1': true });
        expect(readPreferences().examAttendance?.['2025-2026-2:B240403']).toEqual({ 'exam-1': true });
    });
});
