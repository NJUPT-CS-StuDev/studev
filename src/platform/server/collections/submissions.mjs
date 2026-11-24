import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { archiveAttachmentName, deadlineReached, roundAcceptsSubmissions } from '../../collections.mjs';
import { fail, readJson, text } from '../common.mjs';
import { isConflict } from '../store.mjs';
import { isRecipient } from './definition.mjs';
import { answersInput, fileInput } from './fields.mjs';
import { collectionKeys as keys, locateSubmission, mapConcurrent, revisionKey, studentId, submissionId } from './records.mjs';
import { confirmationMillis, roundQuota, uploadSeconds } from './quota.mjs';

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

function roundObjectPrefix({ prefix }, { itemId, roundId }) {
  return `${prefix}collection/${itemId}/${roundId}/`;
}

function ownsFinalObject(file, prefix) {
  if (!file.objectKey?.startsWith(prefix)) return false;
  const parts = file.objectKey.slice(prefix.length).split('/');
  return parts.length === 3 && parts[1] === file.id && parts.every((part) => submissionId.test(part));
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
    answers, fields, submittedAt, createdAt, updatedAt, status, late: submissionWasLate(record), revision, ...(review ? { review } : {}),
    files: record.files.map(({ id, fieldId, name, size, type }) => ({
      id, fieldId, name, size, type, archiveName: archiveAttachmentName(item, round, record, { fieldId, name }),
    })),
  };
}

function receiptView(record) {
  const { id, itemId, roundId, status, revision, submittedAt, updatedAt } = record;
  return { id, itemId, roundId, status, late: submissionWasLate(record), revision, submittedAt, updatedAt };
}

export function submissionWasLate(record) {
  if (typeof record.late === 'boolean') return record.late;
  if (record.status === 'late') return true;
  if (record.status === 'submitted') return false;
  // Earlier reviewed records retained the deadline but included equality in
  // the on-time window. New authorizations record the result on arrival.
  return Date.parse(record.submittedAt) > Date.parse(record.deadline);
}

function submissionStatus(record) {
  if (record.requireReview) return 'pending_review';
  return submissionWasLate(record) ? 'late' : 'submitted';
}

export function canEditSubmission(record, item, round, actor, now) {
  return ownsSubmission(record, actor) && isRecipient(item, actor) && round.allowEdit &&
    record.allowEdit !== false && roundAcceptsSubmissions(item, round, now);
}

async function replacement(repo, item, round, sid, permitted) {
  const key = keys.replacement(item.id, round.id, sid);
  const read = async ({ id }) => ({ id, previous: await repo.latest(keys.submission(item.id, round.id, id)) });
  const existing = await repo.get(key);
  if (existing) return read(existing);
  await permitted;
  const id = randomUUID();
  try { await repo.putNew(key, { id }); return { id, previous: null }; }
  catch (error) {
    if (!isConflict(error)) throw error;
    const reserved = await repo.get(key);
    if (!reserved) throw error;
    return read(reserved);
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

export function collectionSubmissions({ repo, env, now, getGateway, measure = (_name, run) => run() }) {
  const iso = () => new Date(now()).toISOString();
  const gateway = () => getGateway(oscaConfig(env));
  const receiptTokenFor = (id) => createHmac('sha256', env.PLATFORM_SESSION_SECRET).update('collection receipt: ' + id).digest('base64url');

  function attemptReceipt(attemptId, item, round, actor) {
    if (attemptId === undefined) return randomUUID();
    if (typeof attemptId !== 'string' || !submissionId.test(attemptId)) fail(400, 'INVALID_ATTEMPT_ID', '提交编号无效。');
    const digest = createHmac('sha256', env.PLATFORM_SESSION_SECRET)
      .update(JSON.stringify(['collection attempt', item.id, round.id, actor.id, attemptId])).digest('hex');
    return [digest.slice(0, 8), digest.slice(8, 12), digest.slice(12, 16), digest.slice(16, 20), digest.slice(20, 32)].join('-');
  }

  function submissionKey(receipt) {
    const { record, expectedRevision } = receipt;
    return revisionKey(keys.submission(record.itemId, record.roundId, record.id), expectedRevision + 1);
  }

  async function offer(context, receiptId, receipt, item, round, reservation) {
    const { record, pending, expiresAt, expectedRevision } = receipt;
    if (!pending.length) return {
      submission: submissionView(await commit(context, receiptId, receipt, { reservation }), item, round), uploads: [],
    };
    if (!reservation) {
      const quota = roundQuota(repo, item.id, round.id, now);
      const [committed, { active }] = await Promise.all([repo.get(submissionKey(receipt)), quota.read()]);
      if (committed?.receiptId === receiptId) return { submission: submissionView(committed, item, round), uploads: [] };
      if (committed) fail(409, 'REVISION_CONFLICT', '提交已发生变化，请刷新后重试。');
      if (!active[receiptId]) fail(410, 'SUBMISSION_EXPIRED', '这次上传超时了，请重新提交。');
    }
    const seconds = Math.ceil((expiresAt - now()) / 1000);
    if (seconds <= 0) fail(410, 'SUBMISSION_EXPIRED', '这次上传超时了，请重新提交。');
    const storage = gateway();
    const [uploads] = await Promise.all([mapConcurrent(pending, 6, async (file) => ({
      fileId: file.id,
      ...await storage.presignUpload({
        id: file.id, objectKey: file.objectKey, contentType: file.type, fileSize: file.size, fileName: file.name,
      }, Math.min(seconds, uploadSeconds)),
    })), measure('cleanup-record', () => queueCleanup(receiptId, receipt))]);
    const submission = { ...record, revision: expectedRevision, files: [...record.files, ...pending] };
    return { submission: submissionView(submission, item, round), receiptId, receiptToken: receiptTokenFor(receiptId), uploads };
  }

  async function begin(context, item, round, actor, receivedAt) {
    if (!isRecipient(item, actor)) fail(404, 'NOT_FOUND', '收集不存在或无权提交。');
    const body = await readJson(context.request);
    const sid = studentId(actor.studentId);
    if (!/^[A-Z0-9]{4,24}$/.test(sid)) fail(403, 'IDENTITY_REQUIRED', '请先完成学号认证。');
    const receiptId = attemptReceipt(body.attemptId, item, round, actor);
    const digest = createHash('sha256').update(JSON.stringify([body.answers, body.files, body.keepFiles])).digest('hex');
    const requestKey = keys.request(receiptId);
    const resume = (request) => {
      if (request.payloadDigest !== digest) fail(409, 'ATTEMPT_CHANGED', '此次提交的内容已改变，请重新提交。');
      return offer(context, receiptId, request, item, round);
    };
    const earlier = await repo.get(requestKey);
    if (earlier) return resume(earlier);
    if (!roundAcceptsSubmissions(item, round, receivedAt)) fail(409, 'COLLECTION_CLOSED', '本轮当前不接受提交。');
    const submittedAt = new Date(receivedAt).toISOString();
    const answers = answersInput(body.answers, round.fields);
    const stable = round.submissionMode === 'replace';
    const permitted = measure('rate', () => repo.throttle('collection-submit', actor.id, 15));
    const [{ id, previous: existing }] = await Promise.all([
      stable ? replacement(repo, item, round, sid, permitted) : { id: receiptId, previous: null },
      permitted,
    ]);
    if (existing && !ownsSubmission(existing, actor)) fail(409, 'IDENTITY_CHANGED', '此学号的既有提交需要管理员核对。');
    const kept = attachmentSelection(body, existing);
    const inputs = fileInput(body.files || [], round.fields, kept, round.maxTotalFileBytes);
    const configuration = inputs.length ? oscaConfig(env) : null;
    const issuedAt = iso();
    const quota = roundQuota(repo, item.id, round.id, now);
    const { entry, state: reservation } = await measure('upload-reserve', () => quota.reserve({
      id: receiptId, submissionId: id, studentId: sid, expectedRevision: existing?.revision ?? 0,
      expiresAt: now() + (inputs.length ? uploadSeconds * 1000 + confirmationMillis : 60_000), phase: 'pending',
    }, round));
    // Any request allowed past this point has a reservation visible to draft deletion.
    const current = await measure('definition-check', () => repo.latest(keys.definition(item.id)));
    if (current?.revision !== item.revision) await quota.cancel(receiptId);
    if (current?.status !== 'published') fail(409, 'COLLECTION_CLOSED', '本轮当前不接受提交。');
    if (current.revision !== item.revision) fail(409, 'REVISION_CONFLICT', '收集已更新，请刷新后重试。');
    const record = {
      id, itemId: item.id, roundId: round.id, userId: actor.id, studentId: sid,
      studentName: actor.realName || actor.nickname || sid, answers, fields: round.fields,
      status: 'uploading', createdAt: existing?.createdAt || submittedAt, submittedAt, updatedAt: issuedAt, files: kept,
      allowEdit: round.allowEdit, requireReview: round.requireReview, deadline: round.deadline,
      late: deadlineReached(round.deadline, receivedAt),
    };
    const objectPrefix = configuration ? roundObjectPrefix(configuration, { itemId: item.id, roundId: round.id }) : '';
    const pending = inputs.map((file) => ({ ...file, objectKey: objectPrefix + 'staging/' + receiptId + '/' + file.id + '.' + file.extension }));
    const receipt = {
      expiresAt: inputs.length ? entry.expiresAt - confirmationMillis : entry.expiresAt,
      record, pending, objectPrefix, expectedRevision: entry.expectedRevision, payloadDigest: digest,
      discarded: existing?.files.filter((file) => !kept.some((saved) => saved.id === file.id))
        .map(({ id, objectKey }) => ({ id, objectKey })) || [],
    };
    try { await measure('receipt-write', () => repo.putNew(requestKey, receipt)); }
    catch (error) {
      if (!isConflict(error)) throw error;
      const winner = await repo.get(requestKey);
      if (!winner) throw error;
      return resume(winner);
    }
    return offer(context, receiptId, receipt, item, round, reservation);
  }

  async function ticket(context, id) {
    if (!submissionId.test(id)) fail(404, 'NOT_FOUND', '这次上传找不到了，请重新提交。');
    const body = await readJson(context.request);
    const token = body.receiptToken;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(receiptTokenFor(id)))) {
      fail(403, 'RECEIPT_REJECTED', '这次上传已经失效，请重新提交。');
    }
    const receipt = await repo.get(keys.request(id));
    if (!receipt) fail(403, 'RECEIPT_REJECTED', '这次上传已经失效，请重新提交。');
    return receipt;
  }

  async function queueCleanup(id, receipt) {
    const { record, pending, expectedRevision, expiresAt } = receipt;
    const discarded = receipt.discarded ?? (expectedRevision ? (
      (await repo.get(revisionKey(keys.submission(record.itemId, record.roundId, record.id), expectedRevision)))?.files
        .filter((file) => !record.files.some((kept) => kept.objectKey === file.objectKey))
        .map(({ id, objectKey }) => ({ id, objectKey }))
    ) : []);
    if (!pending.length && !discarded?.length) return;
    const key = keys.cleanup(record.itemId, record.roundId, id);
    try {
      await repo.putNew(key, { id, target: submissionKey(receipt), discarded: discarded || [],
        staging: pending.map((file) => file.objectKey), expiresAt });
    } catch (error) { if (!isConflict(error)) throw error; }
  }

  async function queueCandidates(id, receipt, candidates) {
    const { itemId, roundId } = receipt.record;
    await repo.putNew(keys.cleanup(itemId, roundId, randomUUID()), {
      id, target: submissionKey(receipt), discarded: [], staging: [], candidates, expiresAt: 0,
    });
  }

  async function cleanupLater(context, itemId, roundId, settled, exclude) {
    const controller = new AbortController();
    const { signal } = controller;
    async function run() {
      const prefix = keys.cleanup(itemId, roundId);
      const paths = settled ? [keys.cleanup(itemId, roundId, settled.id)] : (await repo.list(prefix))
        .filter(key => !exclude || key !== keys.cleanup(itemId, roundId, exclude)).slice(0, 8);
      if (!paths.length) return;
      const { active } = settled ? { active: {} } : await roundQuota(repo, itemId, roundId, now).read();
      signal.throwIfAborted();
      const configuration = oscaConfig(env);
      const storage = getGateway(configuration);
      const objectPrefix = roundObjectPrefix(configuration, { itemId, roundId });
      const finalPrefix = objectPrefix + 'final/';
      await mapConcurrent(paths, 8, async (key) => {
        const task = await repo.get(key);
        if (!task || task.id === exclude || (task.cleaned && now() < task.expiresAt + 1000)) return;
        signal.throwIfAborted();
        const winner = settled ? settled.winner : await repo.get(task.target);
        if (!winner && active[task.id]) return;
        const discarded = !task.cleaned && winner?.receiptId === task.id
          ? task.discarded.filter((file) => ownsFinalObject(file, finalPrefix)).map((file) => file.objectKey) : [];
        const stagePrefix = objectPrefix + 'staging/' + task.id + '/';
        const staging = task.staging.filter((objectKey) => objectKey.startsWith(stagePrefix));
        const candidates = (task.candidates || []).filter((objectKey) =>
          objectKey.startsWith(finalPrefix + task.id + '/') && !winner?.files.some((file) => file.objectKey === objectKey));
        const remove = [...discarded, ...staging, ...candidates];
        signal.throwIfAborted();
        const result = await Promise.allSettled(remove.map((objectKey) => storage.delete(objectKey, signal)));
        if (result.some((entry) => entry.status === 'rejected')) return;
        signal.throwIfAborted();
        if (!task.staging.length || now() >= task.expiresAt + 1000) await repo.remove(key);
        else await repo.put(key, { ...task, cleaned: true });
      });
    }
    // The durable task stays available for the next sweep if storage is slow.
    // Cleanup must not hold an authorization, a committed receipt or a board open.
    const background = typeof context.waitUntil === 'function';
    let timer;
    const budget = new Promise((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(); }, background ? 8000 : 1200);
    });
    const job = measure(settled ? 'cleanup-current' : 'cleanup-previous', () => Promise.race([run(), budget]))
      .catch(() => {}).finally(() => clearTimeout(timer));
    if (background) context.waitUntil(job);
    else await job;
  }

  async function commit(context, id, receipt, { enforceRate = false, reservation } = {}) {
    const { record, pending, objectPrefix, expectedRevision } = receipt;
    const target = submissionKey(receipt);
    const quota = roundQuota(repo, record.itemId, record.roundId, now);
    let sweep;
    function sweepOlderUploads() {
      if (enforceRate) sweep ??= cleanupLater(context, record.itemId, record.roundId, undefined, id);
      return sweep;
    }
    async function finish(value, snapshot) {
      await Promise.all([
        measure('quota', () => quota.saved(id, snapshot)).catch(() => {}),
        pending.length || receipt.discarded?.length
          ? cleanupLater(context, record.itemId, record.roundId, { id, winner: value }) : null,
        sweepOlderUploads(),
      ]);
      return value;
    }
    const [current, quotaState] = reservation ? [null, reservation] :
      await measure('prepare', () => Promise.all([repo.get(target), quota.read()]));
    if (current?.receiptId === id) return finish(current, quotaState);
    if (current) {
      await quota.discard(id, quotaState);
      fail(409, 'REVISION_CONFLICT', '提交已发生变化，请刷新后重试。');
    }
    const active = quotaState.active[id];
    if (!active || now() >= active.expiresAt) {
      const winner = await repo.get(target);
      if (winner?.receiptId === id) return finish(winner, quotaState);
      fail(410, 'SUBMISSION_EXPIRED', '本次提交已取消或过期。');
    }
    if (enforceRate) await measure('rate', () => repo.throttle('collection-complete', record.userId, 60));
    // Recover earlier uploads alongside this confirmation's object checks.
    // Its own staging objects stay outside the sweep until settlement.
    sweepOlderUploads();
    // An upload token was issued only after its durable cleanup task existed.
    // A direct text save can still be replacing files from an earlier receipt.
    if (!pending.length) await queueCleanup(id, receipt);
    const storage = pending.length ? gateway() : null;
    const candidates = [];
    let disposable = true;
    try {
      const publishIndex = () => measure('publish-index', () => locateSubmission(repo, record)).catch(error => ({ error }));
      let index = pending.length ? undefined : publishIndex();
      let checked = 0;
      const copies = await mapConcurrent(pending, 5, async ({ extension, ...file }) => {
        const head = await measure('staging-head', () => storage.head(file.objectKey));
        if (!matchingObject(head, file)) fail(409, 'UPLOAD_MISMATCH', '附件尚未就绪，或内容与声明不一致。');
        if (++checked === pending.length) index = publishIndex();
        const final = objectPrefix + 'final/' + id + '/' + file.id + '/' + randomUUID();
        candidates.push(final);
        await measure('copy', () => storage.copy(file.objectKey, final, head.etag));
        const archived = await measure('final-head', () => storage.head(final));
        if (!matchingObject(archived, file) || archived.etag !== head.etag) fail(409, 'UPLOAD_CHANGED', '附件在确认期间发生变化。');
        return { ...file, objectKey: final, etag: head.etag };
      }).finally(async () => {
        // Started copies and the index write must settle before candidates can
        // be removed or the authoritative submission revision is published.
        await index;
      });
      const failedIndex = await index;
      if (failedIndex) throw failedIndex.error;
      const saving = await measure('reserve', () => quota.authoriseSave(id, quotaState));
      const value = { ...record, receiptId: id, files: [...record.files, ...copies], late: submissionWasLate(record),
        status: submissionStatus(record), updatedAt: iso(),
      };
      // A transport error can conceal a successful commit. Retain the candidate
      // objects until the occupied immutable revision proves who owns them.
      disposable = false;
      // The receipt captures the verified predecessor and quota admits one
      // potential writer. The conditional next revision also settles retries.
      const committed = await measure('write', () => repo.putNew(target, { ...value, revision: expectedRevision + 1 }));
      return await finish(committed, saving);
    } catch (error) {
      // Another confirmation can finish and remove staging while this one is
      // still reading it. A matching committed receipt settles both requests.
      if (!isConflict(error) && error.code !== 'SUBMISSION_EXPIRED') {
        if (!disposable && candidates.length) await queueCandidates(id, receipt, candidates).catch(() => {});
        throw error;
      }
      const winner = await repo.get(target);
      if (winner) disposable = !winner.files.some((file) => candidates.includes(file.objectKey));
      if (winner?.receiptId !== id) throw error;
      return await finish(winner);
    } finally {
      if (disposable && candidates.length) {
        const attempts = await Promise.allSettled(candidates.map((path) => storage.delete(path, AbortSignal.timeout(1200))));
        const failed = candidates.filter((_, index) => attempts[index].status === 'rejected');
        if (failed.length) await queueCandidates(id, receipt, failed).catch(() => {});
      }
      await sweep;
    }
  }

  async function complete(context, id) {
    const receipt = await ticket(context, id);
    return receiptView(await commit(context, id, receipt, { enforceRate: true }));
  }

  async function cancel(context, id) {
    const receipt = await ticket(context, id);
    const { itemId, roundId } = receipt.record;
    const quota = roundQuota(repo, itemId, roundId, now);
    const target = submissionKey(receipt);
    let [current, snapshot] = await Promise.all([repo.get(target), quota.read()]);
    if (current?.receiptId === id) fail(409, 'SUBMISSION_COMMITTED', '这次提交已经保存。');
    if (!receipt.pending.length) await queueCleanup(id, receipt);
    if (current) await quota.discard(id, snapshot);
    else if (!await quota.cancel(id, snapshot)) {
      // The committed revision can appear between the target and quota reads.
      current = await repo.get(target);
      if (current?.receiptId === id) fail(409, 'SUBMISSION_COMMITTED', '这次提交已经保存。');
    }
    await Promise.all([
      cleanupLater(context, itemId, roundId, { id, winner: current }),
      cleanupLater(context, itemId, roundId, undefined, id),
    ]);
    return { cancelled: true };
  }

  async function change(request, record, item, round, actor, action, receivedAt) {
    const body = await readJson(request);
    const updatedAt = iso();
    const next = { ...record, updatedAt, late: submissionWasLate(record) };
    if (action === 'edit') {
      if (!canEditSubmission(record, item, round, actor, receivedAt)) fail(409, 'EDIT_CLOSED', '本轮当前不允许修改。');
      if (body.files !== undefined) fail(400, 'FILES_IMMUTABLE', '请在本轮重新提交附件。');
      next.answers = answersInput(body.answers, record.fields);
      if (deadlineReached(round.deadline, receivedAt)) {
        next.deadline = round.deadline;
        next.submittedAt = new Date(receivedAt).toISOString();
        next.late = true;
      }
      next.status = submissionStatus(next);
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

  async function download(record, file, expiresIn = 60) {
    if (!file) fail(404, 'NOT_FOUND', '附件不存在。');
    const config = oscaConfig(env);
    if (!ownsFinalObject(file, roundObjectPrefix(config, record) + 'final/') || !strongETag(file.etag)) {
      fail(409, 'OBJECT_CHANGED', '附件归档信息无效。');
    }
    // The signed GET carries If-Match. A storage round trip here would add
    // latency while still leaving a race between a HEAD and the actual GET.
    return getGateway(config).presignDownload({ fileName: file.name, finalObjectKey: file.objectKey }, file.etag, expiresIn);
  }
  return { begin, complete, cancel, change, download };
}
