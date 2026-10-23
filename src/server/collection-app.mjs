import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { digest, mac, openSession, safeEqual, sealSession, validPasswordHash, verifyPassword } from './collection-auth.mjs';

const API = '/api/collection';
const MAX_JSON_BYTES = 16 * 1024;
const SESSION_SECONDS = 7200;
const UPLOAD_SECONDS = 300;
const ID_RE = /^\d{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DEFAULT_EXTENSIONS = 'pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,md,zip,7z,rar,jpg,jpeg,png,webp,gif,mp3,mp4,mov';

export class CollectionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) { throw new CollectionError(status, code, message); }
function integer(value, fallback, min, max) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(503, 'NOT_CONFIGURED', '收件服务配置无效，暂未开放。');
  return n;
}

export function collectionConfig(env = {}) {
  if (String(env.COLLECTION_ENABLED) !== 'true') fail(503, 'NOT_OPEN', '收件服务暂未开放。');
  let origin;
  let endpoint;
  try {
    origin = new URL(env.COLLECTION_ORIGIN);
    endpoint = new URL(env.OSCA_ENDPOINT);
  } catch { fail(503, 'NOT_CONFIGURED', '收件服务配置尚未完成。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    fail(503, 'NOT_CONFIGURED', '收件服务配置无效，暂未开放。');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    fail(503, 'NOT_CONFIGURED', '存储服务配置无效，暂未开放。');
  }
  if (!validPasswordHash(env.COLLECTION_ADMIN_HASH) || !validPasswordHash(env.COLLECTION_INVITE_HASH) || String(env.COLLECTION_SESSION_SECRET || '').length < 32) {
    fail(503, 'NOT_CONFIGURED', '收件服务认证配置尚未完成。');
  }
  if (![env.OSCA_BUCKET, env.OSCA_ACCESS_KEY_ID, env.OSCA_SECRET_ACCESS_KEY].every((value) => typeof value === 'string' && value.length > 0)) {
    fail(503, 'NOT_CONFIGURED', '收件服务存储配置尚未完成。');
  }
  if (!/^[a-zA-Z0-9._-]{1,150}$/.test(env.OSCA_BUCKET)) fail(503, 'NOT_CONFIGURED', '存储服务配置无效，暂未开放。');
  const collectionId = String(env.COLLECTION_ID || 'club-2026');
  const prefix = String(env.OSCA_PREFIX || 'studev-submissions/');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(collectionId) || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(prefix)) fail(503, 'NOT_CONFIGURED', '收件目录配置无效，暂未开放。');
  const maxFileBytes = integer(env.COLLECTION_MAX_FILE_BYTES, 20 * 1024 * 1024, 1, 100 * 1024 * 1024);
  const maxSubmissions = integer(env.COLLECTION_MAX_SUBMISSIONS, 500, 1, 1000);
  const extensions = String(env.COLLECTION_ALLOWED_EXTENSIONS || DEFAULT_EXTENSIONS).split(',').map((s) => s.trim().toLowerCase());
  if (extensions.some((s) => !/^[a-z0-9]{1,10}$/.test(s))) fail(503, 'NOT_CONFIGURED', '收件类型配置无效，暂未开放。');
  return {
    origin: origin.origin, local, endpoint: endpoint.origin, bucket: env.OSCA_BUCKET,
    accessKeyId: env.OSCA_ACCESS_KEY_ID, secretAccessKey: env.OSCA_SECRET_ACCESS_KEY,
    region: env.OSCA_REGION || 'us-east-1', objectPrefix: `${prefix}${collectionId}/`,
    collectionId, metadataPrefix: `collections/${collectionId}/`,
    adminHash: env.COLLECTION_ADMIN_HASH, inviteHash: env.COLLECTION_INVITE_HASH,
    sessionSecret: env.COLLECTION_SESSION_SECRET, maxFileBytes, maxSubmissions,
    title: String(env.COLLECTION_TITLE || '社团资料收集').slice(0, 100),
    instructions: String(env.COLLECTION_INSTRUCTIONS || '请填写提交信息，并上传本次活动所需资料。').slice(0, 500),
    extensions, cookieName: local ? 'studev_admin_dev' : '__Host-studev_admin',
  };
}

function response(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...extraHeaders,
  } });
}

async function jsonBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, 'JSON_REQUIRED', '请以 JSON 格式提交。');
  if (Number(request.headers.get('content-length')) > MAX_JSON_BYTES) fail(413, 'BODY_TOO_LARGE', '提交信息过长。');
  let bytes;
  // The official Node wrapper replaces Request.body with a parsed JSON object and preloads
  // the original bytes here. Never trust that parsed object or call getReader() on it.
  const preloaded = request._rawBodyBuffer;
  if (Buffer.isBuffer(preloaded) || preloaded instanceof Uint8Array) {
    if (preloaded.byteLength > MAX_JSON_BYTES) fail(413, 'BODY_TOO_LARGE', '提交信息过长。');
    bytes = Buffer.from(preloaded.buffer, preloaded.byteOffset, preloaded.byteLength);
  } else {
    // Read the native stream through its prototype getter, bypassing the platform's own getter.
    const bodyGetter = Object.getOwnPropertyDescriptor(Request.prototype, 'body')?.get;
    let stream;
    try { stream = bodyGetter?.call(request); } catch { fail(400, 'INVALID_JSON', '缺少提交信息。'); }
    const reader = stream?.getReader();
    if (!reader) fail(400, 'INVALID_JSON', '缺少提交信息。');
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_JSON_BYTES) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', '提交信息过长。'); }
      chunks.push(Buffer.from(value));
    }
    bytes = Buffer.concat(chunks);
  }
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { fail(400, 'INVALID_JSON', '提交信息不是有效的 JSON。'); }
}

function text(value, field, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) fail(400, 'INVALID_FIELD', `${field}填写不正确。`);
  return value.trim();
}

function requireOrigin(request, config) {
  if (request.headers.get('origin') !== config.origin) fail(403, 'ORIGIN_REJECTED', '请从本站页面操作。');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) fail(403, 'ORIGIN_REJECTED', '请从本站页面操作。');
}

function cookie(token, config, maxAge = SESSION_SECONDS) {
  return `${config.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.local ? '' : '; Secure'}`;
}

function readCookie(request, name) {
  return request.headers.get('cookie')?.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

function conflict(error) {
  return error?.status === 409 || error?.statusCode === 409 || [409, 412].includes(error?.$metadata?.httpStatusCode) || /already exists|precondition|conflict|onlyifnew/i.test(String(error?.message || error?.name || ''));
}

function publicItem(record, completion, review) {
  return {
    id: record.id, name: record.name, contact: record.contact, description: record.description,
    fileName: record.fileName, fileSize: record.fileSize, contentType: record.contentType,
    status: completion ? (review?.status || 'pending_review') : 'uploading',
    createdAt: record.createdAt, completedAt: completion?.completedAt || null,
    revision: review?.revision || 0, reviewComment: review?.comment || '', reviewedAt: review?.reviewedAt || null,
  };
}

// Dependencies are injected so authorization and state transitions are testable without cloud credentials.
export function createCollectionHandler({ getStore, getGateway, now = () => Date.now() }) {
  return async function handle(context) {
    try {
      const config = collectionConfig(context.env);
      const request = context.request;
      const url = new URL(request.url);
      const route = url.pathname.replace(/\/$/, '');
      const method = request.method;
      if (!route.startsWith(`${API}/`)) fail(404, 'NOT_FOUND', '接口不存在。');
      if (method !== 'GET' && method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
      if (method === 'POST') requireOrigin(request, config);
      const seconds = () => Math.floor(now() / 1000);
      const key = (suffix) => `${config.metadataPrefix}${suffix}`;
      let storeInstance;
      let gatewayInstance;
      const store = () => (storeInstance ||= getStore(config));
      const gateway = () => (gatewayInstance ||= getGateway(config));

      async function getJson(name) { return store().get(key(name), { type: 'json' }); }
      async function putNew(name, value) {
        return store().setJSON(key(name), value, { onlyIfNew: true });
      }

      // Atomic short-lived rate tickets work across function instances. Old windows are cleaned in bounded batches.
      async function throttle(scope, limit) {
        const minute = Math.floor(seconds() / 60);
        const client = mac(config.sessionSecret, `${scope}:${context.clientIp || 'unknown-client'}`).slice(0, 32);
        const prefix = `rate/${scope}/${client}/`;
        for (let index = 0; index < limit; index++) {
          const name = `${prefix}${minute}-${String(index).padStart(2, '0')}.json`;
          try {
            await putNew(name, { expiresAt: seconds() + 120 });
            const { blobs } = await store().list({ prefix: key(prefix), paginate: false });
            const stale = blobs.filter((blob) => Number(blob.key.slice(key(prefix).length).split('-')[0]) < minute - 2).slice(0, 40);
            await Promise.all(stale.map((blob) => store().delete(blob.key)));
            return;
          } catch (error) { if (!conflict(error)) throw error; }
        }
        fail(429, 'RATE_LIMITED', '操作过于频繁，请稍后再试。');
      }

      async function admin(requireCsrf = false) {
        const payload = openSession(readCookie(request, config.cookieName), config.sessionSecret, seconds());
        if (!payload || payload.collectionId !== config.collectionId) fail(401, 'AUTH_REQUIRED', '请先登录管理员账号。');
        const saved = await getJson(`sessions/${payload.sid}.json`);
        if (!saved || saved.exp !== payload.exp || saved.exp <= seconds()) fail(401, 'AUTH_REQUIRED', '登录已失效，请重新登录。');
        const csrfToken = mac(config.sessionSecret, `csrf:${payload.sid}`);
        if (requireCsrf && !safeEqual(request.headers.get('x-csrf-token') || '', csrfToken)) fail(403, 'CSRF_REJECTED', '操作验证失效，请刷新后重试。');
        return { payload, csrfToken };
      }

      async function readRecord(id) {
        if (!ID_RE.test(id)) fail(404, 'NOT_FOUND', '提交记录不存在。');
        const record = await getJson(`entries/${id}.json`);
        if (!record) fail(404, 'NOT_FOUND', '提交记录不存在。');
        return record;
      }

      async function latestReview(id) {
        const prefix = key(`reviews/${id}/`);
        const { blobs } = await store().list({ prefix });
        const newest = blobs.map((blob) => blob.key).sort().at(-1);
        return newest ? store().get(newest, { type: 'json' }) : null;
      }

      async function item(record) {
        const [completion, review] = await Promise.all([getJson(`completed/${record.id}.json`), latestReview(record.id)]);
        return publicItem(record, completion, review);
      }

      if (route === `${API}/config` && method === 'GET') {
        return response({ available: true, collection: { title: config.title, instructions: config.instructions, maxFileBytes: config.maxFileBytes, allowedExtensions: config.extensions } });
      }

      if (route === `${API}/admin/login` && method === 'POST') {
        await throttle('login', 5);
        const body = await jsonBody(request);
        if (!await verifyPassword(body.password, config.adminHash)) fail(401, 'LOGIN_FAILED', '管理员密码不正确。');
        const payload = { v: 1, role: 'admin', sid: randomBytes(24).toString('hex'), iat: seconds(), exp: seconds() + SESSION_SECONDS, collectionId: config.collectionId };
        await putNew(`sessions/${payload.sid}.json`, { exp: payload.exp });
        return response({ authenticated: true, csrfToken: mac(config.sessionSecret, `csrf:${payload.sid}`) }, 200, { 'Set-Cookie': cookie(sealSession(payload, config.sessionSecret), config) });
      }

      if (route === `${API}/admin/session` && method === 'GET') {
        const session = await admin();
        return response({ authenticated: true, csrfToken: session.csrfToken });
      }

      if (route === `${API}/admin/logout` && method === 'POST') {
        const session = await admin(true);
        await store().delete(key(`sessions/${session.payload.sid}.json`));
        return response({ ok: true }, 200, { 'Set-Cookie': cookie('', config, 0) });
      }

      if (route === `${API}/submissions` && method === 'POST') {
        await throttle('submit', 10);
        const body = await jsonBody(request);
        if (!await verifyPassword(body.inviteCode, config.inviteHash)) fail(403, 'INVITE_REJECTED', '收件码不正确。');
        const name = text(body.name, '姓名或团队名', 80, true);
        const contact = text(body.contact, '联系方式', 160);
        const description = text(body.description, '说明', 1200);
        if (!body.file || typeof body.file !== 'object') fail(400, 'INVALID_FILE', '请选择要提交的文件。');
        const fileName = text(body.file.name, '文件名', 180, true);
        if (/[\/\\\r\n]/.test(fileName) || fileName === '.' || fileName === '..') fail(400, 'INVALID_FILE', '文件名不正确。');
        const extension = fileName.includes('.') ? fileName.split('.').at(-1).toLowerCase() : '';
        if (!config.extensions.includes(extension)) fail(400, 'FILE_TYPE_REJECTED', '暂不接受此文件类型，请按活动要求打包或转换。');
        const fileSize = body.file.size;
        if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > config.maxFileBytes) fail(400, 'FILE_TOO_LARGE', '文件为空或超过本次收件上限。');
        const contentType = body.file.type || 'application/octet-stream';
        if (typeof contentType !== 'string' || contentType.length > 120 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(contentType)) fail(400, 'INVALID_FILE', '文件类型不正确。');
        const id = `${String(9999999999999 - now()).padStart(13, '0')}-${randomUUID()}`;
        const receiptToken = randomBytes(32).toString('base64url');
        const record = { id, name, contact, description, fileName, fileSize, contentType, objectKey: `${config.objectPrefix}staging/${id}.${extension}`, receiptHash: digest(receiptToken), createdAt: new Date(now()).toISOString(), uploadExpiresAt: seconds() + UPLOAD_SECONDS };
        // A fixed number of atomic tickets bounds accepted reservations even under concurrent requests.
        // Tickets cap upload authorizations over the entire collection lifetime, including abandoned uploads.
        // Never recycle them while an issued PUT URL could still be used or an old request could be completing.
        let reserved = false;
        const quotaPrefix = key('quota/');
        const { blobs: quotaBlobs } = await store().list({ prefix: quotaPrefix });
        const occupied = new Set(quotaBlobs.map((blob) => Number(blob.key.slice(quotaPrefix.length).replace(/\.json$/, ''))));
        const freeSlots = Array.from({ length: config.maxSubmissions }, (_, index) => index).filter((slot) => !occupied.has(slot));
        // List once, then claim conditionally. Do not perform hundreds of sequential reads near capacity.
        const start = freeSlots.length ? randomInt(freeSlots.length) : 0;
        for (let attempt = 0; attempt < freeSlots.length; attempt++) {
          const slot = freeSlots[(start + attempt) % freeSlots.length];
          const slotKey = `quota/${String(slot).padStart(4, '0')}.json`;
          try { await putNew(slotKey, { id, createdAt: record.createdAt }); reserved = true; break; }
          catch (error) { if (!conflict(error)) throw error; }
        }
        if (!reserved) fail(409, 'COLLECTION_FULL', '本次收件名额已满，请联系管理员。');
        await putNew(`entries/${id}.json`, record);
        const upload = await gateway().presignUpload(record, UPLOAD_SECONDS);
        return response({ item: publicItem(record), receiptToken, upload }, 201);
      }

      const completeMatch = route.match(/^\/api\/collection\/submissions\/([^/]+)\/complete$/);
      if (completeMatch && method === 'POST') {
        await throttle('complete', 30);
        const body = await jsonBody(request);
        const record = await readRecord(completeMatch[1]);
        if (typeof body.receiptToken !== 'string' || body.receiptToken.length > 256 || !safeEqual(digest(body.receiptToken), record.receiptHash)) fail(403, 'RECEIPT_REJECTED', '提交凭证不正确。');
        const existing = await getJson(`completed/${record.id}.json`);
        if (existing) return response({ item: await item(record) });
        if (seconds() > record.uploadExpiresAt + 3600) fail(410, 'SUBMISSION_EXPIRED', '该次上传已过期，请联系管理员。');
        const head = await gateway().head(record.objectKey);
        if (!head || head.size !== record.fileSize || head.size > config.maxFileBytes || !/^"[^"\r\n]+"$/.test(head.etag || '') || head.contentType !== record.contentType) fail(409, 'UPLOAD_MISMATCH', '存储中的文件尚未就绪或与申报信息不一致，请联系管理员。');
        // OSCA does not enforce PUT If-None-Match: the visitor's staging URL remains reusable until expiry.
        // Freeze a separate object that has never received visitor PUT authority before publishing completion.
        // Each concurrent attempt has its own key; only the atomic completion winner is downloadable.
        const finalObjectKey = `${config.objectPrefix}final/${record.id}/${randomUUID()}`;
        let removeCandidate = true;
        try {
          await gateway().copy(record.objectKey, finalObjectKey, head.etag);
          const finalHead = await gateway().head(finalObjectKey);
          if (!finalHead || finalHead.etag !== head.etag || finalHead.size !== head.size || finalHead.contentType !== head.contentType) {
            fail(409, 'UPLOAD_CHANGED', '上传内容在确认期间发生变化，请重新确认提交。');
          }
          const completion = { completedAt: new Date(now()).toISOString(), etag: finalHead.etag, size: finalHead.size, contentType: finalHead.contentType, finalObjectKey };
          // A failed transport response can hide a successful metadata write. Retain the candidate on
          // ambiguous errors so a delayed successful publication can never reference a deleted object.
          removeCandidate = false;
          try { await putNew(`completed/${record.id}.json`, completion); }
          catch (error) {
            if (!conflict(error)) throw error;
            const winner = await getJson(`completed/${record.id}.json`);
            if (!winner) throw error;
            removeCandidate = winner.finalObjectKey !== finalObjectKey;
          }
          return response({ item: await item(record) });
        } finally {
          if (removeCandidate) {
            // Cleanup has no influence on the accepted object; failed cleanup leaves only an unreachable copy.
            try { await gateway().delete(finalObjectKey); } catch { /* Best effort: never log credentials/URLs. */ }
          }
        }
      }

      if (route === `${API}/admin/submissions` && method === 'GET') {
        await admin();
        const after = url.searchParams.get('cursor') || '';
        if (after && !ID_RE.test(after)) fail(400, 'INVALID_CURSOR', '分页参数无效。');
        const { blobs } = await store().list({ prefix: key('entries/') });
        const ids = blobs.map((blob) => blob.key.slice(key('entries/').length).replace(/\.json$/, '')).filter((id) => ID_RE.test(id) && (!after || id > after)).sort();
        const selected = ids.slice(0, 25);
        const items = await Promise.all(selected.map(async (id) => item(await readRecord(id))));
        return response({ items, cursor: ids.length > selected.length ? selected.at(-1) : null });
      }

      const reviewMatch = route.match(/^\/api\/collection\/admin\/submissions\/([^/]+)\/review$/);
      if (reviewMatch && method === 'POST') {
        await admin(true);
        const body = await jsonBody(request);
        const record = await readRecord(reviewMatch[1]);
        if (!await getJson(`completed/${record.id}.json`)) fail(409, 'UPLOAD_INCOMPLETE', '文件尚未完成提交。');
        if (!['accepted', 'rejected'].includes(body.status)) fail(400, 'INVALID_STATUS', '审核状态无效。');
        const review = await latestReview(record.id);
        const revision = review?.revision || 0;
        if (body.revision !== revision || revision >= 999) fail(409, 'REVISION_CONFLICT', '记录已更新，请刷新后重试。');
        const next = { revision: revision + 1, status: body.status, comment: text(body.comment, '审核说明', 1000), reviewedAt: new Date(now()).toISOString() };
        try { await putNew(`reviews/${record.id}/${String(next.revision).padStart(4, '0')}.json`, next); }
        catch (error) { if (conflict(error)) fail(409, 'REVISION_CONFLICT', '记录已更新，请刷新后重试。'); throw error; }
        return response({ item: await item(record) });
      }

      const downloadMatch = route.match(/^\/api\/collection\/admin\/submissions\/([^/]+)\/download$/);
      if (downloadMatch && method === 'POST') {
        await admin(true);
        const record = await readRecord(downloadMatch[1]);
        const completed = await getJson(`completed/${record.id}.json`);
        if (!completed) fail(409, 'UPLOAD_INCOMPLETE', '文件尚未完成提交。');
        // Legacy completion rows that reference mutable staging objects fail closed.
        if (typeof completed.finalObjectKey !== 'string' || !completed.finalObjectKey.startsWith(`${config.objectPrefix}final/${record.id}/`)) fail(409, 'OBJECT_CHANGED', '文件尚未完成安全归档，请联系管理员核查。');
        const head = await gateway().head(completed.finalObjectKey);
        if (!head || head.etag !== completed.etag || head.size !== completed.size || head.contentType !== completed.contentType) fail(409, 'OBJECT_CHANGED', '文件在提交后发生变化，暂不可下载，请联系管理员核查。');
        return response({ download: await gateway().presignDownload({ ...record, finalObjectKey: completed.finalObjectKey }, completed.etag, 60) });
      }
      fail(404, 'NOT_FOUND', '接口不存在。');
    } catch (error) {
      if (error instanceof CollectionError) return response({ error: { code: error.code, message: error.message }, available: false }, error.status);
      // Storage messages/stacks can contain signed URLs and credentials. Log only bounded identifiers
      // and an HTTP status, never the original error object or its message/stack/cause.
      const errorIdentifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : 'UNKNOWN';
      const errorStatus = error?.$metadata?.httpStatusCode ?? error?.statusCode ?? error?.status;
      console.error('collection-service-error', {
        name: errorIdentifier(error?.name), code: errorIdentifier(error?.code),
        ...(Number.isInteger(errorStatus) && errorStatus >= 100 && errorStatus <= 599 ? { status: errorStatus } : {}),
      });
      return response({ error: { code: 'SERVICE_UNAVAILABLE', message: '收件服务暂时不可用，请稍后重试。' } }, 503);
    }
  };
}
