import { useEffect, useState } from 'react';
import { liveTasks, readTasks, subscribeTasks, type Task } from './tasks';
import { startSync } from './sync';

/** One's own tasks, read after mount and kept current when they change here, in another tab or on another device. */
export function useTasks(): Task[] {
    const [tasks, setTasks] = useState<Task[]>([]);
    useEffect(() => {
        const sync = () => setTasks(liveTasks(readTasks()));
        sync();
        startSync();
        return subscribeTasks(sync);
    }, []);
    return tasks;
}
