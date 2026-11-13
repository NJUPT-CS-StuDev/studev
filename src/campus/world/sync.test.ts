import { beforeEach, expect, it } from 'vitest';
import { readPreferences, writePreferences } from './preferences';
import { settingsOf, settingsTaken } from './sync';

const values = new Map<string, string>();
const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
Object.assign(globalThis, { window: Object.assign(new EventTarget(), { localStorage }) });
beforeEach(() => values.clear());

it('migrates existing choices once, includes reminders, and never includes conversations or provider keys', () => {
    values.set('studev_prefs', JSON.stringify({ class: 'B240402', labs: { skip: ['lab-1'] }, examReminders: [], ai: { key: 'not-a-real-key' } }));
    const prefs = readPreferences();
    expect(settingsOf(prefs)).toEqual({ class: { value: 'B240402', modified: '1970-01-01T00:00:00.000Z' }, labs: { value: { skip: ['lab-1'] }, modified: '1970-01-01T00:00:00.000Z' }, examReminders: { value: [], modified: '1970-01-01T00:00:00.000Z' } });
    expect(readPreferences()).toEqual(prefs);
    expect(JSON.parse(values.get('studev_prefs')!)).toEqual(prefs);
});

it('adopts cloud changes without restamping, carries a clear, and keeps edits made while a request was in flight', () => {
    writePreferences(() => ({ class: 'B240402', labs: { skip: ['lab-1'] } }));
    const original = readPreferences();
    const cloudTime = '2099-01-01T00:00:00.000Z';
    const taken = settingsTaken(original, { class: { value: 'B240403', modified: cloudTime }, labs: { value: null, modified: cloudTime } });
    writePreferences(() => taken!, true);
    expect(readPreferences().class).toBe('B240403');
    expect(readPreferences().labs).toBeUndefined();
    expect(settingsOf(readPreferences()).labs).toEqual({ value: null, modified: cloudTime });
    expect(settingsTaken(readPreferences(), settingsOf(original))).toBeNull();
});

it('accepts the server winner for simultaneous choices and does nothing when it is already adopted', () => {
    const prefs = { class: 'B240402', modified: { class: '2026-11-13T00:00:00.000Z' } };
    const remote = { class: { value: 'B240403', modified: '2026-11-13T00:00:00.000Z' } };
    const taken = settingsTaken(prefs, remote)!;
    expect(taken.class).toBe('B240403');
    expect(settingsTaken(taken, remote)).toBeNull();
});
