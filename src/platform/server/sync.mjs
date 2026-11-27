import { fail, readJson, response } from './common.mjs';
import { isConflict } from './store.mjs';
import { mergeSettings, mergeTasks, SECTIONS } from '../../campus/world/merge.mjs';

export { mergeTasks, mergeSettings };

const MAX_TASKS = 5000;
const MAX_TASK_BYTES = 8192;

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

const MAX_SETTINGS_BYTES = 256 * 1024;
/** Settings as a device sends them: only the known parts, each with when it changed. */
export function syncedSettings(input) {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > MAX_SETTINGS_BYTES) fail(400, 'SYNC_INVALID', '设置数据无效。');
  const kept = {};
  for (const [section, part] of Object.entries(input)) {
    if (!SECTIONS.includes(section) || !part || typeof part !== 'object' || typeof part.modified !== 'string' || !part.modified || part.modified.length > 40 || !('value' in part)) fail(400, 'SYNC_INVALID', '设置数据无效。');
    kept[section] = { value: part.value, modified: part.modified };
  }
  return kept;
}

/** The revisions a device last received, if it says. */
export function syncedKnown(input) {
  if (input === undefined || input === null) return {};
  const valid = (value) => value === undefined || (Number.isSafeInteger(value) && value >= 0 && value < 99999999);
  if (!input || typeof input !== 'object' || Array.isArray(input) || !valid(input.tasks) || !valid(input.settings)) fail(400, 'SYNC_INVALID', '同步版本无效。');
  return { tasks: input.tasks, settings: input.settings };
}

/**
 * One's tasks and timetable settings, the same on every device one signs in on. Nothing comes here from a device that
 * is not signed in; AI conversations and one's own model key never come here at all.
 */
export function createSyncService({ identity, repo }) {
  return async function handle(context, path) {
    if (path !== '/api/platform/sync') return null;
    if (context.request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。');
    const session = await identity.authenticate(context.request, { required: true, csrf: true });
    const body = await readJson(context.request, 4 * 1024 * 1024);
    const incoming = syncedTasks(body.tasks), settings = syncedSettings(body.settings), known = syncedKnown(body.known);
    // Only a write is rate limited; a device that brings nothing new costs reads alone.
    let limited;
    const writing = () => (limited ||= repo.throttle('sync', session.user.id, 60));
    const [tasks, kept] = await Promise.all([
      merged(`sync/tasks/${session.user.id}`, 'tasks', stored => mergeTasks(stored ?? [], incoming), known.tasks, writing),
      merged(`sync/settings/${session.user.id}`, 'settings', stored => mergeSettings(stored ?? {}, settings), known.settings, writing),
    ]);
    return response({ tasks: tasks.value, settings: kept.value, known: { tasks: tasks.revision, settings: kept.revision } });
  };
  /**
   * What is kept under a key, merged with what came: two devices may send at once, and the second merges again. The
   * revision the device last received proves itself still the latest in one round of simple reads.
   */
  async function merged(prefix, field, merge, known, writing) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await repo.latest(prefix, 8, attempt ? undefined : known);
      const value = merge(current?.[field]);
      if (current && JSON.stringify(value) === JSON.stringify(current[field])) return { value, revision: current.revision };
      await writing();
      try { return { value, revision: (await repo.append(prefix, { [field]: value }, current?.revision ?? 0)).revision }; }
      catch (error) { if (!isConflict(error)) throw error; }
    }
    fail(409, 'SYNC_BUSY', '另一台设备正在同步，请稍后再试。');
  }
}
