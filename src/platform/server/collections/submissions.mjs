import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail, readJson, text } from '../common.mjs';
import { isConflict } from '../store.mjs';
import { isRecipient, openRound } from './definition.mjs';
import { answersInput, fileInput } from './fields.mjs';
import { collectionKeys as keys, locateSubmission, mapConcurrent, studentId, submissionId } from './records.mjs';

const strongETag = (value) => typeof value === 'string' && /^"[^"\r\n]+"$/.test(value);

function oscaConfig(env) {
  let endpoint;
  try { endpoint = new URL(env.OSCA_ENDPOINT); } catch { fail(503, 'NOT_CONFIGURED', '文件存储尚未配置。'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    endpoint.pathname !== '/' || !/^[a-zA-Z0-9._-]{1,150}$/.test(env.OSCA_BUCKET || '') ||
    ![env.OSCA_ACCESS_KEY_ID, env.OSCA_SECRET_ACCESS_KEY].every((v) => typeof v === 'string' && v)) {
    fail(503, 'NOT_CONFIGURED', '文件存储配置无效。');
  }
  const prefix = env.OSCA_PREFIX || 'studev-submissions/';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(prefix)) fail(503, 'NOT_CONFIGURED', '文件存储目录无效。');
  return { endpoint: endpoint.origin, bucket: env.OSCA_BUCKET, accessKeyId: env.OSCA_ACCESS_KEY_ID,
    secretAccessKey: env.OSCA_SECRET_ACCESS_KEY, region: env.OSCA_REGION || 'us-east-1', prefix };
}

function matchingObject(head, file) {
  return head && head.size === file.size && head.contentType === file.type && strongETag(head.etag);
}

export function ownsSubmission(record, user) {
  if (!user) return false;
  if (record.userId) return record.userId === user.id;
  const sid = studentId(user.studentId);
  return Boolean(user.identityVerified && sid && record.studentId === sid);
}

export function submissionView(record, item, round) {
  const { id, itemId, roundId, studentId, studentName, answers, fields, submittedAt, createdAt, updatedAt, status, revision, review } = record;
  return { id, itemId, roundId, itemName: item?.name, roundLabel: round?.label, studentId, studentName,
    answers, fields, submittedAt, createdAt, updatedAt, status, revision, ...(review ? { review } : {}),
    files: record.files.map(({ id, fieldId, name, size, type }) => ({ id, fieldId, name, size, type })),
  };
}

function receiptView({ id, itemId, roundId, status, revision, submittedAt, updatedAt }) {
  return { id, itemId, roundId, status, revision, submittedAt, updatedAt };
}

export function submissionStatus(round, timestamp) {
  if (round.requireReview) return 'pending_review';
  return round.deadline && Date.parse(timestamp) > Date.parse(round.deadline) ? 'late' : 'submitted';
}

export function canEditSubmission(record, item, round, actor, now) {
  return ownsSubmission(record, actor) && isRecipient(item, actor) && round.allowEdit &&
    record.allowEdit !== false && openRound(item, round, now);
}

async function claim(repo, prefix, maximum, ticket, code, previouslyReserved = false) {
  const occupied = new Set(await repo.list(prefix));
  if (previouslyReserved) {
    const tickets = await mapConcurrent([...occupied], 24, repo.get);
    if (tickets.some((value) => value?.id === ticket.id)) return;
  }
  for (let n = 0; n < maximum; n++) {
    const key = prefix + String(n).padStart(4, '0') + '.json';
    if (occupied.has(key)) continue;
    try { await repo.putNew(key, ticket); return; }
    catch (error) { if (!isConflict(error)) throw error; }
    if (ticket.stable && (await repo.get(key))?.id === ticket.id) return;
  }
  fail(409, code, code === 'USER_LIMIT_REACHED'
    ? '你已达到本轮上传授权次数上限。'
    : '本轮的提交授权名额已满。');
}

async function reserveReplacement(repo, item, round, sid) {
  const key = keys.replacement(item.id, round.id, sid);
  const existing = await repo.get(key);
  if (existing) return { id: existing.id, previouslyReserved: true };
  const id = randomUUID();
  try { await repo.putNew(key, { id }); return { id, previouslyReserved: false }; }
  catch (error) {
    if (!isConflict(error)) throw error;
    const reserved = await repo.get(key);
    if (!reserved) throw error;
    return { id: reserved.id, previouslyReserved: true };
  }
}

function attachmentSelection(body, existing) {
  const ids = body.keepFiles ?? [];
  if (!Array.isArray(ids) || ids.length > 200 || new Set(ids).size !== ids.length) {
    fail(400, 'INVALID_FILES', '保留附件选择无效。');
  }
  const byId = new Map(existing?.files.map((file) => [file.id, file]));
  return ids.map((id) => {
    const file = byId.get(id);
    if (!file) fail(409, 'FILE_NOT_AVAILABLE', '选中的附件已发生变化，请刷新。');
    return file;
  });
}

export function collectionSubmissions({ repo, env, now, getGateway }) {
  const iso = () => new Date(now()).toISOString();
  const gateway = () => getGateway(oscaConfig(env));
  const receiptTokenFor = (id) => createHmac('sha256', env.PLATFORM_SESSION_SECRET).update('collection receipt: ' + id).digest('base64url');

  async function begin(request, item, round, actor) {
    if (!isRecipient(item, actor)) fail(404, 'NOT_FOUND', '收集不存在或无权提交。');
    if (!openRound(item, round, now())) fail(409, 'COLLECTION_CLOSED', '本轮当前不接受提交。');
    const body = await readJson(request);
    const sid = studentId(actor.studentId);
    if (!/^[A-Z0-9]{4,24}$/.test(sid)) fail(403, 'IDENTITY_REQUIRED', '请先完成学号认证。');
    const answers = answersInput(body.answers, round.fields);
    await repo.throttle('collection-submit', actor.id, 15);
    const stable = round.submissionMode === 'replace';
    const { id, previouslyReserved } = stable ? await reserveReplacement(repo, item, round, sid) : { id: randomUUID() };
    const existing = stable ? await repo.latest(keys.submission(item.id, round.id, id)) : null;
    if (existing && !ownsSubmission(existing, actor)) fail(409, 'IDENTITY_CHANGED', '此学号的既有提交需要管理员核对。');
    const kept = attachmentSelection(body, existing);
    const inputs = fileInput(body.files || [], round.fields, kept, round.maxTotalFileBytes);
    const configuration = inputs.length ? oscaConfig(env) : null;
    const receiptId = randomUUID();
    const issuedAt = iso();
    const ticket = { id: stable ? id : receiptId, issuedAt, stable };
    if (!stable) await claim(repo, keys.quota(item.id, round.id, 'user/' + actor.id), round.maxPerUser, ticket, 'USER_LIMIT_REACHED');
    if (!existing) await claim(repo, keys.quota(item.id, round.id, 'all'), round.maxSubmissions, ticket, 'COLLECTION_FULL', previouslyReserved);
    const record = {
      id, itemId: item.id, roundId: round.id, userId: actor.id, studentId: sid,
      studentName: actor.realName || actor.nickname || sid, answers, fields: round.fields,
      status: 'uploading', createdAt: existing?.createdAt || issuedAt, submittedAt: issuedAt, updatedAt: issuedAt, files: kept,
      allowEdit: round.allowEdit, requireReview: round.requireReview, deadline: round.deadline,
    };
    const expectedRevision = existing?.revision || 0;
    if (!inputs.length) {
      await locateSubmission(repo, record);
      const result = await repo.append(keys.submission(item.id, round.id, id),
        { ...record, status: submissionStatus(record, issuedAt) }, expectedRevision);
      return { submission: submissionView(result, item, round), uploads: [] };
    }
    const objectPrefix = configuration ? configuration.prefix + 'collection/' + item.id + '/' + round.id + '/' : '';
    const pending = inputs.map((file) => ({ ...file, objectKey: objectPrefix + 'staging/' + receiptId + '/' + file.id + '.' + file.extension }));
    const receipt = {
      expiresAt: now() + 300000, record,
      pending, objectPrefix, expectedRevision,
    };
    const storage = configuration ? getGateway(configuration) : null;
    const uploads = await mapConcurrent(pending, 6, async (file) => ({
      fileId: file.id,
      ...await storage.presignUpload({
        id: file.id, objectKey: file.objectKey, contentType: file.type, fileSize: file.size, fileName: file.name,
      }, 300),
    }));
    const submission = { ...record, revision: expectedRevision, files: [...kept, ...pending] };
    await repo.putNew(keys.request(receiptId), receipt);
    return { submission: submissionView(submission, item, round), receiptId, receiptToken: receiptTokenFor(receiptId), uploads };
  }

  async function complete(context, id) {
    if (!submissionId.test(id)) fail(404, 'NOT_FOUND', '提交凭证不存在。');
    const body = await readJson(context.request);
    const token = body.receiptToken;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(receiptTokenFor(id)))) {
      fail(403, 'RECEIPT_REJECTED', '提交凭证无效。');
    }
    const receipt = await repo.get(keys.request(id));
    if (!receipt) fail(403, 'RECEIPT_REJECTED', '提交凭证无效。');
    const { record, pending, objectPrefix, expectedRevision } = receipt;
    const prefix = keys.submission(record.itemId, record.roundId, record.id);
    const target = prefix + '/' + String(expectedRevision + 1).padStart(8, '0') + '.json';
    let storage;
    const candidates = [];
    let disposable = true;
    async function removeObjects(paths) {
      await mapConcurrent(paths, 6, async (path) => {
        try { await storage.delete(path); } catch { /* This path is unreachable from a submission. */ }
      });
    }
    async function removeStaging() {
      storage ||= gateway();
      const work = removeObjects(pending.map((file) => file.objectKey));
      if (typeof context.waitUntil === 'function') context.waitUntil(work);
      else await work;
    }
    const current = await repo.get(target);
    if (current?.receiptId === id) {
      // A retry can be the first response after an ambiguous metadata write.
      if (now() <= receipt.expiresAt + 3600000) {
        try { await removeStaging(); } catch { /* The committed receipt still applies. */ }
      }
      return receiptView(current);
    }
    if (current) fail(409, 'REVISION_CONFLICT', '提交已发生变化，请刷新后重试。');
    if (now() > receipt.expiresAt + 3600000) fail(410, 'SUBMISSION_EXPIRED', '本次上传确认已过期。');
    await repo.throttle('collection-complete', record.userId, 60);
    storage = gateway();
    try {
      const copies = await mapConcurrent(pending, 5, async ({ extension, ...file }) => {
        const head = await storage.head(file.objectKey);
        if (!matchingObject(head, file)) fail(409, 'UPLOAD_MISMATCH', '附件尚未就绪，或内容与声明不一致。');
        const final = objectPrefix + 'final/' + id + '/' + file.id + '/' + randomUUID();
        candidates.push(final);
        await storage.copy(file.objectKey, final, head.etag);
        const archived = await storage.head(final);
        if (!matchingObject(archived, file) || archived.etag !== head.etag) fail(409, 'UPLOAD_CHANGED', '附件在确认期间发生变化。');
        return { ...file, objectKey: final, etag: head.etag };
      });
      await locateSubmission(repo, record);
      const value = { ...record, receiptId: id, files: [...record.files, ...copies],
        status: submissionStatus(record, record.submittedAt), updatedAt: iso(),
      };
      // A transport error can conceal a successful commit. Retain the candidate
      // objects until the occupied immutable revision proves who owns them.
      disposable = false;
      const committed = await repo.append(prefix, value, expectedRevision);
      await removeStaging();
      return receiptView(committed);
    } catch (error) {
      // Another confirmation can finish and remove staging while this one is
      // still reading it. A matching committed receipt settles both requests.
      if (!isConflict(error)) throw error;
      const winner = await repo.get(target);
      if (winner) disposable = !winner.files.some((file) => candidates.includes(file.objectKey));
      if (winner?.receiptId !== id) throw error;
      return receiptView(winner);
    } finally {
      if (disposable && candidates.length) await removeObjects(candidates);
    }
  }

  async function change(request, record, item, round, actor, action) {
    const body = await readJson(request);
    const updatedAt = iso();
    const next = { ...record, updatedAt };
    if (action === 'edit') {
      if (!canEditSubmission(record, item, round, actor, now())) fail(409, 'EDIT_CLOSED', '本轮当前不允许修改。');
      if (body.files !== undefined) fail(400, 'FILES_IMMUTABLE', '请在本轮重新提交附件。');
      next.answers = answersInput(body.answers, record.fields);
      next.status = submissionStatus(record, record.submittedAt);
      delete next.review;
    } else {
      if (!record.requireReview && !round.requireReview) fail(409, 'REVIEW_NOT_REQUIRED', '本轮提交无需审核。');
      if (!['accepted', 'rejected'].includes(body.status)) fail(400, 'INVALID_STATUS', '审核状态无效。');
      next.status = body.status;
      next.review = { status: body.status, comment: text(body.comment, '审核说明', 1000), reviewedAt: updatedAt };
    }
    const result = await repo.append(keys.submission(item.id, round.id, record.id), next, body.revision);
    await repo.audit(actor, 'collection.' + action, record.id, { itemId: item.id, roundId: round.id, revision: result.revision });
    return submissionView(result, item, round);
  }

  async function download(file, expiresIn = 60) {
    if (!file) fail(404, 'NOT_FOUND', '附件不存在。');
    const config = oscaConfig(env);
    if (!file.objectKey?.startsWith(config.prefix) || !strongETag(file.etag)) fail(409, 'OBJECT_CHANGED', '附件归档信息无效。');
    // The signed GET carries If-Match. A storage round trip here would add
    // latency while still leaving a race between a HEAD and the actual GET.
    return getGateway(config).presignDownload({ fileName: file.name, finalObjectKey: file.objectKey }, file.etag, expiresIn);
  }
  return { begin, complete, change, download };
}
