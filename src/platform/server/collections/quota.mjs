import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fail } from '../common.mjs';
import { isConflict } from '../store.mjs';
import { collectionKeys as keys, mapConcurrent, revisionKey, studentId } from './records.mjs';

export const uploadSeconds = 300;
export const confirmationMillis = 60 * 60 * 1000;
// Edge executions that started before expiry have time to settle their writes.
const settlementMillis = 5 * 60 * 1000;

function recordKey(itemId, roundId, entry) {
  return revisionKey(keys.submission(itemId, roundId, entry.submissionId), entry.expectedRevision + 1);
}

function priorEntry(id, receipt) {
  const { record, expiresAt, expectedRevision } = receipt;
  return { id, submissionId: record.id, studentId: studentId(record.studentId),
    expiresAt: expiresAt + confirmationMillis, expectedRevision, phase: 'pending' };
}

export async function seedRoundQuota(repo, itemId, roundId, receipts = []) {
  const heads = await repo.heads(keys.round(itemId, roundId));
  const records = await mapConcurrent([...heads.values()], 24, repo.readRevision);
  const completed = Object.fromEntries(records.map((row) => [row.id, studentId(row.studentId)]));
  const live = await mapConcurrent(receipts, 24, async ([id, request]) => {
    const entry = priorEntry(id, request);
    return (await repo.get(recordKey(itemId, roundId, entry))) ? null : entry;
  });
  return { completed, active: Object.fromEntries(live.filter(Boolean).map((entry) => [entry.id, entry])) };
}

export function roundQuota(repo, itemId, roundId, now) {
  const prefix = keys.quota(itemId, roundId);
  const read = async () => (await repo.latest(prefix)) ?? seedRoundQuota(repo, itemId, roundId);

  async function update(change) {
    for (let attempt = 0; attempt < 18; attempt++) {
      const state = await read();
      const result = await change(state);
      if (!result.write) return result.value;
      const revision = (state.revision ?? 0) + 1;
      try {
        await repo.putNew(revisionKey(prefix, revision), { ...state, revision });
        return result.value;
      } catch (error) {
        if (!isConflict(error)) throw error;
        await delay(randomInt(4, 19) * (1 + Math.floor(attempt / 3)));
      }
    }
    fail(409, 'REVISION_CONFLICT', '提交人数较多，请稍后重试。');
  }

  async function prune(state) {
    const instant = now();
    const reconcilable = Object.values(state.active).filter((entry) => entry.phase === 'saving' || instant >= entry.expiresAt);
    let changed = false;
    await mapConcurrent(reconcilable, 20, async (entry) => {
      const record = await repo.get(recordKey(itemId, roundId, entry));
      const committed = record?.receiptId === entry.id;
      const expired = instant >= entry.expiresAt + (entry.phase === 'saving' ? settlementMillis : 0);
      if (committed) state.completed[entry.submissionId] = entry.studentId;
      if (record || expired) {
        delete state.active[entry.id];
        changed = true;
      }
    });
    return changed;
  }

  async function reserve(entry, round) {
    return update(async (state) => {
      const changed = await prune(state);
      const current = state.active[entry.id];
      if (current) return { write: changed, value: current };
      const committed = state.completed;
      const active = Object.values(state.active);
      const perStudent = Object.values(committed).filter((sid) => sid === entry.studentId).length
        + active.filter((row) => row.studentId === entry.studentId).length;
      if (round.submissionMode === 'multiple' && perStudent >= round.maxPerUser) {
        fail(409, 'USER_LIMIT_REACHED', '你已达到本轮提交上限，或有一份提交正在上传。');
      }
      const occupied = new Set([...Object.keys(committed), ...active.map((row) => row.submissionId)]);
      if (!occupied.has(entry.submissionId) && occupied.size >= round.maxSubmissions) {
        fail(409, 'COLLECTION_FULL', '本轮已达到提交上限，或剩余名额正在上传。');
      }
      if (round.submissionMode === 'replace' && active.some((row) => row.submissionId === entry.submissionId)) {
        fail(409, 'SUBMISSION_PENDING', '上一份提交仍在处理，请继续上传或取消后重试。');
      }
      state.active[entry.id] = entry;
      return { write: true, value: entry };
    });
  }

  async function authoriseSave(id) {
    return update(async (state) => {
      const entry = state.active[id];
      if (!entry || now() >= entry.expiresAt) fail(410, 'SUBMISSION_EXPIRED', '本次提交已取消或过期。');
      if (entry.phase === 'saving') return { value: entry };
      entry.phase = 'saving';
      return { write: true, value: entry };
    });
  }

  async function saved(id) {
    return update(async (state) => {
      const entry = state.active[id];
      if (!entry) return {};
      state.completed[entry.submissionId] = entry.studentId;
      delete state.active[id];
      return { write: true };
    });
  }

  async function cancel(id) {
    return update(async (state) => {
      const entry = state.active[id];
      if (!entry) return {};
      if (entry.phase === 'saving') fail(409, 'SUBMISSION_PENDING', '提交正在确认，请稍后重试。');
      delete state.active[id];
      return { write: true };
    });
  }

  async function discard(id) {
    return update(async (state) => {
      if (!state.active[id]) return {};
      delete state.active[id];
      return { write: true };
    });
  }

  async function status() {
    return update(async (state) => ({ write: await prune(state), value: {
      active: Object.keys(state.active).length, completed: Object.keys(state.completed).length,
    } }));
  }

  return { reserve, authoriseSave, saved, cancel, discard, status, read };
}
