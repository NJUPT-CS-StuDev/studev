import { randomUUID } from 'node:crypto';
import product from '../../product.json' with { type: 'json' };
// Shared explicit-test client. Importing does not read credentials or contact a server.
export class LiveClient {
  constructor(origin) {
    if (![product.origin, 'http://127.0.0.1:4319'].includes(origin)) throw new Error('Live verification origin is not approved.');
    this.origin = origin; this.cookie = ''; this.csrf = ''; this.deviceId = randomUUID(); this.cookies = new Map();
  }
  async call(path, { method = 'GET', body, headers = {}, expected, raw = false } = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid local API path');
    if (['/auth/login', '/auth/refresh'].includes(path)) body = { deviceId: this.deviceId, deviceName: '受控验收浏览器', ...body };
    const result = await fetch(`${this.origin}/api/platform${path}`, {
      method, signal: AbortSignal.timeout(60000), redirect: 'error',
      headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(method === 'POST' ? { Origin: this.origin, 'X-CSRF-Token': this.csrf } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const value of result.headers.getSetCookie()) { const pair = value.split(';')[0]; this.cookies.set(pair.split('=')[0], pair); }
    this.cookie = [...this.cookies.values()].join('; ');
    const value = raw ? await result.text() : await result.json().catch(() => ({}));
    if (value?.csrfToken) this.csrf = value.csrfToken;
    if (expected !== undefined && result.status !== expected) {
      const code = /^[A-Z0-9_]{1,64}$/.test(value?.error?.code || '') ? value.error.code : 'UNEXPECTED_RESPONSE';
      throw Object.assign(new Error(`API check failed: ${method} ${path.split('?')[0]} (${result.status} ${code})`), { status: result.status, code });
    }
    return { status: result.status, body: value, headers: result.headers };
  }
}
export function recordCheck(report, name, passed, details = {}) {
  const value = { name, passed: Boolean(passed), ...details };
  report.push(value); console.log(JSON.stringify(value));
  if (!passed) throw new Error(`Verification failed: ${name}`);
}
