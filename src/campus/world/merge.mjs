// How what one keeps is merged across one's devices, the same on the platform (src/platform/server/sync.mjs), the web
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

/** The parts of one's timetable settings that go with one: each part is merged whole, by when it last changed. */
export const SECTIONS = ['class', 'campus', 'timetable', 'examAttendance', 'examReminders', 'labs', 'layers', 'events', 'run'];

// Preferences kept before sync existed have no timestamp. They travel too, but never replace a later explicit choice.
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
