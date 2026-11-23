import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { fail } from './common.mjs';

const ROOT = 'platform-v1/';
export function isConflict(error) {
  return error?.status === 409 || error?.statusCode === 409 || error?.code === 'PRECONDITION_FAILED' || [409, 412].includes(error?.$metadata?.httpStatusCode) || /already exists|precondition|conflict|onlyifnew/i.test(String(error?.message || ''));
}
export function createRepository(store, { now = Date.now, secret, revisions } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) fail(503, 'NOT_CONFIGURED', '平台会话配置尚未完成。');
  function validKey(key) {
    if (typeof key !== 'string' || key.length > 520 || key.startsWith('/') || key.includes('..') || /[\x00-\x1f\\]/.test(key)) throw new Error('Invalid internal metadata key');
    return ROOT + key;
  }
  async function get(key) { return store.get(validKey(key), { type: 'json', consistency: 'strong' }); }
  async function putNew(key, value) {
    try { await store.setJSON(validKey(key), value, { onlyIfNew: true }); }
    catch (error) { if (isConflict(error)) fail(409, 'REVISION_CONFLICT', '记录已更新，请刷新后重试。'); throw error; }
    return value;
  }
  async function put(key, value) {
    await store.setJSON(validKey(key), value);
    return value;
  }
  async function remove(key) { return store.delete(validKey(key)); }
  async function entries(prefix) {
    const result = await store.list({ prefix: validKey(prefix), consistency: 'strong' });
    return result.blobs;
  }
  async function list(prefix) {
    return (await entries(prefix)).map((b) => b.key.slice(ROOT.length)).sort();
  }
  async function latest(prefix, width = 8) {
    // Only immutable, conditionally reserved revisions decide the latest
    // value. A delayed writer cannot publish an older mutable snapshot.
    const offset = ROOT.length + prefix.length + 1;
    let tip;
    for (const entry of await entries(`${prefix}/`)) {
      const filename = entry.key.slice(offset);
      if (filename.length === width + 5 && /^\d+\.json$/.test(filename) && (!tip || entry.key > tip.key)) tip = entry;
    }
    if (!tip) return null;
    return readRevision(tip);
  }
  // A single strong listing supplies the heads of independent records under a
  // collection, so the caller need not list once for every row it displays.
  async function heads(prefix) {
    const latest = new Map();
    for (const entry of await entries(`${prefix}/`)) {
      if (!/\/\d{8}\.json$/.test(entry.key)) continue;
      const group = entry.key.slice(ROOT.length + prefix.length + 1, -14);
      if (group && (!latest.has(group) || latest.get(group).key < entry.key)) latest.set(group, entry);
    }
    return latest;
  }
  async function readRevision(tip) {
    const prefix = tip.key.slice(0, tip.key.lastIndexOf('/'));
    const cached = revisions?.get(prefix);
    if (tip.etag && cached?.key === tip.key && cached.etag === tip.etag) return structuredClone(cached.value);
    const key = tip.key.slice(ROOT.length);
    if (!revisions || !tip.etag) return get(key);
    const raw = await store.get(validKey(key), { type: 'text', consistency: 'strong' });
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (raw.length <= 8192) {
      if (!revisions.has(prefix) && revisions.size >= 512) revisions.delete(revisions.keys().next().value);
      revisions.set(prefix, { ...tip, value: structuredClone(value) });
    }
    return value;
  }
  async function append(prefix, value, expectedRevision = 0) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 99999999) fail(400, 'INVALID_REVISION', '记录版本无效。');
    const current = await latest(prefix);
    if ((current?.revision || 0) !== expectedRevision) fail(409, 'REVISION_CONFLICT', '记录已更新，请刷新后重试。');
    const revision = expectedRevision + 1;
    const next = { ...value, revision };
    await putNew(`${prefix}/${String(revision).padStart(8, '0')}.json`, next);
    return next;
  }
  async function throttle(scope, client, limit, windowSeconds = 60) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) throw new Error('Invalid internal rate limit');
    const bucket = Math.floor(now() / (windowSeconds * 1000));
    const hash = createHmac('sha256', secret).update(`${scope}:${client || 'unknown'}`).digest('hex').slice(0, 32);
    const prefix = `rate/${scope}/${hash}/`;
    // Do not probe every earlier occupied slot with a remote conditional write.
    // Randomizing the first free candidate also spreads simultaneous campus-NAT requests.
    const keys = await list(prefix);
    const occupied = new Set(keys);
    const start = randomInt(limit);
    for (let offset = 0; offset < limit; offset++) {
      const i = (start + offset) % limit;
      const key = `${prefix}${bucket}-${String(i).padStart(3, '0')}.json`;
      if (occupied.has(key)) continue;
      try {
        await putNew(key, { expiresAt: (bucket + 2) * windowSeconds * 1000 });
        // An auxiliary cleanup failure cannot turn a successful login into a service failure.
        try {
          const stale = keys.filter((key) => Number(key.slice(prefix.length).split('-')[0]) < bucket - 1).slice(0, 20);
          await Promise.all(stale.map((key) => remove(key)));
        } catch { /* Old tickets may be cleaned on a future request. */ }
        return;
      } catch (error) { if (!isConflict(error)) throw error; }
    }
    fail(429, 'RATE_LIMITED', '操作过于频繁，请稍后重试。');
  }
  async function audit(actor, action, target, details = {}) {
    const allowed = ['role', 'status', 'previousRole', 'previousStatus', 'itemId', 'roundId', 'kind', 'submissionId', 'revision', 'count', 'fieldCount'];
    const identityFlags = ['identityVerified', 'profileComplete'];
    const safe = Object.fromEntries(Object.entries(details).filter(([key, v]) => identityFlags.includes(key) ? typeof v === 'boolean' : allowed.includes(key) && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 100))));
    const id = `${String(9999999999999 - now()).padStart(13, '0')}-${randomUUID()}`;
    return putNew(`audit/${id}.json`, { id, actorId: typeof actor === 'string' ? actor.slice(0, 80) : actor?.id || 'system', action: String(action).slice(0, 80), target: String(target).slice(0, 160), details: safe, createdAt: new Date(now()).toISOString() });
  }
  return { get, put, putNew, remove, list, latest, heads, readRevision, append, throttle, audit };
}
