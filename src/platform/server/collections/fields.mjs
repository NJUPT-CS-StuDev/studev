import { randomUUID } from 'node:crypto';
import { fail, text } from '../common.mjs';

const MAX_FILE = 50 * 1024 * 1024;
const EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'zip', '7z', 'rar', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'mp4', 'mov'];
const TYPES = ['text', 'textarea', 'select', 'checkbox', 'number', 'date', 'file'];
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
export function fields(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) fail(400, 'INVALID_FIELDS', '请设置 1–30 个字段。');
  const ids = new Set();
  return value.map((input) => {
    if (!validObject(input) || typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(input.id) || ids.has(input.id) || !TYPES.includes(input.type)) fail(400, 'INVALID_FIELDS', '字段类型或标识无效、重复。');
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
      f.maxFileBytes = integer(input.maxFileBytes, 20 * 1024 * 1024, 1, MAX_FILE, '单附件大小');
      if (input.extensions !== undefined && (!Array.isArray(input.extensions) || !input.extensions.length || input.extensions.length > 40)) fail(400, 'INVALID_EXTENSIONS', '请填写允许的文件扩展名。');
      f.extensions = (input.extensions || EXTENSIONS).map((v) => typeof v === 'string' ? v.toLowerCase().replace(/^\./, '') : '');
      if (f.extensions.some((v) => !/^[a-z0-9]{1,10}$/.test(v))) fail(400, 'INVALID_EXTENSIONS', '文件扩展名无效。');
      f.extensions = [...new Set(f.extensions)];
    }
    return f;
  });
}
export function answersInput(value, schema) {
  if (!validObject(value)) fail(400, 'INVALID_ANSWERS', '表单填写内容无效。');
  const byId = new Map(schema.map((f) => [f.id, f]));
  if (Object.keys(value).some((key) => !byId.has(key) || byId.get(key).type === 'file')) fail(400, 'INVALID_ANSWERS', '存在未知字段或附件字段答案。');
  const result = {};
  for (const f of schema) {
    if (f.type === 'file') continue;
    const v = Object.hasOwn(value, f.id) ? value[f.id] : undefined;
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
export function fileInput(value, schema, kept = [], maxTotalBytes = 100 * 1024 * 1024) {
  if (!Array.isArray(value) || value.length + kept.length > 10) fail(400, 'INVALID_FILES', '每次提交最多上传 10 个附件。');
  const schemaById = new Map(schema.filter((f) => f.type === 'file').map((f) => [f.id, f]));
  const counts = new Map();
  for (const file of kept) {
    const field = schemaById.get(file.fieldId);
    if (!field || file.size > field.maxFileBytes || !field.extensions.includes(file.name.split('.').at(-1)?.toLowerCase())) {
      fail(409, 'FILE_FIELD_CHANGED', '已有附件不符合当前字段要求，请重新上传。');
    }
    counts.set(file.fieldId, (counts.get(file.fieldId) || 0) + 1);
  }
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
  if ([...files, ...kept].reduce((total, file) => total + file.size, 0) > maxTotalBytes) fail(400, 'TOTAL_FILES_TOO_LARGE', '每次提交的附件合计超过限制。');
  for (const f of schemaById.values()) if ((counts.get(f.id) || 0) > f.maxFiles || (f.required && !counts.get(f.id))) fail(400, 'INVALID_FILES', `${f.label}附件数量不符合要求。`);
  return files;
}

export { boolean, integer, validObject };
