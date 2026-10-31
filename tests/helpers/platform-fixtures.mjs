import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from '../../src/server/platform-crypto.mjs';

export function memoryBlob() {
  const values = new Map();
  return {
    values,
    async get(key, options) {
      const value = values.get(key);
      if (value === undefined) return null;
      if (options?.type === 'arrayBuffer') return Buffer.from(JSON.stringify(value));
      return structuredClone(value);
    },
    async setJSON(key, value, options) {
      if (options?.onlyIfNew && values.has(key)) throw Object.assign(new Error('conditional write failed'), { code: 'PRECONDITION_FAILED' });
      values.set(key, structuredClone(value));
    },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' }) { return { blobs: [...values.keys()].filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })) }; },
  };
}
export function memoryGateway() {
  const objects = new Map(), uploads = [];
  return {
    objects, uploads,
    upload(record, bytes) {
      const body = Buffer.from(bytes); objects.set(record.objectKey, { size: body.length, etag: `"${createHash('md5').update(body).digest('hex')}"`, contentType: record.contentType, body });
    },
    async presignUpload(record) {
      uploads.push(structuredClone(record));
      return { url: 'https://fgws3-ocloud.ihep.ac.cn/test-only-not-a-real-signed-url', method: 'PUT', headers: { 'Content-Type': record.contentType }, expiresAt: Date.now() + 300000 };
    },
    async head(key) { const result = objects.get(key); return result ? { size: result.size, etag: result.etag, contentType: result.contentType } : null; },
    async copy(source, target) { if (!objects.has(source)) throw new Error('not found'); objects.set(target, structuredClone(objects.get(source))); },
    async delete(key) { objects.delete(key); },
    async presignDownload(record, etag) { return { url: 'https://fgws3-ocloud.ihep.ac.cn/test-only-download', headers: { 'If-Match': etag }, fileName: record.fileName, expiresAt: Date.now() + 60000 }; },
  };
}
export async function testEnvironment() {
  // Fictional test identifiers; never connected to real QQ/mail services.
  const password = 'Test-password-only-123456';
  return {
    password,
    env: {
      PLATFORM_ENABLED: 'true', PLATFORM_ORIGIN: 'https://studev.test',
      PLATFORM_SESSION_SECRET: 'test-session-secret-'.repeat(3),
      PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      PLATFORM_OWNER_QQ: '100001', PLATFORM_OWNER_STUDENT_ID: 'TESTOWNER01', PLATFORM_OWNER_REAL_NAME: '测试所有者', PLATFORM_OWNER_NICKNAME: '测试所有者',
      PLATFORM_OWNER_PASSWORD_HASH: await hashPassword(password),
      OSCA_ENDPOINT: 'https://fgws3-ocloud.ihep.ac.cn', OSCA_BUCKET: 'test-only-bucket', OSCA_ACCESS_KEY_ID: 'test-only-ak', OSCA_SECRET_ACCESS_KEY: 'test-only-secret', OSCA_REGION: 'us-east-1', OSCA_PREFIX: 'studev-submissions/',
    },
  };
}
export function requestClient(handle, env) {
  let cookie = '', csrf = '';
  const deviceId = randomUUID();
  const cookies = new Map();
  return {
    get cookie() { return cookie; }, get csrf() { return csrf; },
    async call(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
      if (['/auth/login', '/auth/refresh'].includes(path)) body = { deviceId, deviceName: '测试浏览器', ...body };
      const request = new Request('https://studev.test/api/platform' + path, {
        method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { Origin: 'https://studev.test', 'X-CSRF-Token': csrf } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await handle({ request, env, clientIp: 'test-client' });
      for (const setCookie of result.headers.getSetCookie()) { const pair = setCookie.split(';')[0]; cookies.set(pair.split('=')[0], pair); }
      cookie = [...cookies.values()].join('; ');
      const value = raw ? await result.text() : await result.json(); if (value.csrfToken) csrf = value.csrfToken;
      return { status: result.status, body: value };
    },
  };
}
