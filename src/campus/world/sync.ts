// One's tasks, the same on every device one signs in on. Nothing leaves the device unless one is signed in; then the
// device sends what it has, the platform merges it with what the other devices sent, and both keep the merge. Of two
// versions of a task the later change wins, and a deletion is a change like any other: the same rule as the platform's.
import type { Task } from './tasks';

export function mergeTasks(mine: Task[], theirs: Task[]): Task[] {
    const merged = new Map(mine.map(task => [task.id, task]));
    for (const task of theirs) {
        const kept = merged.get(task.id);
        if (!kept || task.modified > kept.modified) merged.set(task.id, task);
    }
    return [...merged.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** Whether two lists hold the same tasks in the same versions, so that a merge that changes nothing is not written. */
const same = (left: Task[], right: Task[]) => left.length === right.length && left.every(task => right.some(other => other.id === task.id && other.modified === task.modified));

let started = false;
/**
 * Keeps this device's tasks in step while one is signed in: once on opening, again on coming back to the page, and
 * shortly after any change here. A device signed out keeps its tasks to itself.
 */
export function startTaskSync() {
    if (started || typeof window === 'undefined') return;
    started = true;
    let timer = 0, running = false, again = false, writing = false;
    const run = async () => {
        if (running) { again = true; return; }
        // Only a device that has been signed in asks; one that never was does not wake the platform at all.
        try { if (!window.localStorage.getItem('studev_auth_user')) return; } catch { return; }
        running = true;
        try {
            const [{ api, session }, { readTasks, writeTasks }] = await Promise.all([import('../../platform/client/api'), import('./tasks')]);
            if (!await session()) return;
            const sent = readTasks();
            const { tasks } = await api<{ tasks: Task[] }>('/sync', { tasks: sent });
            const now = readTasks();
            const merged = mergeTasks(now, tasks);
            // Writing the merge is not a change made here, and is not sent back.
            if (!same(merged, now)) { writing = true; try { writeTasks(() => merged); } finally { writing = false; } }
        } catch { /* Offline or signed out: the tasks stay here and go next time. */ }
        finally { running = false; if (again) { again = false; schedule(); } }
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void run(), 1500); };
    void run();
    window.addEventListener('studev:tasks', () => { if (!writing) schedule(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void run(); });
}
