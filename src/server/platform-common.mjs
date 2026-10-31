export class AppError extends Error {
  constructor(status, code, message) { super(message); this.name = 'AppError'; this.status = status; this.code = code; }
}
export function fail(status, code, message) { throw new AppError(status, code, message); }
export function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", ...headers,
  } });
}
export async function readJson(request, maxBytes = 65536) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, 'JSON_REQUIRED', '请以 JSON 格式提交。');
  if (Number(request.headers.get('content-length')) > maxBytes) fail(413, 'BODY_TOO_LARGE', '提交信息过长。');
  let bytes;
  const original = request._rawBodyBuffer;
  if (Buffer.isBuffer(original) || original instanceof Uint8Array) {
    if (original.byteLength > maxBytes) fail(413, 'BODY_TOO_LARGE', '提交信息过长。');
    bytes = Buffer.from(original.buffer, original.byteOffset, original.byteLength);
  } else {
    const nativeGetter = Object.getOwnPropertyDescriptor(Request.prototype, 'body')?.get;
    let stream;
    try { stream = nativeGetter?.call(request); } catch { fail(400, 'INVALID_JSON', '缺少提交信息。'); }
    const reader = stream?.getReader();
    if (!reader) fail(400, 'INVALID_JSON', '缺少提交信息。');
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', '提交信息过长。'); }
      chunks.push(Buffer.from(value));
    }
    bytes = Buffer.concat(chunks);
  }
  try {
    const body = JSON.parse(bytes.toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch { fail(400, 'INVALID_JSON', '提交信息不是有效 JSON。'); }
}
export function platformOrigin(env) {
  let url;
  try { url = new URL(env.PLATFORM_ORIGIN); } catch { fail(503, 'NOT_CONFIGURED', '平台配置尚未完成。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) fail(503, 'NOT_CONFIGURED', '平台配置无效。');
  return url.origin;
}
export function requireOrigin(request, env) {
  if (request.headers.get('origin') !== platformOrigin(env)) fail(403, 'ORIGIN_REJECTED', '请从本站页面操作。');
  const site = request.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) fail(403, 'ORIGIN_REJECTED', '请从本站页面操作。');
}
export function text(value, label, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) fail(400, 'INVALID_FIELD', `${label}填写不正确。`);
  return value.trim();
}
export function safeLog(error) {
  const identifier = (v) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : 'UNKNOWN';
  const status = error?.$metadata?.httpStatusCode ?? error?.statusCode ?? error?.status;
  console.error('platform-service-error', { name: identifier(error?.name), code: identifier(error?.code), ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}) });
}
