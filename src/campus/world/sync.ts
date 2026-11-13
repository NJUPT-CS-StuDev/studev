// One's tasks and timetable settings, the same on every device one signs in on. Nothing leaves the device unless one is
// signed in; then the device sends what it has, the platform merges it with what the other devices sent, and both keep
// the merge, by the rules in merge.mjs that the platform and Android share. AI conversations stay on each device.
import type { Task } from './tasks';
import type { Preferences, Section } from './preferences';
import { mergeSettings as mergeParts, mergeTasks as mergeAll, SECTIONS } from './merge.mjs';

export type Settings = Partial<Record<Section, { value: unknown; modified: string }>>;
export const mergeTasks = (mine: Task[], theirs: Task[]): Task[] => mergeAll(mine, theirs) as Task[];
export const mergeSettings = (mine: Settings, theirs: Settings): Settings => mergeParts(mine, theirs) as Settings;

/** The parts of one's settings that have changed at some time, as they go to the platform. */
export const settingsOf = (prefs: Preferences): Settings =>
    Object.fromEntries((SECTIONS as Section[]).filter(section => prefs.modified?.[section]).map(section => [section, { value: prefs[section] ?? null, modified: prefs.modified![section]! }]));

/** One's settings with the parts that changed later elsewhere taken in, or null when none did. */
export function settingsTaken(prefs: Preferences, merged: Settings): Preferences | null {
    let next: Preferences | null = null;
    for (const section of SECTIONS as Section[]) {
        const part = merged[section];
        if (!part || part.modified < (prefs.modified?.[section] ?? '')) continue;
        if (part.modified === prefs.modified?.[section] && JSON.stringify(part.value) === JSON.stringify(prefs[section] ?? null)) continue;
        next ??= { ...prefs };
        if (part.value === null || part.value === undefined) delete next[section]; else (next as Record<string, unknown>)[section] = part.value;
        next.modified = { ...next.modified, [section]: part.modified };
    }
    return next;
}

/** Whether two lists hold the same tasks in the same versions, so that a merge that changes nothing is not written. */
const same = (left: Task[], right: Task[]) => left.length === right.length && left.every(task => right.some(other => other.id === task.id && other.modified === task.modified));

let started = false;
/**
 * Keeps this device's tasks and settings in step while one is signed in: once on opening, again on coming back to the
 * page, and shortly after any change here. A device signed out keeps them to itself.
 */
export function startSync() {
    if (started || typeof window === 'undefined') return;
    started = true;
    let timer = 0, running = false, again = false, writing = false;
    const run = async () => {
        if (running) { again = true; return; }
        // Only a device that has been signed in asks; one that never was does not wake the platform at all.
        try { if (!window.localStorage.getItem('studev_auth_user')) return; } catch { return; }
        running = true;
        const generation = window.localStorage.getItem('studev_session_generation');
        try {
            const [{ api, session }, { readTasks, writeTasks }, { readPreferences, writePreferences }] = await Promise.all([import('../../platform/client/api'), import('./tasks'), import('./preferences')]);
            if (!await session()) return;
            const reply = await api<{ tasks: Task[]; settings: Settings }>('/sync', { tasks: readTasks(), settings: settingsOf(readPreferences()) });
            // A reply for a session that was signed out or replaced cannot be adopted by its successor.
            if (!window.localStorage.getItem('studev_auth_user') || generation !== window.localStorage.getItem('studev_session_generation')) return;
            const now = readTasks();
            const merged = mergeTasks(now, reply.tasks);
            // Writing what came is not a change made here, and is not sent back.
            writing = true;
            try {
                if (!same(merged, now)) writeTasks(() => merged);
                const taken = settingsTaken(readPreferences(), reply.settings ?? {});
                if (taken) writePreferences(() => taken, true);
            } finally { writing = false; }
        } catch { /* Offline or signed out: they stay here and go next time. */ }
        finally { running = false; if (again) { again = false; schedule(); } }
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void run(), 1500); };
    void run();
    window.addEventListener('studev:tasks', () => { if (!writing) schedule(); });
    window.addEventListener('studev:preferences', event => { if (!writing && !(event as CustomEvent<{ adopt?: boolean }>).detail?.adopt) schedule(); });
    window.addEventListener('storage', event => { if (!event.key || ['studev_auth_user', 'studev_session_generation', 'studev_tasks', 'studev_prefs'].includes(event.key)) schedule(); });
    window.addEventListener('online', () => void run());
    window.addEventListener('focus', () => void run());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void run(); });
}
