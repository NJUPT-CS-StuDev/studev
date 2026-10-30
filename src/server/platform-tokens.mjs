import { randomBytes, randomUUID } from 'node:crypto';
import { digest } from './collection-auth.mjs';
import { fail, text } from './platform-common.mjs';
import { isConflict } from './platform-store.mjs';

export const ACCESS_SECONDS = 600;
const REFRESH_SECONDS = 30 * 86400;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[a-f0-9-]{36}$/;
export const nativeLoginRoute = (path) => ['/api/platform/auth/token', '/api/platform/auth/token/refresh'].includes(path);
export const nativeBootstrap = (request, path) => nativeLoginRoute(path) && !request.headers.has('origin') && !request.headers.has('cookie') && !request.headers.has('sec-fetch-site');
export const hasAuthorization = (request) => request.headers.has('authorization');

// All security decisions use immutable records/conditional creation. A stale
// materialized revision can never undo a revocation or spend a refresh twice.
export function createNativeTokens({ repo, now, loadUser }) {
  const sessionKey = (id) => `identity/native/sessions/${id}.json`;
  const revokedKey = (id) => `identity/native/revoked/${id}.json`;
  const tokenKey = (kind, token) => `identity/native/${kind}/${digest(token)}.json`;
  function device(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail(400, 'INVALID_DEVICE', '设备标识无效，请重新安装后重试。');
    return digest(value);
  }
  async function revoke(id) {
    const session = await repo.get(sessionKey(id));
    try { await repo.putNew(revokedKey(id), { revokedAt: new Date(now()).toISOString(), expiresAt: session?.expiresAt ?? now() + REFRESH_SECONDS * 1000 }); }
    catch (error) { if (!isConflict(error)) throw error; }
  }
  async function validSession(id) {
    const session = await repo.get(sessionKey(id));
    if (!session || session.expiresAt <= now() || await repo.get(revokedKey(id))) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const user = await loadUser(session.userId);
    if (!user || user.status !== 'active' || user.securityVersion !== session.securityVersion) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    return { user, session };
  }
  async function issue(session) {
    const accessToken = randomBytes(32).toString('base64url'), refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = Math.min(now() + ACCESS_SECONDS * 1000, session.expiresAt);
    await repo.putNew(tokenKey('access', accessToken), { sessionId: session.id, expiresAt });
    await repo.putNew(tokenKey('refresh', refreshToken), { sessionId: session.id, expiresAt: session.expiresAt });
    return { tokenType: 'Bearer', accessToken, refreshToken, expiresIn: Math.floor((expiresAt - now()) / 1000), refreshExpiresAt: session.expiresAt, deviceSessionId: session.id };
  }
  async function start(user, body) {
    const deviceHash = device(body.deviceId);
    const deviceName = text(body.deviceName, '设备名称', 80, true);
    const existing = await repo.list(`identity/native/by-user/${user.id}/`);
    let active = 0;
    for (const key of existing) {
      const ref = await repo.get(key), record = ref?.id ? await repo.get(sessionKey(ref.id)) : null;
      if (!record || record.expiresAt <= now() || await repo.get(revokedKey(record.id))) continue;
      if (record.deviceHash === deviceHash) await revoke(record.id);
      else if (record.securityVersion === user.securityVersion) active++;
    }
    if (active >= 20) fail(429, 'DEVICE_LIMIT', '已登录设备过多，请先在网页账号中心退出不再使用的设备。');
    const session = { id: randomUUID(), userId: user.id, securityVersion: user.securityVersion, deviceHash, deviceName,
      mfaVerified: Boolean(user.totp), createdAt: new Date(now()).toISOString(), expiresAt: now() + REFRESH_SECONDS * 1000 };
    await repo.putNew(sessionKey(session.id), session);
    await repo.putNew(`identity/native/by-user/${user.id}/${session.id}.json`, { id: session.id });
    return issue(session);
  }
  async function refresh(body) {
    const hash = device(body.deviceId);
    if (typeof body.refreshToken !== 'string' || !TOKEN.test(body.refreshToken)) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const ticket = await repo.get(tokenKey('refresh', body.refreshToken));
    if (!ticket || ticket.expiresAt <= now()) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const { session } = await validSession(ticket.sessionId);
    if (hash !== session.deviceHash) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    try { await repo.putNew(tokenKey('spent', body.refreshToken), { spentAt: now(), expiresAt: session.expiresAt }); }
    catch (error) {
      if (!isConflict(error)) throw error;
      await revoke(session.id);
      fail(401, 'REFRESH_REPLAYED', '检测到重复刷新，请重新登录此设备。');
    }
    return issue(session);
  }
  async function authenticate(request) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get('authorization') || '');
    if (!match) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const ticket = await repo.get(tokenKey('access', match[1]));
    if (!ticket || ticket.expiresAt <= now()) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const { user, session } = await validSession(ticket.sessionId);
    const state = await repo.latest(`identity/native/state/${session.id}`);
    return { user, session: { ...session, ...state }, sessionId: session.id, kind: 'bearer', mfaVerified: session.mfaVerified };
  }
  async function list(userId) {
    const keys = await repo.list(`identity/native/by-user/${userId}/`);
    const items = await Promise.all(keys.map(async (key) => {
      const id = key.split('/').at(-1).slice(0, -5);
      try {
        const { session } = await validSession(id);
        return { id, deviceName: session.deviceName, createdAt: session.createdAt, expiresAt: session.expiresAt };
      } catch (error) { if (error.status === 401) return null; throw error; }
    }));
    return items.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function revokeOwned(userId, id) {
    if (!ID.test(id)) fail(404, 'DEVICE_NOT_FOUND', '设备不存在。');
    const session = await repo.get(sessionKey(id));
    if (session?.userId !== userId) fail(404, 'DEVICE_NOT_FOUND', '设备不存在。');
    await revoke(id);
  }
  return { start, refresh, authenticate, list, revokeOwned };
}
