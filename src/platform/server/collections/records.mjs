import { fail } from '../common.mjs';
import { isConflict } from '../store.mjs';

export const collectionId = /^[a-zA-Z0-9_-]{4,80}$/;
export const submissionId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const studentId = (value) => String(value || '').normalize('NFKC').trim().toUpperCase();

export const collectionKeys = {
  definitions: 'collection/definitions',
  definition: (itemId) => `collection/definitions/${itemId}`,
  submissions: 'collection/submissions',
  round: (itemId, roundId) => `collection/submissions/${itemId}/${roundId}`,
  submission: (itemId, roundId, id) => `collection/submissions/${itemId}/${roundId}/${id}`,
  locator: (id) => `collection/locators/${id}.json`,
  user: (userId) => `collection/users/${userId}/`,
  student: (sid) => `collection/students/${sid}/`,
  history: (userId, itemId, roundId, id) => `collection/users/${userId}/${itemId}/${roundId}/${id}.json`,
  replacement: (itemId, roundId, sid) => `collection/replacements/${itemId}/${roundId}/${sid}.json`,
  request: (id) => `collection/requests/${id}.json`,
  itemQuota: (itemId) => `collection/quota/${itemId}/`,
  quota: (itemId, roundId, scope) => `collection/quota/${itemId}/${roundId}/${scope}/`,
};

/** Locator and history entries precede the authoritative record, so a failed
 * publish cannot leave a committed submission unreachable. */
export async function locateSubmission(repo, { id, itemId, roundId, userId, studentId: sid }) {
  const key = collectionKeys.locator(id);
  const locator = { itemId, roundId, userId, studentId: sid };
  try { await repo.putNew(key, locator); }
  catch (error) {
    if (!isConflict(error)) throw error;
    const existing = await repo.get(key);
    if (!existing || existing.itemId !== itemId || existing.roundId !== roundId || (existing.userId && existing.userId !== userId) || existing.studentId !== sid) throw error;
  }
  if (userId) {
    try { await repo.putNew(collectionKeys.history(userId, itemId, roundId, id), {}); }
    catch (error) { if (!isConflict(error)) throw error; }
  }
}

export async function mapConcurrent(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !failure) {
      const index = next++;
      try { results[index] = await work(items[index], index); }
      catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

export function parseHistoryKey(prefix, key) {
  const [itemId, roundId, filename] = key.slice(prefix.length).split('/');
  const id = filename?.replace(/\.json$/, '');
  return collectionId.test(itemId) && collectionId.test(roundId) && submissionId.test(id) ? { itemId, roundId, id } : null;
}

export async function readSubmission(repo, id) {
  if (!submissionId.test(id)) fail(404, 'NOT_FOUND', '提交记录不存在。');
  const location = await repo.get(collectionKeys.locator(id));
  const record = location && await repo.latest(collectionKeys.submission(location.itemId, location.roundId, id));
  if (!record) fail(404, 'NOT_FOUND', '提交记录不存在。');
  return record;
}
