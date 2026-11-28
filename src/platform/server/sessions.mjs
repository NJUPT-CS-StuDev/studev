import { base64url, concat, digest, equalBytes, fromBase64, hmac, randomToken, randomUUID, utf8 } from './crypto.mjs';
import { fail, text } from './common.mjs';
import { isConflict } from './store.mjs';

const ACCESS_SECONDS = 600;
const DAY_MS = 86400000;
const IDLE_MS = 30 * DAY_MS;
const maxExpiry = (session, role) => Date.parse(session.createdAt) + (role === 'user' ? 180 : 90) * DAY_MS;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const ACCESS = /^[A-Za-z0-9_-]{120,400}$/;
const ID = /^[a-f0-9-]{36}$/;
const bootstrapRoute = (path) => ['/api/platform/auth/register', '/api/platform/auth/login', '/api/platform/auth/refresh'].includes(path);
export const bearerBootstrap = (request, path) => bootstrapRoute(path) && !request.headers.has('origin') && !request.headers.has('cookie') && !request.headers.has('sec-fetch-site');
export const hasAuthorization = (request) => request.headers.has('authorization');

// All security decisions use immutable records/conditional creation. A stale
// materialized revision can never undo a revocation or spend a refresh twice.
export function createSessions({ repo, now, loadUser, secret }) {
  const sessionKey = (id) => `identity/devices/sessions/${id}.json`;
  const expiryKey = (id) => `identity/devices/expiry/${id}.json`;
  const revokedKey = (id) => `identity/devices/revoked/${id}.json`;
  const tokenKey = (kind, token) => `identity/devices/${kind}/${digest(token)}.json`;
  const loginPrefix = (userId) => `identity/devices/logins/${userId}`;
  const loginTip = (userId, known) => repo.latest(loginPrefix(userId), 12, known);
  const statePrefix = (id) => `identity/devices/state/${id}`;
  // An access credential is a sealed claim, not a stored record: it names its
  // session and owner, its deadline, and the revisions of the session state,
  // login head and account it was issued against. Every request still reads
  // those authoritative records, so revocation stays immediate; the claim only
  // lets all of them be read at once, without a listing.
  const mac = (body) => hmac(secret, 'studev-access\0', body);
  function seal(claim) {
    const body = utf8(JSON.stringify(claim));
    return base64url(concat(body, mac(body)));
  }
  function unseal(token) {
    if (typeof token !== 'string' || !ACCESS.test(token)) return null;
    let raw;
    try { raw = fromBase64(token); } catch { return null; }
    const body = raw.subarray(0, -32), tag = raw.subarray(-32);
    if (tag.length !== 32 || !equalBytes(tag, mac(body))) return null;
    try { return JSON.parse(new TextDecoder().decode(body)); } catch { return null; }
  }
  function device(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail(400, 'INVALID_DEVICE', '设备标识无效，请重新安装后重试。');
    return digest(value);
  }
  async function revoke(id, expiresAt) {
    try { await repo.putNew(revokedKey(id), { revokedAt: new Date(now()).toISOString(), expiresAt }); }
    catch (error) { if (!isConflict(error)) throw error; }
  }
  async function validSession(id, known = {}) {
    const seen = known.revisions ?? [];
    const [original, revoked, state, ticketIdentity, renewal] = await Promise.all([
      repo.get(sessionKey(id)), repo.get(revokedKey(id)), repo.latest(statePrefix(id), 8, seen[0]),
      // A ticket names the immutable session's owner, so these authoritative
      // reads can run alongside the session reads.
      known.userId ? Promise.all([
        loginTip(known.userId, seen[1]),
        loadUser(known.userId, seen[2]),
      ]) : null,
      // Access and refresh already carry a deadline. Only inventory needs to
      // read the newest deadline rather than the caller's own ticket.
      known.userId ? null : repo.get(expiryKey(id)),
    ]);
    const ownerId = known.userId ?? known.user?.id;
    if (!original || revoked || (ownerId && original.userId !== ownerId)) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const [tip, user] = ticketIdentity ?? await Promise.all([
      known.tip ?? loginTip(original.userId), known.user ?? loadUser(original.userId),
    ]);
    if (!tip || tip.devices[original.deviceHash] !== id) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    // TOTP confirmation elevates this session's security version, just as it
    // does for web sessions. Revocation and absolute expiry remain immutable.
    const expiresAt = Math.min(known.expiresAt ?? renewal?.expiresAt ?? original.expiresAt, maxExpiry(original, user?.role));
    if (!(expiresAt > now())) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const session = { ...original, ...state, expiresAt };
    if (!user || user.status !== 'active' || user.securityVersion !== session.securityVersion) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    return { user, session, loginHead: tip };
  }

  async function issue(session, user, generation) {
    const refreshToken = randomToken();
    const started = now();
    if (!(session.expiresAt > started)) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    // A web cookie carries the refresh credential beside the access one, so a short access life protects nothing there;
    // it lasts the idle window. An app's access token travels alone and stays short. Every request checks revocation.
    const expiresAt = session.kind === 'cookie' ? session.expiresAt : Math.min(started + ACCESS_SECONDS * 1000, session.expiresAt);
    const accessToken = seal({ s: session.id, u: session.userId, x: expiresAt, e: session.expiresAt, r: [session.revision ?? 0, generation, user.revision] });
    await repo.putNew(tokenKey('refresh', refreshToken), { sessionId: session.id, userId: session.userId, expiresAt: session.expiresAt });
    return { tokenType: 'Bearer', accessToken, refreshToken, expiresIn: Math.max(0, Math.floor((expiresAt - now()) / 1000)), refreshExpiresAt: session.expiresAt, deviceSessionId: session.id };
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
      if (record.deviceHash === deviceHash) await revoke(record.id, maxExpiry(record, user.role));
      else devices[record.deviceHash] = record.id;
    }
    if (Object.keys(devices).length >= 20) fail(429, 'DEVICE_LIMIT', '已登录设备过多，请先在网页账号中心退出不再使用的设备。');
    const generation = (tip?.generation ?? 0) + 1;
    const started = now();
    const session = { id: randomUUID(), loginGeneration: generation, userId: user.id, securityVersion: user.securityVersion, deviceHash, deviceName,
      kind, csrfToken: randomToken(), mfaVerified, createdAt: new Date(started).toISOString(), expiresAt: started + IDLE_MS };
    // Publish metadata before the head so a following login on another device
    // can retain this family even while its credentials are still being issued.
    await repo.putNew(sessionKey(session.id), session);
    // Reserve an immutable generation before publishing credentials. Concurrent
    // logins conflict rather than bypass replacement or the device ceiling; a
    // late write cannot restore an old head. Never use a mutable snapshot here.
    devices[deviceHash] = session.id;
    await repo.putNew(`${loginPrefix(user.id)}/${String(generation).padStart(12, '0')}.json`, {
      devices, generation, expiresAt: maxExpiry(session, user.role),
    });
    return { credentials: await issue(session, user, generation), session };
  }
  async function refresh(body, kind) {
    const hash = device(body.deviceId);
    if (body.foreground !== undefined && typeof body.foreground !== 'boolean') fail(400, 'INVALID_FIELD', '使用状态无效。');
    if (typeof body.refreshToken !== 'string' || !TOKEN.test(body.refreshToken)) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const ticket = await repo.get(tokenKey('refresh', body.refreshToken));
    if (!ticket || ticket.expiresAt <= now()) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const { user, session, loginHead } = await validSession(ticket.sessionId, { userId: ticket.userId, expiresAt: ticket.expiresAt });
    if (session.kind !== kind) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    if (hash !== session.deviceHash) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const started = now();
    if (session.expiresAt <= started) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const limit = maxExpiry(session, user.role);
    try { await repo.putNew(tokenKey('spent', body.refreshToken), { spentAt: started, expiresAt: ticket.expiresAt }); }
    catch (error) {
      if (!isConflict(error)) throw error;
      await revoke(session.id, limit);
      fail(401, 'REFRESH_REPLAYED', '检测到重复刷新，请重新登录此设备。');
    }
    const expiresAt = body.foreground === true ? Math.min(Math.max(session.expiresAt, started + IDLE_MS), limit) : session.expiresAt;
    const renewed = { ...session, expiresAt };
    const credentials = await issue(renewed, user, loginHead.generation);
    // A refresh ticket has only one successor, so this inventory snapshot
    // advances along a single chain. Authorization always uses the ticket
    // deadline and the immutable family/revocation records, never this view.
    if (expiresAt > session.expiresAt) await repo.put(expiryKey(session.id), { expiresAt });
    return { credentials, session: renewed };
  }
  async function authenticate(token, kind) {
    const claim = unseal(token);
    if (!claim || !(claim.x > now()) || !ID.test(claim.s) || typeof claim.u !== 'string' || !Array.isArray(claim.r)) fail(401, 'TOKEN_INVALID', '登录已失效，请重新登录。');
    const { user, session, loginHead } = await validSession(claim.s, { userId: claim.u, expiresAt: claim.e, revisions: claim.r });
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
    await revoke(id, maxExpiry(session, 'user'));
  }
  return { start, refresh, authenticate, list, revokeOwned };
}
