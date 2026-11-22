import { randomBytes, randomUUID } from 'node:crypto';
import { digest } from './crypto.mjs';
import { fail, text } from './common.mjs';
import { isConflict } from './store.mjs';

const ACCESS_SECONDS = 600;
const REFRESH_SECONDS = 30 * 86400;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[a-f0-9-]{36}$/;
const bootstrapRoute = (path) => ['/api/platform/auth/register', '/api/platform/auth/login', '/api/platform/auth/refresh'].includes(path);
export const bearerBootstrap = (request, path) => bootstrapRoute(path) && !request.headers.has('origin') && !request.headers.has('cookie') && !request.headers.has('sec-fetch-site');
export const hasAuthorization = (request) => request.headers.has('authorization');

// All security decisions use immutable records/conditional creation. A stale
// materialized revision can never undo a revocation or spend a refresh twice.
export function createSessions({ repo, now, loadUser }) {
  const sessionKey = (id) => `identity/devices/sessions/${id}.json`;
  const revokedKey = (id) => `identity/devices/revoked/${id}.json`;
  const tokenKey = (kind, token) => `identity/devices/${kind}/${digest(token)}.json`;
  const loginPrefix = (userId) => `identity/devices/logins/${userId}`;
  const loginTip = (userId) => repo.latest(loginPrefix(userId), 12);
  function device(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail(400, 'INVALID_DEVICE', '设备标识无效，请重新安装后重试。');
    return digest(value);
  }
  async function revoke(id, expiresAt) {
    try { await repo.putNew(revokedKey(id), { revokedAt: new Date(now()).toISOString(), expiresAt: expiresAt ?? now() + REFRESH_SECONDS * 1000 }); }
    catch (error) { if (!isConflict(error)) throw error; }
  }
  async function validSession(id, known = {}) {
    const [original, revoked, state, ticketIdentity] = await Promise.all([
      repo.get(sessionKey(id)), repo.get(revokedKey(id)), repo.latest(`identity/devices/state/${id}`),
      // A ticket names the immutable session's owner, so these authoritative
      // reads can run alongside the session reads.
      known.userId ? Promise.all([
        loginTip(known.userId),
        loadUser(known.userId),
      ]) : null,
    ]);
    const ownerId = known.userId ?? known.user?.id;
    if (!original || original.expiresAt <= now() || revoked || (ownerId && original.userId !== ownerId)) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const [tip, user] = ticketIdentity ?? await Promise.all([
      known.tip ?? loginTip(original.userId), known.user ?? loadUser(original.userId),
    ]);
    if (!tip || tip.devices[original.deviceHash] !== id) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    // TOTP confirmation elevates this session's security version, just as it
    // does for web sessions. Revocation and absolute expiry remain immutable.
    const session = { ...original, ...state };
    if (!user || user.status !== 'active' || user.securityVersion !== session.securityVersion) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    return { user, session, loginHead: tip };
  }

  async function issue(session) {
    const accessToken = randomBytes(32).toString('base64url'), refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = Math.min(now() + ACCESS_SECONDS * 1000, session.expiresAt);
    await Promise.all([
      repo.putNew(tokenKey('access', accessToken), { sessionId: session.id, userId: session.userId, expiresAt }),
      repo.putNew(tokenKey('refresh', refreshToken), { sessionId: session.id, userId: session.userId, expiresAt: session.expiresAt }),
    ]);
    return { tokenType: 'Bearer', accessToken, refreshToken, expiresIn: Math.floor((expiresAt - now()) / 1000), refreshExpiresAt: session.expiresAt, deviceSessionId: session.id };
  }
  async function start(user, body, { kind, mfaVerified, verified }) {
    const deviceHash = device(body.deviceId);
    const deviceName = text(body.deviceName, '设备名称', 80, true);
    const tip = await loginTip(user.id), devices = {};
    // The immutable login head already names the current families (at most 20).
    // History is never scanned, and every retained family still passes strong
    // revocation, expiry and security-version checks before the next head wins.
    const existing = await Promise.all(Object.values(tip?.devices ?? {}).map(async (id) => {
      try { return (await validSession(id, { tip, user })).session; }
      catch (error) { if (error.status === 401) return null; throw error; }
    }));
    // Read the current device families while the authenticator code is being
    // reserved. The factor must succeed before any session state is changed.
    await verified;
    for (const record of existing.filter(Boolean)) {
      if (record.deviceHash === deviceHash) await revoke(record.id, record.expiresAt);
      else devices[record.deviceHash] = record.id;
    }
    if (Object.keys(devices).length >= 20) fail(429, 'DEVICE_LIMIT', '已登录设备过多，请先在网页账号中心退出不再使用的设备。');
    const generation = (tip?.generation ?? 0) + 1;
    const session = { id: randomUUID(), loginGeneration: generation, userId: user.id, securityVersion: user.securityVersion, deviceHash, deviceName,
      kind, csrfToken: randomBytes(32).toString('base64url'), mfaVerified, createdAt: new Date(now()).toISOString(), expiresAt: now() + REFRESH_SECONDS * 1000 };
    // Publish metadata before the head so a following login on another device
    // can retain this family even while its credentials are still being issued.
    await repo.putNew(sessionKey(session.id), session);
    // Reserve an immutable generation before publishing credentials. Concurrent
    // logins conflict rather than bypass replacement or the device ceiling; a
    // late write cannot restore an old head. Never use a mutable snapshot here.
    devices[deviceHash] = session.id;
    await repo.putNew(`${loginPrefix(user.id)}/${String(generation).padStart(12, '0')}.json`, {
      devices, generation, expiresAt: session.expiresAt,
    });
    return { credentials: await issue(session), session };
  }
  async function refresh(body, kind) {
    const hash = device(body.deviceId);
    if (typeof body.refreshToken !== 'string' || !TOKEN.test(body.refreshToken)) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const ticket = await repo.get(tokenKey('refresh', body.refreshToken));
    if (!ticket || ticket.expiresAt <= now()) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const { session } = await validSession(ticket.sessionId, { userId: ticket.userId });
    if (session.kind !== kind) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    if (hash !== session.deviceHash) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    try { await repo.putNew(tokenKey('spent', body.refreshToken), { spentAt: now(), expiresAt: session.expiresAt }); }
    catch (error) {
      if (!isConflict(error)) throw error;
      await revoke(session.id, session.expiresAt);
      fail(401, 'REFRESH_REPLAYED', '检测到重复刷新，请重新登录此设备。');
    }
    return { credentials: await issue(session), session };
  }
  async function authenticate(token, kind) {
    if (typeof token !== 'string' || !TOKEN.test(token)) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const ticket = await repo.get(tokenKey('access', token));
    if (!ticket || ticket.expiresAt <= now()) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const { user, session, loginHead } = await validSession(ticket.sessionId, { userId: ticket.userId });
    if (session.kind !== kind) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    return { user, session, sessionId: session.id, kind, mfaVerified: session.mfaVerified, loginHead };
  }
  async function list(user, tip) {
    const items = await Promise.all(Object.values(tip.devices).map(async (id) => {
      try {
        const { session } = await validSession(id, { user, tip });
        return { id, deviceName: session.deviceName, kind: session.kind, createdAt: session.createdAt, expiresAt: session.expiresAt };
      } catch (error) { if (error.status === 401) return null; throw error; }
    }));
    return items.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function revokeOwned(userId, id) {
    if (!ID.test(id)) fail(404, 'DEVICE_NOT_FOUND', '设备不存在。');
    const session = await repo.get(sessionKey(id));
    if (session?.userId !== userId) fail(404, 'DEVICE_NOT_FOUND', '设备不存在。');
    await revoke(id, session.expiresAt);
  }
  return { start, refresh, authenticate, list, revokeOwned };
}
