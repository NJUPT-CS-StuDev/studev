import { useEffect, useState } from 'react';
import { liveTasks, readTasks, subscribeTasks, type Task } from './tasks';

/** One's own tasks, read after mount and kept current when they change here or in another tab. */
export function useTasks(): Task[] {
    const [tasks, setTasks] = useState<Task[]>([]);
    useEffect(() => {
        const sync = () => setTasks(liveTasks(readTasks()));
        sync();
        return subscribeTasks(sync);
    }, []);
    return tasks;
}
