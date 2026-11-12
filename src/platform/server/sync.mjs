import { fail, readJson, response } from './common.mjs';
import { isConflict } from './store.mjs';

const MAX_TASKS = 5000;
const MAX_TASK_BYTES = 8192;

/**
 * One's tasks, the same on every device one signs in on. Each task carries when it last changed and whether it was
 * deleted; of two versions of a task, the later change wins, and a deletion is a change like any other. The platform
 * merges by those alone and keeps the rest as the device wrote it: what a task holds is the clients' to read.
 */
export function mergeTasks(stored, incoming) {
  const merged = new Map(stored.map((task) => [task.id, task]));
  for (const task of incoming) {
    const kept = merged.get(task.id);
    if (!kept || task.modified > kept.modified) merged.set(task.id, task);
  }
  return [...merged.values()].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
export function syncedTasks(input) {
  if (!Array.isArray(input) || input.length > MAX_TASKS) fail(400, 'SYNC_INVALID', '任务数据无效。');
  const ids = new Set();
  return input.map((task) => {
    if (!task || typeof task !== 'object' || Array.isArray(task) || typeof task.id !== 'string' || !task.id || task.id.length > 80 || typeof task.modified !== 'string' || !task.modified || task.modified.length > 40 || ids.has(task.id)) fail(400, 'SYNC_INVALID', '任务数据无效。');
    if (JSON.stringify(task).length > MAX_TASK_BYTES) fail(413, 'SYNC_TASK_TOO_LARGE', '单个任务内容过长。');
    ids.add(task.id);
    return task;
  });
}

export function createSyncService({ identity, repo }) {
  return async function handle(context, path) {
    if (path !== '/api/platform/sync') return null;
    if (context.request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。');
    const session = await identity.authenticate(context.request, { required: true, csrf: true });
    await repo.throttle('sync', session.user.id, 60);
    const incoming = syncedTasks((await readJson(context.request, 4 * 1024 * 1024)).tasks);
    const prefix = `sync/tasks/${session.user.id}`;
    // Two devices may send at once: the second to write finds the first's tasks and merges again.
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await repo.latest(prefix);
      const stored = current?.tasks ?? [];
      const merged = mergeTasks(stored, incoming);
      if (current && JSON.stringify(merged) === JSON.stringify(stored)) return response({ tasks: merged });
      try { await repo.append(prefix, { tasks: merged }, current?.revision ?? 0); return response({ tasks: merged }); }
      catch (error) { if (!isConflict(error)) throw error; }
    }
    fail(409, 'SYNC_BUSY', '另一台设备正在同步，请稍后再试。');
  };
}
