// How what one keeps is merged across one's devices: two collections, one's tasks and the parts of oneself, by one rule; the same on the platform (src/platform/server/sync.mjs), the web
// (sync.ts) and Android (android/.../me/Sync.kt): of two versions, the later change wins, and a deletion is a change
// like any other. The platform merges by when things changed alone and keeps the rest as a device wrote it.

/** Tasks, one by one. */
export function mergeTasks(mine, theirs) {
    const merged = new Map(mine.map(task => [task.id, task]));
    for (const task of theirs) {
        const kept = merged.get(task.id);
        if (!kept || task.modified > kept.modified) merged.set(task.id, task);
    }
    return [...merged.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/**
 * The parts of oneself that go with one, each merged whole by when it last changed: the timetable's settings, the
 * appearance chosen, what the AI keeps in mind, and the suggestions put aside. What stays on a device is not here: one's
 * own model key, AI conversations, where the desktop widgets sit.
 */
export const SECTIONS = ['class', 'campus', 'timetable', 'examAttendance', 'examReminders', 'labs', 'layers', 'events', 'run', 'appearance', 'memory', 'hints'];

// A part with no time it was changed counts as changed at the start of time: it travels, and any part changed at a
// known time wins over it.
export const INITIAL_MODIFIED = '1970-01-01T00:00:00.000Z';
export function initialModified(settings) {
    const modified = { ...settings.modified };
    for (const section of SECTIONS) if (settings[section] !== undefined && !modified[section]) modified[section] = INITIAL_MODIFIED;
    return modified;
}

/** Settings, part by part: `{ [part]: { value, modified } }`, a value of null being a part cleared. */
export function mergeSettings(mine, theirs) {
    const merged = {};
    for (const section of SECTIONS) {
        const left = mine?.[section], right = theirs?.[section];
        const kept = !left ? right : !right ? left : right.modified > left.modified ? right : left;
        if (kept) merged[section] = kept;
    }
    return merged;
}
