import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail, readJson, requireOrigin, response, text } from './platform-common.mjs';
import { isConflict } from './platform-store.mjs';

const API = '/api/platform';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_FILE = 20 * 1024 * 1024;
const EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'zip', '7z', 'rar', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'mp4', 'mov'];
const TYPES = ['text', 'textarea', 'select', 'checkbox', 'number', 'date', 'file'];
const hash = (v) => createHash('sha256').update(v).digest('hex');
const validObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function integer(value, fallback, min, max, label) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < min || result > max) fail(400, 'INVALID_FIELD', `${label}必须为 ${min}–${max} 的整数。`);
  return result;
}
function boolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(400, 'INVALID_FIELD', '开关设置无效。');
  return value;
}
function date(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, 'INVALID_FIELD', `${label}日期无效。`);
  return value;
}
function fields(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) fail(400, 'INVALID_FIELDS', '请设置 1–30 个字段。');
  const ids = new Set();
  return value.map((input) => {
    if (!validObject(input) || !/^[a-z][a-z0-9_]{0,31}$/.test(input.id) || ids.has(input.id) || !TYPES.includes(input.type)) fail(400, 'INVALID_FIELDS', '字段类型或标识无效、重复。');
    ids.add(input.id);
    const f = { id: input.id, type: input.type, label: text(input.label, '字段名称', 100, true), description: text(input.description, '字段说明', 500), required: boolean(input.required) };
    if (['text', 'textarea'].includes(f.type)) f.maxLength = integer(input.maxLength, f.type === 'text' ? 200 : 2000, 1, f.type === 'text' ? 1000 : 10000, '文字长度');
    if (['select', 'checkbox'].includes(f.type)) {
      if (!Array.isArray(input.options) || input.options.length < 1 || input.options.length > 30) fail(400, 'INVALID_OPTIONS', '请设置 1–30 个选项。');
      f.options = input.options.map((v) => text(v, '选项', 160, true));
      if (new Set(f.options).size !== f.options.length) fail(400, 'INVALID_OPTIONS', '选项不能重复。');
    }
    if (f.type === 'number') {
      for (const property of ['min', 'max']) if (input[property] !== undefined && input[property] !== null && input[property] !== '') {
        if (typeof input[property] !== 'number' || !Number.isFinite(input[property]) || Math.abs(input[property]) > Number.MAX_SAFE_INTEGER) fail(400, 'INVALID_RANGE', '数字范围无效。');
        f[property] = input[property];
      }
      if (f.min !== undefined && f.max !== undefined && f.min > f.max) fail(400, 'INVALID_RANGE', '最小值不能大于最大值。');
    }
    if (f.type === 'file') {
      f.maxFiles = integer(input.maxFiles, 1, 1, 5, '附件数量');
      f.maxFileBytes = integer(input.maxFileBytes, MAX_FILE, 1, MAX_FILE, '单附件大小');
      if (input.extensions !== undefined && (!Array.isArray(input.extensions) || !input.extensions.length || input.extensions.length > 40)) fail(400, 'INVALID_EXTENSIONS', '请填写允许的文件扩展名。');
      f.extensions = (input.extensions || EXTENSIONS).map((v) => typeof v === 'string' ? v.toLowerCase().replace(/^\./, '') : '');
      if (f.extensions.some((v) => !/^[a-z0-9]{1,10}$/.test(v))) fail(400, 'INVALID_EXTENSIONS', '文件扩展名无效。');
      f.extensions = [...new Set(f.extensions)];
    }
    return f;
  });
}
function formInput(body) {
  if (!['draft', 'published', 'closed', 'archived'].includes(body.status ?? 'draft') || !['public', 'members'].includes(body.access ?? 'members')) fail(400, 'INVALID_FIELD', '表单状态或访问权限无效。');
  let deadline = '';
  if (body.deadline) {
    if (typeof body.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(body.deadline) || !Number.isFinite(Date.parse(body.deadline))) fail(400, 'INVALID_DEADLINE', '截止时间无效。');
    deadline = new Date(body.deadline).toISOString();
  }
  return { title: text(body.title, '表单名称', 100, true), description: text(body.description, '表单说明', 5000), status: body.status ?? 'draft', access: body.access ?? 'members', deadline, requireReview: boolean(body.requireReview), allowEdit: boolean(body.allowEdit), maxPerUser: integer(body.maxPerUser, 1, 1, 20, '每人提交次数'), maxSubmissions: integer(body.maxSubmissions, 500, 1, 1000, '总授权次数'), fields: fields(body.fields) };
}
function publicForm(form) {
  const { id, title, description, status, access, deadline, requireReview, allowEdit, maxPerUser, maxSubmissions, fields: schema, revision, createdAt, updatedAt } = form;
  return { id, title, description, status, access, deadline, requireReview, allowEdit, maxPerUser, maxSubmissions, fields: schema, revision, createdAt, updatedAt };
}
function answersInput(value, schema) {
  if (!validObject(value)) fail(400, 'INVALID_ANSWERS', '表单填写内容无效。');
  const byId = new Map(schema.map((f) => [f.id, f]));
  if (Object.keys(value).some((key) => !byId.has(key) || byId.get(key).type === 'file')) fail(400, 'INVALID_ANSWERS', '存在未知字段或附件字段答案。');
  const result = {};
  for (const f of schema) {
    if (f.type === 'file') continue;
    const v = value[f.id];
    if (f.type === 'checkbox') {
      const options = v === undefined ? [] : v;
      if (!Array.isArray(options) || options.length > f.options.length || options.some((x) => typeof x !== 'string' || !f.options.includes(x)) || new Set(options).size !== options.length || (f.required && !options.length)) fail(400, 'INVALID_ANSWERS', `${f.label}请选择有效选项。`);
      result[f.id] = [...options];
    } else if (f.type === 'number') {
      if (v === undefined || v === null || v === '') { if (f.required) fail(400, 'INVALID_ANSWERS', `${f.label}为必填项。`); result[f.id] = null; continue; }
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER || (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) fail(400, 'INVALID_ANSWERS', `${f.label}不在允许的数字范围内。`);
      result[f.id] = v;
    } else {
      const normalized = text(v, f.label, f.maxLength || 160, f.required);
      if (normalized && f.type === 'date') date(normalized, f.label);
      if (normalized && f.type === 'select' && !f.options.includes(normalized)) fail(400, 'INVALID_ANSWERS', `${f.label}请选择有效选项。`);
      result[f.id] = normalized;
    }
  }
  return result;
}
function fileInput(value, schema) {
  if (!Array.isArray(value) || value.length > 10) fail(400, 'INVALID_FILES', '每次提交最多上传 10 个附件。');
  const schemaById = new Map(schema.filter((f) => f.type === 'file').map((f) => [f.id, f]));
  const counts = new Map();
  const files = value.map((file) => {
    const f = validObject(file) && schemaById.get(file.fieldId);
    if (!f) fail(400, 'INVALID_FILE', '附件字段无效。');
    counts.set(f.id, (counts.get(f.id) || 0) + 1);
    const name = text(file.name, '文件名', 180, true);
    if (/[\/\\\r\n]/.test(name) || name === '.' || name === '..') fail(400, 'INVALID_FILE', '文件名无效。');
    const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
    if (!f.extensions.includes(extension)) fail(400, 'FILE_TYPE_REJECTED', `${f.label}不接受该文件格式。`);
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > f.maxFileBytes) fail(400, 'FILE_TOO_LARGE', `${f.label}附件为空或超过大小限制。`);
    const type = file.type || 'application/octet-stream';
    if (typeof type !== 'string' || type.length > 120 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(type)) fail(400, 'INVALID_FILE', '附件类型无效。');
    return { id: randomUUID(), fieldId: f.id, name, size: file.size, type, extension };
  });
  if (files.reduce((total, file) => total + file.size, 0) > MAX_FILE) fail(400, 'TOTAL_FILES_TOO_LARGE', '每次提交的附件合计不能超过 20 MiB。');
  for (const f of schemaById.values()) if ((counts.get(f.id) || 0) > f.maxFiles || (f.required && !counts.get(f.id))) fail(400, 'INVALID_FILES', `${f.label}附件数量不符合要求。`);
  return files;
}
function oscaConfig(env, formId) {
  let endpoint;
  try { endpoint = new URL(env.OSCA_ENDPOINT); } catch { fail(503, 'NOT_CONFIGURED', '文件存储尚未配置。'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || !/^[a-zA-Z0-9._-]{1,150}$/.test(env.OSCA_BUCKET || '') || ![env.OSCA_ACCESS_KEY_ID, env.OSCA_SECRET_ACCESS_KEY].every((v) => typeof v === 'string' && v)) fail(503, 'NOT_CONFIGURED', '文件存储配置无效。');
  const prefix = env.OSCA_PREFIX || 'studev-submissions/';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(prefix)) fail(503, 'NOT_CONFIGURED', '文件存储目录无效。');
  return { endpoint: endpoint.origin, bucket: env.OSCA_BUCKET, accessKeyId: env.OSCA_ACCESS_KEY_ID, secretAccessKey: env.OSCA_SECRET_ACCESS_KEY, region: env.OSCA_REGION || 'us-east-1', objectPrefix: `${prefix}platform/${formId}/` };
}
function strongHead(head, file) {
  return head && head.size === file.size && head.contentType === file.type && /^"[^"\r\n]+"$/.test(head.etag || '');
}
async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  let firstError;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index], index); }
      catch (error) { firstError ||= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, runner));
  if (firstError) throw firstError;
  return results;
}
function identitySnapshot(user) {
  if (!user || typeof user.studentId !== 'string' || typeof user.realName !== 'string' || !user.studentId.trim() || !user.realName.trim()) return null;
  return { studentId: text(user.studentId, '学号', 80, true), realName: text(user.realName, '姓名', 80, true), identityVerified: user.identityVerified === true };
}
function csvCell(value) {
  let result = Array.isArray(value) ? value.join('；') : String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(result) || /^[\t\r\n]/.test(result)) result = `'${result}`;
  return `"${result.replace(/"/g, '""')}"`;
}

export function createFormsService({ repo, identity, env, now = Date.now, getGateway }) {
  const iso = () => new Date(now()).toISOString();
  const formPrefix = (id) => `forms/${id}`;
  const recordKey = (id) => `form-records/${id}.json`;
  const completionKey = (id) => `form-completed/${id}.json`;
  const eventPrefix = (id) => `form-events/${id}`;
  async function getForm(id) {
    if (!ID.test(id)) fail(404, 'NOT_FOUND', '表单不存在。');
    const form = await repo.latest(formPrefix(id));
    if (!form) fail(404, 'NOT_FOUND', '表单不存在。');
    return form;
  }
  async function indexedForm(key) {
    const index = await repo.get(key);
    if (!index || !ID.test(index.id)) return null;
    // New indexes carry the current immutable snapshot. Existing deployments
    // keep working through the versioned fallback and migrate on the next edit.
    return index.form && index.form.id === index.id ? index.form : getForm(index.id);
  }
  async function getRecord(id) {
    if (!ID.test(id)) fail(404, 'NOT_FOUND', '提交记录不存在。');
    const record = await repo.get(recordKey(id));
    if (!record) fail(404, 'NOT_FOUND', '提交记录不存在。');
    return record;
  }
  async function recordView(record, { includeIdentity = false } = {}) {
    const [complete, event] = await Promise.all([repo.get(completionKey(record.id)), repo.latest(eventPrefix(record.id))]);
    const submitterIdentity = includeIdentity && record.userId && record.submitterIdentity ? identitySnapshot(record.submitterIdentity) : null;
    return { id: record.id, formId: record.formId, formTitle: record.schemaSnapshot.title, ...(record.userId ? { userId: record.userId } : {}), submitterName: record.submitterName, ...(submitterIdentity ? { submitterIdentity } : {}), answers: event?.answers || record.answers, files: record.files.map(({ id, fieldId, name, size, type }) => ({ id, fieldId, name, size, type })), status: event?.status || complete?.status || 'uploading', revision: event?.revision || 0, createdAt: record.createdAt, updatedAt: event?.updatedAt || complete?.completedAt || record.createdAt, ...(event?.review ? { review: event.review } : {}) };
  }
  async function completionView(record) {
    const view = await recordView(record);
    if (!record.userId) return view;
    // A receipt is sufficient to finish an authorized upload after session expiry, but it is
    // not an account login. Do not echo names, answers, filenames, review comments or identity.
    const { id, formId, status, revision, createdAt, updatedAt } = view;
    return { id, formId, status, revision, createdAt, updatedAt };
  }
  async function authorize(request, record, { csrf = false, receiptToken } = {}) {
    const session = await identity.authenticate(request);
    if (session && csrf) await identity.authenticate(request, { required: true, csrf: true });
    if (session && ['owner', 'admin'].includes(session.user.role)) return identity.authenticate(request, { staff: true, csrf });
    if (session && record.userId === session.user.id) return session;
    const secret = receiptToken ?? request.headers.get('x-receipt-token');
    if (!record.userId && typeof secret === 'string' && secret.length >= 20 && secret.length <= 256) {
      const actual = Buffer.from(hash(secret)); const expected = Buffer.from(record.receiptHash);
      if (actual.length === expected.length && timingSafeEqual(actual, expected)) return null;
    }
    fail(404, 'NOT_FOUND', '提交记录不存在或无权访问。');
  }
  async function claim(prefix, maximum, value, code) {
    // Repository listing is strongly consistent. Skip known occupied tickets so a nearly-full
    // form needs one conditional write in the uncontended case, rather than N failed writes.
    const occupied = new Set((await repo.list(prefix)).map((key) => key.slice(prefix.length).replace(/\.json$/, '')));
    const slots = occupied.size >= maximum ? [] : Array.from({ length: maximum }, (_, n) => String(n).padStart(4, '0')).filter((s) => !occupied.has(s));
    // Always fill the lowest slot first: reservations remain contiguous, so lowering a limit
    // cannot expose fresh low-number slots while old high-number reservations still exist.
    for (let i = 0; i < slots.length; i++) {
      try { await repo.putNew(`${prefix}${slots[i]}.json`, value); return; }
      catch (error) { if (!isConflict(error)) throw error; }
    }
    fail(409, code, code === 'USER_LIMIT_REACHED' ? '你已达到本表的上传授权次数上限，失败或放弃的上传也计入。' : '本表收集授权名额已满，失败或放弃的上传也计入。');
  }
  async function recordsFor(formId) {
    const keys = (await repo.list(`form-submissions/${formId}/`)).slice(-1000);
    const values = await Promise.all(keys.map(async (key) => { const index = await repo.get(key); return index ? repo.get(recordKey(index.id)) : null; }));
    return values.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  function canSubmit(form) { return form.status === 'published' && (!form.deadline || Date.parse(form.deadline) > now()); }
  async function addForm(input, actor) {
    if ((await repo.list('form-index/')).length >= 1000) fail(409, 'FORM_LIMIT_REACHED', '表单数量已达平台上限。');
    const id = randomUUID(); const timestamp = iso();
    const form = await repo.append(formPrefix(id), { ...input, id, createdAt: timestamp, updatedAt: timestamp }, 0);
    await repo.putNew(`form-index/${id}.json`, { id, form: publicForm(form) });
    await repo.audit(actor, 'form.create', id, { fieldCount: form.fields.length });
    return form;
  }
  return {
    async handle(context, path) {
      const request = context.request; const method = request.method;
      if (!path.startsWith(`${API}/`)) return null;
      if (['POST', 'DELETE'].includes(method)) requireOrigin(request, env);
      if (path === `${API}/admin/forms` && ['GET', 'POST'].includes(method)) {
        const session = await identity.authenticate(request, { staff: true, csrf: method === 'POST' });
        if (method === 'POST') return response({ form: publicForm(await addForm(formInput(await readJson(request)), session.user)) }, 201);
        const items = await Promise.all((await repo.list('form-index/')).slice(-1000).map(indexedForm));
        return response({ items: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicForm) });
      }
      const adminForm = path.match(/^\/api\/platform\/admin\/forms\/([^/]+)(?:\/(duplicate|submissions|export|delete))?$/);
      if (adminForm) {
        const session = await identity.authenticate(request, { staff: true, csrf: ['POST', 'DELETE'].includes(method) });
        const form = await getForm(adminForm[1]); const action = adminForm[2];
        if (!action && method === 'POST') {
          const body = await readJson(request);
          const changed = await repo.append(formPrefix(form.id), { ...formInput({ ...form, ...body }), id: form.id, createdAt: form.createdAt, updatedAt: iso() }, body.revision);
          await repo.put(`form-index/${form.id}.json`, { id: form.id, form: publicForm(changed) });
          await repo.audit(session.user, 'form.update', form.id, { status: changed.status, revision: changed.revision, fieldCount: changed.fields.length });
          return response({ form: publicForm(changed) });
        }
        if ((!action && method === 'DELETE') || (action === 'delete' && ['POST', 'DELETE'].includes(method))) {
          await repo.remove(`form-index/${form.id}.json`);
          const prefixes = [`forms/${form.id}/`, `form-quota/${form.id}/`, `form-submissions/${form.id}/`];
          for (const p of prefixes) {
            const keys = await repo.list(p);
            for (const key of keys) await repo.remove(key);
          }
          await repo.audit(session.user, 'form.delete', form.id, { title: form.title });
          return response({ ok: true });
        }
        if (action === 'duplicate' && method === 'POST') return response({ form: publicForm(await addForm({ ...formInput(form), title: `${form.title.slice(0, 94)} · 副本`, status: 'draft', deadline: '' }, session.user)) }, 201);
        if (['submissions', 'export'].includes(action) && method === 'GET') {
          const records = await recordsFor(form.id); const items = await Promise.all(records.map((record) => recordView(record, { includeIdentity: true })));
          if (action === 'submissions') return response({ items, usage: { authorizations: (await repo.list(`form-quota/${form.id}/`)).length, completed: items.filter((v) => v.status !== 'uploading').length, fileBytes: items.filter((v) => v.status !== 'uploading').reduce((sum, row) => sum + row.files.reduce((n, f) => n + f.size, 0), 0) } });
          // A union of immutable schemas preserves labels/values of deleted or renamed fields.
          const signature = (field) => JSON.stringify([field.id, field.type, field.label]);
          const columns = new Map(form.fields.map((f) => [signature(f), f]));
          for (const record of records) for (const f of record.schemaSnapshot.fields) if (!columns.has(signature(f))) columns.set(signature(f), f);
          const schema = [...columns.entries()]; const labels = new Map();
          const headers = schema.map(([, f]) => {
            const count = schema.filter(([, other]) => other.label === f.label).length;
            const version = (labels.get(f.label) || 0) + 1; labels.set(f.label, version);
            return count > 1 ? `${f.label}（版本 ${version}）` : f.label;
          });
          const rows = [['提交编号', '提交者', '学号', '姓名', '提交时间', '状态', '审核说明', ...headers], ...items.map((row, index) => {
            const ownSchema = new Set(records[index].schemaSnapshot.fields.map(signature));
            return [row.id, row.submitterName, row.submitterIdentity?.studentId || '', row.submitterIdentity?.realName || '', row.createdAt, row.status, row.review?.comment || '', ...schema.map(([key, f]) => !ownSchema.has(key) ? '' : f.type === 'file' ? row.files.filter((file) => file.fieldId === f.id).map((file) => file.name).join('；') : row.answers[f.id])];
          })];
          await repo.audit(session.user, 'form.export', form.id, { count: items.length });
          return new Response(`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="studev-${form.id}.csv"`, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
        }
        fail(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
      }
      if (path === `${API}/forms` && method === 'GET') {
        const session = await identity.authenticate(request);
        const forms = await Promise.all((await repo.list('form-index/')).slice(-1000).map(indexedForm));
        return response({ items: forms.filter((f) => canSubmit(f) && (f.access === 'public' || session)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(publicForm) });
      }
      const formRoute = path.match(/^\/api\/platform\/forms\/([^/]+)(?:\/(submissions))?$/);
      if (formRoute) {
        const form = await getForm(formRoute[1]);
        const session = await identity.authenticate(request, { required: form.access === 'members' });
        if (session && method === 'POST') await identity.authenticate(request, { required: true, csrf: true });
        if (method === 'GET' && !formRoute[2]) {
          if (form.status !== 'published') await identity.authenticate(request, { staff: true });
          return response({ form: publicForm(form), canSubmit: canSubmit(form), ...(!canSubmit(form) ? { reason: form.status !== 'published' ? '本表尚未发布或已经停止收集。' : '已超过截止时间。' } : {}) });
        }
        if (method === 'POST' && formRoute[2] === 'submissions') {
          if (!canSubmit(form)) fail(409, 'FORM_CLOSED', '本表当前不接受新提交。');
          await repo.throttle('form-submit', session?.user.id || context.clientIp || 'unknown', 15);
          const body = await readJson(request); const answers = answersInput(body.answers, form.fields); const files = fileInput(body.files || [], form.fields);
          const submitterName = session ? text(session.user.nickname || session.user.qq, '提交者', 80, true) : text(body.submitterName, '称呼', 80, true);
          const submitterIdentity = session ? identitySnapshot(session.user) : null;
          const config = files.length ? oscaConfig(env, form.id) : null;
          const id = randomUUID(); const token = randomBytes(32).toString('base64url'); const timestamp = iso();
          const ticket = { id, createdAt: timestamp };
          if (session) await claim(`form-user-quota/${form.id}/${session.user.id}/`, form.maxPerUser, ticket, 'USER_LIMIT_REACHED');
          await claim(`form-quota/${form.id}/`, form.maxSubmissions, ticket, 'FORM_FULL');
          const record = { id, formId: form.id, ...(session ? { userId: session.user.id } : {}), submitterName, ...(submitterIdentity ? { submitterIdentity } : {}), answers, files: files.map((file) => ({ ...file, objectKey: `${config.objectPrefix}staging/${id}/${file.id}.${file.extension}` })), schemaSnapshot: publicForm(form), receiptHash: hash(token), createdAt: timestamp, uploadExpiresAt: now() + 300000, objectPrefix: config?.objectPrefix || '' };
          await repo.putNew(recordKey(id), record);
          await repo.putNew(`form-submissions/${form.id}/${id}.json`, { id });
          if (session) await repo.putNew(`user-submissions/${session.user.id}/${String(9999999999999 - now()).padStart(13, '0')}-${id}.json`, { id });
          const gateway = files.length ? getGateway(config) : null;
          const uploads = await Promise.all(record.files.map(async (file) => ({ fileId: file.id, ...await gateway.presignUpload({ id: file.id, objectKey: file.objectKey, contentType: file.type, fileSize: file.size, fileName: file.name }, 300) })));
          return response({ submission: await recordView(record, { includeIdentity: Boolean(session) }), receiptToken: token, uploads }, 201);
        }
        fail(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
      }
      if (path === `${API}/me/submissions` && method === 'GET') {
        const session = await identity.authenticate(request, { required: true });
        const records = await Promise.all((await repo.list(`user-submissions/${session.user.id}/`)).slice(0, 1000).map(async (key) => { const index = await repo.get(key); return index ? getRecord(index.id) : null; }));
        return response({ items: (await Promise.all(records.filter((r) => r.userId === session.user.id).map((record) => recordView(record, { includeIdentity: true })))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
      }
      const submissionRoute = path.match(/^\/api\/platform\/submissions\/([^/]+)(?:\/(complete|edit|review)|\/files\/([^/]+)\/(download))?$/);
      if (!submissionRoute) return null;
      const record = await getRecord(submissionRoute[1]); const action = submissionRoute[2] || submissionRoute[4];
      if (!action && method === 'GET') {
        const auth = await authorize(request, record);
        const [submission, currentForm] = await Promise.all([recordView(record, { includeIdentity: Boolean(auth) }), getForm(record.formId)]);
        const canEdit = Boolean(auth && auth.user.id === record.userId && record.schemaSnapshot.allowEdit && currentForm.allowEdit && canSubmit(currentForm) && submission.status !== 'uploading');
        let submitterContact;
        if (auth && ['owner', 'admin'].includes(auth.user.role) && record.userId) {
          // Contact details are deliberately limited to the staff detail response, never lists,
          // public schemas or receipt responses. Read the current account rather than a stale copy.
          const account = await repo.latest(`identity/users/${record.userId}`);
          if (account) {
            const user = identity.publicUser(account);
            submitterContact = { qq: user.qq, email: user.email, emailVerified: user.emailVerified === true, nickname: user.nickname, studentId: user.studentId || '', realName: user.realName || '', identityVerified: user.identityVerified === true };
          }
        }
        return response({ submission, form: record.schemaSnapshot, canEdit, ...(submitterContact ? { submitterContact } : {}) });
      }
      if (action === 'complete' && method === 'POST') {
        await repo.throttle('form-complete', context.clientIp || 'unknown', 60);
        const body = await readJson(request);
        // The upload receipt authorizes confirmation even when a member session expires mid-upload.
        if (typeof body.receiptToken !== 'string' || body.receiptToken.length > 256 || hash(body.receiptToken) !== record.receiptHash) fail(403, 'RECEIPT_REJECTED', '提交凭证无效。');
        if (await repo.get(completionKey(record.id))) return response({ submission: await completionView(record) });
        if (now() > record.uploadExpiresAt + 3600000) fail(410, 'SUBMISSION_EXPIRED', '本次上传确认已过期，请联系管理员。');
        const gateway = record.files.length ? getGateway(oscaConfig(env, record.formId)) : null;
          const candidates = []; let removeCandidates = true;
        try {
            const finalized = await mapConcurrent(record.files, 3, async (file, index) => {
            const head = await gateway.head(file.objectKey);
            if (!strongHead(head, file)) fail(409, 'UPLOAD_MISMATCH', '附件尚未就绪或大小、类型与声明不一致。');
            const finalObjectKey = `${record.objectPrefix}final/${record.id}/${file.id}/${randomUUID()}`;
              const candidate = { index, id: file.id, finalObjectKey };
              candidates.push(candidate);
            await gateway.copy(file.objectKey, finalObjectKey, head.etag);
            const finalHead = await gateway.head(finalObjectKey);
            if (!strongHead(finalHead, file) || finalHead.etag !== head.etag) fail(409, 'UPLOAD_CHANGED', '附件在确认期间发生变化，请重试确认。');
              return Object.assign(candidate, { etag: finalHead.etag, size: finalHead.size, contentType: finalHead.contentType });
            });
            finalized.sort((a, b) => a.index - b.index);
            const completed = { completedAt: iso(), status: record.schemaSnapshot.requireReview ? 'pending_review' : 'submitted', files: finalized.map(({ index, ...file }) => file) };
          // An ambiguous metadata transport failure may hide a committed winner. Never delete its data.
          removeCandidates = false;
          try { await repo.putNew(completionKey(record.id), completed); }
          catch (error) {
            if (!isConflict(error)) throw error;
            const winner = await repo.get(completionKey(record.id));
            if (!winner) throw error;
            removeCandidates = !winner.files.some((f) => candidates.some((c) => c.finalObjectKey === f.finalObjectKey));
          }
          return response({ submission: await completionView(record) });
        } finally {
          if (removeCandidates && gateway) await Promise.all(candidates.map(async (file) => { try { await gateway.delete(file.finalObjectKey); } catch { /* Unreachable orphan only; never expose storage errors. */ } }));
        }
      }
      if (action === 'edit' && method === 'POST') {
        const session = await identity.authenticate(request, { required: true, csrf: true });
        if (session.user.id !== record.userId) fail(404, 'NOT_FOUND', '提交记录不存在或无权修改。');
        const currentForm = await getForm(record.formId);
        if (!record.schemaSnapshot.allowEdit || !currentForm.allowEdit || !canSubmit(currentForm)) fail(409, 'EDIT_CLOSED', '本表当前不允许修改。');
        if (!await repo.get(completionKey(record.id))) fail(409, 'UPLOAD_INCOMPLETE', '请先完成提交。');
        const body = await readJson(request);
        if (body.files !== undefined) fail(400, 'FILES_IMMUTABLE', '附件不能替换，请新建提交。');
        const event = await repo.append(eventPrefix(record.id), { answers: answersInput(body.answers, record.schemaSnapshot.fields), status: record.schemaSnapshot.requireReview ? 'pending_review' : 'submitted', updatedAt: iso() }, body.revision);
        await repo.audit(session.user, 'submission.edit', record.id, { formId: record.formId, revision: event.revision });
        return response({ submission: await recordView(record, { includeIdentity: true }) });
      }
      if (action === 'review' && method === 'POST') {
        const session = await identity.authenticate(request, { staff: true, csrf: true });
        if (!await repo.get(completionKey(record.id))) fail(409, 'UPLOAD_INCOMPLETE', '请先完成提交。');
        const body = await readJson(request);
        if (!['accepted', 'rejected'].includes(body.status)) fail(400, 'INVALID_STATUS', '审核状态无效。');
        const current = await recordView(record);
        const event = await repo.append(eventPrefix(record.id), { answers: current.answers, status: body.status, updatedAt: iso(), review: { status: body.status, comment: text(body.comment, '审核说明', 1000), reviewedAt: iso() } }, body.revision);
        await repo.audit(session.user, 'submission.review', record.id, { formId: record.formId, status: body.status, revision: event.revision });
        return response({ submission: await recordView(record, { includeIdentity: true }) });
      }
      if (action === 'download' && method === 'POST') {
        await authorize(request, record, { csrf: true });
        const file = record.files.find((f) => f.id === submissionRoute[3]);
        const completed = await repo.get(completionKey(record.id)); const frozen = completed?.files.find((f) => f.id === file?.id);
        if (!file || !frozen) fail(404, 'NOT_FOUND', '附件不存在或尚未完成提交。');
        if (!frozen.finalObjectKey.startsWith(`${record.objectPrefix}final/${record.id}/${file.id}/`)) fail(409, 'OBJECT_CHANGED', '附件归档信息无效。');
        const gateway = getGateway(oscaConfig(env, record.formId)); const head = await gateway.head(frozen.finalObjectKey);
        if (!strongHead(head, file) || head.etag !== frozen.etag || head.size !== frozen.size || head.contentType !== frozen.contentType) fail(409, 'OBJECT_CHANGED', '附件归档内容发生变化，暂不可下载。');
        return response({ download: await gateway.presignDownload({ fileName: file.name, finalObjectKey: frozen.finalObjectKey }, frozen.etag, 60) });
      }
      fail(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
    },
  };
}
