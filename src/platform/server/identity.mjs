import { digest, hashPassword, randomHex, randomToken, randomUUID, safeEqual, validPasswordHash, verifyPassword } from './crypto.mjs';
import { fail, platformOrigin, readJson, requireOrigin, response, text } from './common.mjs';
import { isConflict } from './store.mjs';
import { createSessions, hasAuthorization, bearerBootstrap } from './sessions.mjs';
import { decryptTotp, encryptTotp, matchedTotpCounter, newTotpSecret } from './totp.mjs';
import { createMailer, letter } from './mail.mjs';
import { hasPublishedRosterAppointment, publishRosterPerson, readRosterPeople, rosterView, qqAvatarUrl, profileNickname } from './roster.mjs';
import { deleteOrganization, loadOrganizations, membershipView, overlapsMembership, saveOrganization, validateMemberships } from './organizations.mjs';
import { academicYearId, academicYearWindow, activeMemberships, chinaDay, flattenOrganizationTree, namedOrganizations, organization, validAcademicYear } from '../organizations.mjs';
import { avatarBody, createMembers, memberId } from './members.mjs';

const API = '/api/platform';
const ID = /^[a-f0-9-]{36}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const QQ = /^[1-9]\d{4,11}$/;
const userKey = (id) => `identity/users/${id}`;
const staffRole = (role) => role === 'admin' || role === 'owner';
const iso = (now) => new Date(now()).toISOString();
const secretToken = () => randomToken();

export function normalizeStudentId(value) {
  if (typeof value !== 'string') fail(400, 'INVALID_STUDENT_ID', '请填写 6–20 位字母或数字学号。');
  const normalized = value.normalize('NFKC').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(normalized)) fail(400, 'INVALID_STUDENT_ID', '请填写 6–20 位字母或数字学号。');
  return normalized;
}
export function normalizeRealName(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) fail(400, 'INVALID_REAL_NAME', '请填写 1–40 字符真实姓名，不要包含换行或控制字符。');
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || [...normalized].length > 40) fail(400, 'INVALID_REAL_NAME', '请填写 1–40 字符真实姓名。');
  return normalized;
}
function profileComplete(user) {
  try { return normalizeStudentId(user.studentId) === user.studentId && normalizeRealName(user.realName) === user.realName; }
  catch { return false; }
}
const studentKey = (studentId) => `identity/student/${studentId}.json`;

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) fail(400, 'PASSWORD_POLICY', '密码需要 12–256 个字符。');
  return value;
}
function qqValue(value) {
  if (typeof value !== 'string' || !QQ.test(value)) fail(400, 'INVALID_QQ', '请填写有效的数字 QQ 号。');
  return value;
}
function clientId(context) {
  // Only trust the connection address the edge supplies, never caller-controlled headers.
  const address = context.eo?.clientIp;
  return typeof address === 'string' && address.length <= 100 ? address : 'unknown';
}
function cookieValue(request, name) {
  const cookies = String(request.headers.get('cookie') || '').split(';').map((v) => v.trim());
  const matches = cookies.filter((v) => v.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

export function createIdentity({ repo, env, now = Date.now, academicYear, mailer = createMailer({ env, repo }), fetcher = globalThis.fetch }) {
  const origin = platformOrigin(env);
  const members = createMembers(repo, origin);
  const local = origin.startsWith('http://');
  const cookieName = local ? 'studev_platform_dev' : '__Host-studev_platform';
  const sessionSecret = env.PLATFORM_SESSION_SECRET;
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32 || !validPasswordHash(env.PLATFORM_OWNER_PASSWORD_HASH) || !QQ.test(String(env.PLATFORM_OWNER_QQ || '')) || !/^[A-Za-z0-9+/]{43}=$/.test(String(env.PLATFORM_ENCRYPTION_KEY || ''))) {
    fail(503, 'NOT_CONFIGURED', '平台身份配置尚未完成。');
  }
  let bootstrapPromise;
  const sessions = createSessions({ repo, now, secret: sessionSecret, loadUser: (id, known) => repo.latest(userKey(id), 8, known) });
  const authRequests = new WeakMap();
  const authSessionKey = (auth) => `identity/devices/state/${auth.sessionId}`;
  function appointmentYear() {
    const id = academicYearId(chinaDay(now()));
    return academicYear?.id === id ? academicYear : academicYearWindow(id);
  }
  function publicUser(user, orgs = namedOrganizations, history = false) {
    return {
      id: user.id,
      qq: user.qq || '',
      avatarUrl: user.avatarUrl || qqAvatarUrl(user.qq),
      nickname: profileNickname(user),
      email: user.email || '',
      emailVerified: user.emailVerified === true,
      studentId: user.studentId || '',
      realName: user.realName || '',
      identityVerified: user.identityVerified === true,
      profileComplete: profileComplete(user),
      memberships: membershipView(history ? user.memberships : activeMemberships(user.memberships, chinaDay(now())), orgs),
      signature: user.signature || '',
      role: user.role,
      status: user.status,
      revision: user.revision,
      totpEnabled: Boolean(user.totp),
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }
  async function bootstrap() {
    bootstrapPromise ||= (async () => {
      const qq = String(env.PLATFORM_OWNER_QQ);
      const indexKey = `identity/qq/${qq}.json`;
      let index = await repo.get(indexKey);
      if (!index) {
        const proposed = { id: randomUUID() };
        try { await repo.putNew(indexKey, proposed); index = proposed; }
        catch (error) { if (!isConflict(error)) throw error; index = await repo.get(indexKey); }
      }
      if (!index || !ID.test(index.id)) fail(503, 'IDENTITY_UNAVAILABLE', '账号初始化暂未完成，请稍后重试。');
      const existing = await repo.latest(userKey(index.id));
      if (existing) {
        if (existing.qq !== qq || existing.role !== 'owner') fail(503, 'OWNER_CONFIGURATION_CONFLICT', '所有者配置需要维护。');
        return;
      }
      const user = { id: index.id, qq, nickname: text(env.PLATFORM_OWNER_NICKNAME || 'StuDev Owner', '昵称', 40, true), email: `${qq}@qq.com`, emailVerified: false,
        studentId: normalizeStudentId(env.PLATFORM_OWNER_STUDENT_ID), realName: normalizeRealName(env.PLATFORM_OWNER_REAL_NAME), identityVerified: true,
        memberships: [], signature: '',
        role: 'owner', status: 'active', passwordHash: env.PLATFORM_OWNER_PASSWORD_HASH, mustChangePassword: true,
        securityVersion: secretToken(), totp: null, createdAt: iso(now), updatedAt: iso(now) };
      try { await claimStudent(user.studentId, user.id); await createUser(user); await repo.audit('system', 'identity.owner.initialized', index.id); }
      catch (error) { if (!isConflict(error)) throw error; const winner = await repo.latest(userKey(index.id)); if (winner?.role !== 'owner') throw error; }
    })();
    return bootstrapPromise;
  }
  function sessionCookie(name, token, seconds) {
    return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${local ? '' : '; Secure'}`;
  }
  function cookieCredentials(value) {
    const parts = String(value || '').split('.');
    return parts.length === 2 && /^[A-Za-z0-9_-]{1,400}$/.test(parts[0]) && TOKEN.test(parts[1]) ? { accessToken: parts[0], refreshToken: parts[1] } : null;
  }
  function credentialResponse({ credentials, session }, body = {}) {
    const payload = { ...body, deviceSessionId: session.id, csrfToken: session.csrfToken };
    if (session.kind === 'bearer') return response({ ...payload, ...credentials });
    const result = response(payload);
    result.headers.set('Set-Cookie', sessionCookie(cookieName, `${credentials.accessToken}.${credentials.refreshToken}`, Math.max(0, Math.floor((session.expiresAt - now()) / 1000))));
    return result;
  }
  function signedOutResponse(kind) {
    if (kind === 'bearer') return response({ ok: true });
    const result = response({ ok: true });
    result.headers.set('Set-Cookie', sessionCookie(cookieName, '', 0));
    return result;
  }
  function setupStatus(user, session) {
    return {
      mfaRequired: Boolean(user.totp) && !session.mfaVerified,
      enrollmentRequired: user.role === 'owner' && !user.totp,
      profileRequired: !profileComplete(user),
      passwordChangeRequired: Boolean(user.mustChangePassword),
      mfaVerified: Boolean(session.mfaVerified),
    };
  }
  const needsSetup = state => state.passwordChangeRequired || state.enrollmentRequired || state.mfaRequired || state.profileRequired;
  async function authenticate(request, { required = false, staff = false, owner = false, csrf = false, allowEnrollment = false } = {}) {
    const kind = hasAuthorization(request) ? 'bearer' : 'cookie';
    const header = request.headers.get('authorization') || '';
    const token = kind === 'bearer' ? /^Bearer ([A-Za-z0-9_-]+)$/i.exec(header)?.[1] : cookieCredentials(cookieValue(request, cookieName))?.accessToken;
    if (!authRequests.has(request)) authRequests.set(request,
      kind === 'cookie' && !token ? Promise.resolve(null) : sessions.authenticate(token, kind));
    const auth = await authRequests.get(request);
    const user = auth?.user, session = auth?.session;
    if (!user) {
      if (required || staff || owner || csrf) fail(401, 'AUTH_REQUIRED', '请先登录。');
      return null;
    }
    if (owner && user.role !== 'owner') fail(403, 'OWNER_REQUIRED', '此操作仅限所有者。');
    if (staff && !staffRole(user.role)) fail(403, 'STAFF_REQUIRED', '此操作仅限管理员。');
    const state = setupStatus(user, session);
    if (!allowEnrollment && needsSetup(state)) fail(403, 'AUTH_SETUP_REQUIRED', '请先完成身份资料、密码修改与安全验证。');
    if ((owner || user.role === 'owner' || user.totp) && !allowEnrollment && !session.mfaVerified) fail(403, 'MFA_REQUIRED', '请完成动态验证码验证。');
    if (csrf && kind === 'cookie') {
      requireOrigin(request, env);
      if (!safeEqual(request.headers.get('x-csrf-token') || '', session.csrfToken)) fail(403, 'CSRF_REJECTED', '页面已失效，请刷新后重试。');
    }
    return { user, csrfToken: session.csrfToken, sessionId: session.id, mfaVerified: Boolean(session.mfaVerified), session, kind, loginHead: auth.loginHead };
  }
  async function readMembers(request, id) {
    const url = new URL(request.url);
    const entry = url.searchParams.get('entry') === '1';
    const auth = await authenticate(request, { required: true, allowEnrollment: entry });
    const setup = setupStatus(auth.user, auth.session);
    async function read() {
      if (entry && (needsSetup(setup) || (!id && staffRole(auth.user.role)))) return {};
      if (id) {
        if (!memberId.test(id)) fail(404, 'MEMBER_NOT_FOUND', '找不到这位成员。');
        return { member: await members.get(id) };
      }
      const query = text(url.searchParams.get('query') || '', '昵称', 40).normalize('NFKC').toLocaleLowerCase('zh-CN');
      const offset = Number(url.searchParams.get('offset') || '0'), limit = Number(url.searchParams.get('limit') || '50');
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail(400, 'INVALID_PAGE', '成员列表页码无效。');
      return members.list(query, offset, limit);
    }
    const [data, organizations] = await Promise.all([read(), entry ? loadOrganizations(repo) : null]);
    return response(entry ? { ...data, session: { user: publicUser(auth.user, organizations), csrfToken: auth.csrfToken, ...setup } } : data);
  }
  // `verified` settles once every factor checked in parallel with the session reads has passed; nothing is written before.
  async function sessionResponse(user, body, kind, verified, mfaVerified = Boolean(verified)) {
    const [started, orgs] = await Promise.all([
      sessions.start(user, body, { kind, mfaVerified, verified }), loadOrganizations(repo),
      verified?.then(() => members.publish(user, user)) ?? members.publish(user, user),
    ]);
    return credentialResponse(started, { user: publicUser(user, orgs), ...setupStatus(user, started.session) });
  }
  const DIRECTORY_INDEX_KEY = 'identity/directory-index.json';
  function directoryEntry(user) {
    return {
      id: user.id,
      qq: user.qq || '',
      avatarUrl: user.avatarUrl || '',
      nickname: user.nickname || '',
      email: user.email || '',
      emailVerified: user.emailVerified === true,
      studentId: user.studentId || '',
      realName: user.realName || '',
      identityVerified: user.identityVerified === true,
      memberships: Array.isArray(user.memberships) ? user.memberships : [],
      signature: user.signature || '',
      role: user.role,
      status: user.status,
      revision: user.revision,
      totp: Boolean(user.totp),
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }
  async function syncDirectoryIndex(usersToUpsert = [], idsToDelete = []) {
    const existing = await repo.get(DIRECTORY_INDEX_KEY);
    if (!existing || existing.version !== 1 || !existing.byId) return;
    for (const u of usersToUpsert) existing.byId[u.id] = directoryEntry(u);
    for (const id of idsToDelete) delete existing.byId[id];
    await repo.put(DIRECTORY_INDEX_KEY, existing);
  }
  async function publishAppointmentChanges(next, previous, orgs) {
    if (!next.memberships?.some(row => row.title && row.startsOn) && !previous?.memberships?.some(row => row.title && row.startsOn)) return;
    await publishRosterPerson(repo, next, previous, orgs ?? await loadOrganizations(repo));
  }
  async function saveUser(current, changes, { syncIndex = true, orgs } = {}) {
    const next = await repo.append(userKey(current.id), { ...current, ...changes, updatedAt: iso(now) }, current.revision);
    await Promise.all([members.publish(next, current), publishAppointmentChanges(next, current, orgs)]);
    if (syncIndex) await syncDirectoryIndex([next]);
    return next;
  }
  async function createUser(user, { syncIndex = true, orgs } = {}) {
    const next = await repo.append(userKey(user.id), user, 0);
    await Promise.all([members.publish(next), publishAppointmentChanges(next, undefined, orgs)]);
    if (syncIndex) await syncDirectoryIndex([next]);
    return next;
  }
  async function claimStudent(studentId, id) {
    const existing = await repo.get(studentKey(studentId));
    if (existing) {
      if (existing.id !== id) fail(409, 'STUDENT_ID_ALREADY_REGISTERED', '该学号已绑定其他账号，请核实或联系所有者。');
      return;
    }
    try { await repo.putNew(studentKey(studentId), { id }); }
    catch (error) {
      // Do not remove a claim after transport ambiguity: a successful write may already exist.
      if (!isConflict(error)) throw error;
      const winner = await repo.get(studentKey(studentId));
      if (!winner || winner.id !== id) fail(409, 'STUDENT_ID_ALREADY_REGISTERED', '该学号已绑定其他账号，请核实或联系所有者。');
    }
  }
  async function bindStudent(current, studentId, realName) {
    if (studentId !== current.studentId) {
      // Reserve one target per account revision before claiming a student ID.
      // Initial binding and staff corrections use this same mechanism.
      const key = `identity/binding/${current.id}/${current.revision}.json`;
      let intent = await repo.get(key);
      if (!intent) {
        // Reject the usual typo/occupied-ID case without leaving a binding intent.
        const existing = await repo.get(studentKey(studentId));
        if (existing && existing.id !== current.id) fail(409, 'STUDENT_ID_ALREADY_REGISTERED', '该学号已绑定其他账号，请核实或联系所有者。');
        const proposed = { studentId, realName };
        try { await repo.putNew(key, proposed); intent = proposed; }
        catch (error) {
          // A transport error can hide a committed intent. Preserve it so the same
          // target can safely resume, rather than rolling back another request.
          if (!isConflict(error)) throw error;
          intent = await repo.get(key);
        }
      }
      if (intent?.studentId !== studentId || intent?.realName !== realName) fail(409, 'PROFILE_BINDING_PENDING', '此账号已有待完成的身份绑定，请使用原学号与姓名重试或联系所有者核查。');
    }
    await claimStudent(studentId, current.id);
  }
  function requireFactorCode(code) {
    if (code === undefined || code === null || (typeof code === 'string' && !code.trim())) fail(401, 'MFA_REQUIRED', '请输入你的动态验证码或恢复码。');
  }
  async function consumeFactor(user, code) {
    if (!user.totp) fail(400, 'TOTP_NOT_ENABLED', '尚未绑定认证器。');
    requireFactorCode(code);
    if (typeof code !== 'string' || code.length > 64) fail(401, 'MFA_INVALID', '动态验证码或恢复码无效。');
    const normalized = code.trim().toUpperCase();
    const recoveryHash = digest(`${user.id}:${normalized}`);
    let key;
    if (user.totp.recoveryHashes?.includes(recoveryHash)) {
      key = `identity/recovery-used/${user.id}/${user.totp.epoch}/${recoveryHash}.json`;
    } else {
      const secret = await decryptTotp(user.totp.encrypted, env.PLATFORM_ENCRYPTION_KEY, user.id);
      const counter = matchedTotpCounter(secret, normalized, now());
      if (counter === null) fail(401, 'MFA_INVALID', '动态验证码或恢复码无效。');
      key = `identity/totp-used/${user.id}/${user.totp.epoch}/${counter}.json`;
    }
    try { await repo.putNew(key, { usedAt: iso(now) }); }
    catch (error) { if (isConflict(error)) fail(401, 'MFA_REPLAYED', '此验证码已使用，请使用下一个验证码或未使用的恢复码。'); throw error; }
  }
  async function authorizeCredentialChange(user, code) {
    if (!user.totp) fail(403, 'TOTP_NOT_ENABLED', '请先在账号安全中绑定验证器，再办理此操作。');
    await repo.throttle('management-factor', user.id, 8, 60);
    await consumeFactor(user, code);
  }
  async function loadUser(id) {
    if (!ID.test(id)) fail(404, 'USER_NOT_FOUND', '账号不存在。');
    const user = await repo.latest(userKey(id));
    if (!user) fail(404, 'USER_NOT_FOUND', '账号不存在。');
    return user;
  }
  // Account mail: a link carries a one-time token whose hash names a record that knows the purpose, the account and
  // the account's security version, so a password change or a newer link makes an older one useless.
  const tokenKey = (token) => `identity/tokens/${digest(token)}.json`;
  async function mailLink(user, purpose, path, minutes) {
    const token = secretToken();
    await repo.put(tokenKey(token), { purpose, userId: user.id, securityVersion: user.securityVersion, expiresAt: now() + minutes * 60_000 });
    return `${origin}${path}?${purpose}=${token}`;
  }
  async function spendToken(purpose, token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) fail(400, 'LINK_INVALID', '链接无效或已过期，请重新申请。');
    const record = await repo.get(tokenKey(token));
    if (record) await repo.remove(tokenKey(token));
    const user = record?.purpose === purpose && record.expiresAt > now() ? await repo.latest(userKey(record.userId)) : null;
    if (!user || user.status !== 'active' || user.securityVersion !== record.securityVersion) fail(400, 'LINK_INVALID', '链接无效或已过期，请重新申请。');
    return user;
  }
  async function deleteUser(user) {
    if (user.role === 'owner') fail(403, 'CANNOT_DELETE_OWNER', '不能删除所有者账号。');
    await saveUser(user, { status: 'disabled', securityVersion: secretToken() }, { syncIndex: false });
    if (user.qq) await repo.remove(`identity/qq/${user.qq}.json`);
    if (user.studentId) await repo.remove(studentKey(user.studentId));
    for (const key of await repo.list(`identity/users/${user.id}`)) await repo.remove(key);
    await syncDirectoryIndex([], [user.id]);
  }
  // After a password changes, the account's mailbox hears of it, so a change nobody asked for is noticed at once.
  async function tellPasswordChanged(user) {
    if (!mailer.enabled || !user.email) return;
    try {
      await mailer.deliver({ to: user.email, subject: 'StuDev 密码已修改',
        ...letter({ greeting: `${user.nickname}，你好：`, lines: [`你的 StuDev 账号（学号 ${user.studentId}）的密码刚刚修改，所有设备都已退出登录。`, '如果是你自己改的，忽略这封信即可。'], action: { label: '不是我改的？重设密码', url: `${origin}/login/` }, footer: '如果不是你本人操作，请立刻用“忘记密码”重设，并联系管理员。' }) });
    } catch { /* The change itself stands even when the note cannot go out. */ }
  }
  async function loadAllUsersCanonical() {
    const [qqKeys, studentKeys] = await Promise.all([repo.list('identity/qq/'), repo.list('identity/student/')]);
    const keys = [...qqKeys, ...studentKeys];
    const indices = [];
    for (let offset = 0; offset < keys.length; offset += 32) indices.push(...await Promise.all(keys.slice(offset, offset + 32).map(key => repo.get(key))));
    const seen = new Set();
    const uniqueIds = [];
    for (const index of indices) {
      if (ID.test(index?.id || '') && !seen.has(index.id)) {
        seen.add(index.id);
        uniqueIds.push(index.id);
      }
    }
    const users = [];
    for (let offset = 0; offset < uniqueIds.length; offset += 32) users.push(...await Promise.all(uniqueIds.slice(offset, offset + 32).map(id => repo.latest(userKey(id)))));
    return users.filter(Boolean);
  }
  async function loadAllUsers({ refresh = false } = {}) {
    if (!refresh) {
      const cached = await repo.get(DIRECTORY_INDEX_KEY);
      if (cached?.version === 1 && cached.byId) return Object.values(cached.byId);
    }
    const users = await loadAllUsersCanonical();
    const byId = {};
    for (const u of users) byId[u.id] = directoryEntry(u);
    await repo.put(DIRECTORY_INDEX_KEY, { version: 1, byId });
    return Object.values(byId);
  }
  async function handle(context, rawPath) {
    const path = rawPath.split('?')[0].replace(/\/+$/, '');
    if (!path.startsWith(`${API}/auth/`) && !path.startsWith(`${API}/members`) && !path.startsWith(`${API}/organizations`) && !path.startsWith(`${API}/admin/organizations`) && !path.startsWith(`${API}/admin/users`) && !path.startsWith(`${API}/public/roster`) && path !== `${API}/admin/audit`) return null;
    const request = context.request;
    const route = path.slice(API.length);
    const method = request.method;
    if (method === 'GET' && route === '/organizations') {
      const orgs = await loadOrganizations(repo);
      return response({ items: flattenOrganizationTree(orgs), academicYear: appointmentYear() });
    }
    if (method === 'POST' && route === '/admin/organizations') {
      const auth = await authenticate(request, { owner: true, csrf: true });
      const body = await readJson(request, 16384);
      const saved = await saveOrganization(repo, body);
      await repo.audit(auth.user.id, 'organization.saved', saved.organization.id, { name: saved.organization.name, parentId: saved.organization.parentId });
      return response(saved, 201);
    }
    const orgDelete = route.match(/^\/admin\/organizations\/(.+?)(?:\/delete)?$/);
    if ((method === 'DELETE' || (method === 'POST' && route.endsWith('/delete'))) && orgDelete) {
      const auth = await authenticate(request, { owner: true, csrf: true });
      const targetId = decodeURIComponent(orgDelete[1]);
      if ((await loadAllUsersCanonical()).some(user => user.memberships?.some(row => row.organizationId === targetId || row.overseesOrganizationId === targetId))) {
        fail(409, 'ORGANIZATION_IN_USE', '此组织还有任职或归属记录。');
      }
      const result = await deleteOrganization(repo, targetId);
      await repo.audit(auth.user.id, 'organization.deleted', targetId);
      return response(result);
    }
    const memberAvatar = route.match(/^\/members\/([a-f0-9-]{36})\/avatar$/);
    if (method === 'GET' && memberAvatar) {
      const user = await repo.latest(userKey(memberAvatar[1]));
      const visible = user?.status === 'active' || (user?.status === 'pending'
        && await hasPublishedRosterAppointment(repo, user.id, await loadOrganizations(repo), chinaDay(now())));
      if (!visible) fail(404, 'MEMBER_NOT_FOUND', '找不到这位成员。');
      // The image is public; its address must not disclose the private QQ number.
      let picture;
      try { picture = await fetcher(qqAvatarUrl(user.qq), { signal: AbortSignal.timeout(8000), redirect: 'error' }); }
      catch { fail(502, 'AVATAR_UNAVAILABLE', '头像暂时无法加载。'); }
      const type = picture.headers.get('Content-Type')?.split(';')[0].trim();
      if (!picture.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type) || Number(picture.headers.get('Content-Length') || 0) > 2 * 1024 * 1024) fail(502, 'AVATAR_UNAVAILABLE', '头像暂时无法加载。');
      const bytes = await avatarBody(picture);
      return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=900', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
    }
    const memberDetail = route.match(/^\/members\/([^/]+)$/);
    if (method === 'GET' && (route === '/members' || memberDetail)) return readMembers(request, memberDetail?.[1]);
    // Existing credentials and public reads do not need to initialize the owner
    // again. Registration/login/reset-mail remain the account bootstrap paths.
    if (method === 'POST' && ['/auth/register', '/auth/password/forgot'].includes(route)) await bootstrap();
    if (method === 'POST' && route === '/auth/refresh') {
      const kind = bearerBootstrap(request, path) ? 'bearer' : 'cookie';
      if (kind === 'cookie') requireOrigin(request, env);
      const body = await readJson(request, 8192);
      await repo.throttle('token-refresh-client', clientId(context), 60, 60);
      if (kind === 'cookie') body.refreshToken = cookieCredentials(cookieValue(request, cookieName))?.refreshToken;
      return credentialResponse(await sessions.refresh(body, kind));
    }
    if (method === 'GET' && route === '/auth/devices') {
      const auth = await authenticate(request, { required: true });
      return response({ items: (await sessions.list(auth.user, auth.loginHead)).map(item => ({ ...item, current: item.id === auth.sessionId })) });
    }
    const device = route.match(/^\/auth\/devices\/([a-f0-9-]{36})\/revoke$/);
    if (method === 'POST' && device) {
      const auth = await authenticate(request, { required: true, csrf: true });
      await sessions.revokeOwned(auth.user.id, device[1]);
      await repo.audit(auth.user.id, 'identity.device.revoked', device[1]);
      return response({ ok: true });
    }
    if (method === 'GET' && route === '/auth/config') return response({ registrationEnabled: true, emailDeliveryEnabled: mailer.enabled });
    if (method === 'GET' && route === '/public/roster') {
      const year = new URL(request.url).searchParams.get('year');
      if (year !== null && !validAcademicYear(year)) fail(400, 'INVALID_ACADEMIC_YEAR', '请选择有效的学年。');
      const [people, orgs] = await Promise.all([readRosterPeople(repo), loadOrganizations(repo)]);
      return response(rosterView(people, orgs, origin, chinaDay(now()), year));
    }
    const userLookup = route.match(/^\/admin\/users\/([a-f0-9-]{36})$/);
    if (method === 'GET' && userLookup) {
      await authenticate(request, { staff: true });
      const [user, orgs] = await Promise.all([loadUser(userLookup[1]), loadOrganizations(repo)]);
      return response({ user: publicUser(user, orgs, true) });
    }
    if (method === 'POST' && route === '/auth/register') {
      if (!bearerBootstrap(request, path)) requireOrigin(request, env);
      const body = await readJson(request, 8192);
      await repo.throttle('register-client', clientId(context), 60, 600);
      const qq = qqValue(body.qq), password = validatePassword(body.password);
      const studentId = normalizeStudentId(body.studentId), realName = normalizeRealName(body.realName);
      const nickname = text(body.nickname, '昵称', 40);
      await repo.throttle('register-account', qq, 3, 600);
      // Check if this studentId belongs to a pre-recorded pending account
      const studentClaim = await repo.get(studentKey(studentId));
      const claimedUser = studentClaim?.id && ID.test(studentClaim.id) ? await repo.latest(userKey(studentClaim.id)) : null;
      if (claimedUser?.status === 'pending') {
        if (claimedUser.role !== 'user') {
          fail(409, 'ACCOUNT_PENDING_REVIEW', '此学号已有预录账号，请联系管理员核实并激活。');
        }
        if (claimedUser.realName !== realName) {
          fail(409, 'STUDENT_ID_ALREADY_REGISTERED', '学号与预录姓名不匹配，请核实或联系所有者。');
        }
        if (claimedUser.qq && claimedUser.qq !== qq) {
          fail(409, 'ACCOUNT_PENDING_REVIEW', '此学号已预录绑定其他 QQ，请联系管理员核实。');
        }
        const qqIndexKey = `identity/qq/${qq}.json`;
        const existingQq = await repo.get(qqIndexKey);
        if (existingQq && existingQq.id !== claimedUser.id) {
          fail(409, 'QQ_ALREADY_REGISTERED', '此 QQ 号已注册，请登录或联系所有者。');
        }
        if (!existingQq) {
          try { await repo.putNew(qqIndexKey, { id: claimedUser.id }); }
          catch (error) {
            if (!isConflict(error)) throw error;
            const winner = await repo.get(qqIndexKey);
            if (!winner || winner.id !== claimedUser.id) fail(409, 'QQ_ALREADY_REGISTERED', '此 QQ 号已注册，请登录或联系所有者。');
          }
        }
        const orgs = await loadOrganizations(repo);
        const activated = await saveUser(claimedUser, {
          qq,
          email: `${qq}@qq.com`,
          nickname,
          passwordHash: await hashPassword(password),
          status: 'active',
          identityVerified: true,
          securityVersion: secretToken(),
        });
        await repo.audit(activated.id, 'identity.registered', activated.id, { claimedPending: true });
        return response({ user: publicUser(activated, orgs) }, 201);
      }

      const indexKey = `identity/qq/${qq}.json`;
      let index = await repo.get(indexKey);
      if (index && await repo.latest(userKey(index.id))) fail(409, 'QQ_ALREADY_REGISTERED', '此 QQ 号已注册，请登录或联系所有者。');
      if (!index) {
        if (studentClaim) fail(409, 'STUDENT_ID_ALREADY_REGISTERED', '该学号已绑定账号，请核实或联系所有者。');
        const proposed = { id: randomUUID(), registration: { studentId, realName, nickname, passwordHash: await hashPassword(password), createdAt: iso(now) } };
        try { await repo.putNew(indexKey, proposed); index = proposed; }
        catch (error) { if (!isConflict(error)) throw error; index = await repo.get(indexKey); }
      }
      if (!index || !ID.test(index.id) || !index.registration || index.registration.studentId !== studentId || index.registration.realName !== realName || !await verifyPassword(password, index.registration.passwordHash)) {
        fail(409, 'REGISTRATION_PENDING', '此 QQ 号有待完成的注册，请使用原填写资料重试或联系所有者核查。');
      }
      const { id } = index, { passwordHash } = index.registration;
      if (await repo.latest(userKey(id))) fail(409, 'QQ_ALREADY_REGISTERED', '此 QQ 号已注册，请登录。');
      await claimStudent(studentId, id);
      const orgs = await loadOrganizations(repo);
      const user = await createUser({ id, qq, nickname, email: `${qq}@qq.com`, emailVerified: false, role: 'user', status: 'active',
        studentId, realName, identityVerified: false,
        memberships: [], signature: '',
        passwordHash, securityVersion: secretToken(), mustChangePassword: false, totp: null, createdAt: iso(now), updatedAt: iso(now) });
      await repo.audit(id, 'identity.registered', id);
      return response({ user: publicUser(user, orgs) }, 201);
    }
    if (method === 'POST' && route === '/auth/login') {
      const kind = bearerBootstrap(request, path) ? 'bearer' : 'cookie';
      if (kind === 'cookie') requireOrigin(request, env);
      const body = await readJson(request, 8192);
      if (body.qq !== undefined) fail(400, 'INVALID_STUDENT_ID', '请使用学号登录，QQ 仅作为联系方式。');
      const identifier = normalizeStudentId(body.studentId);
      const [, , user] = await Promise.all([
        repo.throttle('login-client', clientId(context), 60, 60),
        repo.throttle('login-account', identifier, 10, 60),
        (async () => {
          const index = await repo.get(studentKey(identifier));
          const account = index?.id && ID.test(index.id) ? await repo.latest(userKey(index.id)) : null;
          const configuredOwner = String(env.PLATFORM_OWNER_STUDENT_ID ?? '').normalize('NFKC').trim().toUpperCase();
          if (identifier !== configuredOwner) return account;
          if (account?.role === 'owner' && account.qq === String(env.PLATFORM_OWNER_QQ)) return account;
          await bootstrap();
          const owner = await repo.get(studentKey(identifier));
          return owner?.id && ID.test(owner.id) ? repo.latest(userKey(owner.id)) : null;
        })(),
      ]);
      const password = verifyPassword(body.password, user?.passwordHash || env.PLATFORM_OWNER_PASSWORD_HASH);
      const rejected = () => fail(401, 'LOGIN_FAILED', '学号或密码不正确，或账号尚未激活/已停用。');
      if (!user || user.studentId !== identifier || user.status !== 'active') { await password; rejected(); }
      // The password function runs while the session reads its device families; a factor is spent only after it passes.
      const verified = password.then((correct) => {
        if (!correct) rejected();
        if (user.totp && !body.totp) fail(401, 'MFA_REQUIRED', '请填写认证器动态验证码或恢复码。');
        return user.totp ? consumeFactor(user, body.totp) : undefined;
      });
      return sessionResponse(user, body, kind, verified, Boolean(user.totp));
    }
    if (method === 'GET' && route === '/auth/session') {
      const [auth, orgs] = await Promise.all([authenticate(request, { required: true, allowEnrollment: true }), loadOrganizations(repo)]);
      return response({ user: publicUser(auth.user, orgs), csrfToken: auth.csrfToken, ...setupStatus(auth.user, auth.session) });
    }
    if (method === 'POST' && route === '/auth/logout') {
      const auth = await authenticate(request, { required: true, csrf: true, allowEnrollment: true });
      await sessions.revokeOwned(auth.user.id, auth.sessionId);
      return signedOutResponse(auth.kind);
    }
    if (method === 'POST' && route === '/auth/profile') {
      const auth = await authenticate(request, { required: true, csrf: true, allowEnrollment: true });
      const safety = setupStatus(auth.user, auth.session);
      if (safety.passwordChangeRequired || safety.enrollmentRequired || safety.mfaRequired) fail(403, 'AUTH_SETUP_REQUIRED', '请先完成密码修改与动态安全验证，再补全身份资料。');
      const body = await readJson(request, 8192);
      if (body.revision !== auth.user.revision) fail(409, 'REVISION_CONFLICT', '资料已更新，请刷新后重试。');
      const current = auth.user;
      const studentId = body.studentId === undefined && current.studentId ? current.studentId : normalizeStudentId(body.studentId);
      const realName = body.realName === undefined && current.realName ? current.realName : normalizeRealName(body.realName);
      if ((current.studentId && studentId !== current.studentId) || (current.realName && realName !== current.realName)) fail(403, 'IDENTITY_LOCKED', '学号与真实姓名绑定后不可自行修改，请联系所有者核对。');
      const changedIdentity = studentId !== current.studentId || realName !== current.realName;
      const nickname = body.nickname === undefined ? current.nickname : text(body.nickname, '昵称', 40);
      const signature = body.signature === undefined ? (current.signature || '') : text(body.signature, '个性签名', 120, false);
      await bindStudent(current, studentId, realName);
      const orgs = await loadOrganizations(repo);
      const user = await saveUser(current, { studentId, realName, nickname, signature, ...(changedIdentity ? { identityVerified: false } : {}) });
      await repo.audit(user.id, changedIdentity ? 'identity.profile.bound' : 'identity.profile.updated', user.id, { profileComplete: profileComplete(user), identityVerified: user.identityVerified === true });
      return response({ user: publicUser(user, orgs) });
    }
    if (method === 'POST' && route === '/auth/password/forgot') {
      if (!bearerBootstrap(request, path)) requireOrigin(request, env);
      const body = await readJson(request, 8192);
      await repo.throttle('password-forgot-client', clientId(context), 10, 600);
      const studentId = normalizeStudentId(body.studentId);
      const index = await repo.get(studentKey(studentId));
      const user = index?.id && ID.test(index.id) ? await repo.latest(userKey(index.id)) : null;
      // The answer is the same whether or not the student ID has an account, so it cannot be used to find accounts.
      if (user?.status === 'active' && user.studentId === studentId) {
        await repo.throttle('password-forgot-account', user.id, 1, 300);
        const url = await mailLink(user, 'reset', '/login/', 30);
        await mailer.deliver({ to: user.email, subject: 'StuDev 重设密码',
          ...letter({ greeting: `${user.nickname}，你好：`, lines: ['有人（希望是你）申请重设 StuDev 账号的密码。点下面的按钮设置新密码，链接 30 分钟内有效，只能用一次。', '设置新密码后，所有设备都会退出登录。'], action: { label: '设置新密码', url }, footer: '如果不是你申请的，忽略这封信即可，密码不会改变。' }) });
        await repo.audit(user.id, 'identity.password.reset_mailed', user.id);
      }
      return response({ ok: true, email: mailer.enabled });
    }
    if (method === 'POST' && route === '/auth/password/reset') {
      if (!bearerBootstrap(request, path)) requireOrigin(request, env);
      const body = await readJson(request, 8192);
      await repo.throttle('password-reset-client', clientId(context), 10, 600);
      const password = validatePassword(body.password);
      const user = await spendToken('reset', body.token);
      await saveUser(user, { passwordHash: await hashPassword(password), mustChangePassword: false, emailVerified: true, securityVersion: secretToken() });
      await repo.audit(user.id, 'identity.password.reset_by_email', user.id);
      await tellPasswordChanged(user);
      return response({ ok: true, studentId: user.studentId });
    }
    if (method === 'POST' && route === '/auth/account/delete') {
      const auth = await authenticate(request, { required: true, csrf: true });
      const body = await readJson(request, 8192);
      await repo.throttle('account-delete', auth.user.id, 3, 600);
      if (auth.user.role === 'owner') fail(403, 'CANNOT_DELETE_OWNER', '不能删除所有者账号。');
      if (!await verifyPassword(body.password, auth.user.passwordHash)) fail(401, 'PASSWORD_INVALID', '当前密码不正确。');
      const url = await mailLink(auth.user, 'delete', '/login/', 30);
      await mailer.deliver({ to: auth.user.email, subject: 'StuDev 确认注销账号',
        ...letter({ greeting: `${auth.user.nickname}，你好：`, lines: ['你申请注销 StuDev 账号。点下面的按钮确认后，账号、学号绑定和登录设备会立即删除，无法恢复。', '链接 30 分钟内有效。'], action: { label: '确认注销', url }, footer: '如果不是你申请的，请忽略这封信，并尽快修改密码。' }) });
      await repo.audit(auth.user.id, 'identity.delete.mailed', auth.user.id);
      return response({ ok: true });
    }
    if (method === 'POST' && route === '/auth/account/delete/confirm') {
      if (!bearerBootstrap(request, path)) requireOrigin(request, env);
      const body = await readJson(request, 8192);
      await repo.throttle('account-delete-client', clientId(context), 10, 600);
      const user = await spendToken('delete', body.token);
      await deleteUser(user);
      await repo.audit(user.id, 'identity.user.deleted_by_self', user.id);
      return signedOutResponse(bearerBootstrap(request, path) ? 'bearer' : 'cookie');
    }
    if (method === 'POST' && route === '/auth/password') {
      const auth = await authenticate(request, { required: true, csrf: true, allowEnrollment: true });
      const body = await readJson(request, 8192);
      await repo.throttle('password-change', auth.user.id, 5, 60);
      if (!await verifyPassword(body.currentPassword, auth.user.passwordHash)) fail(401, 'PASSWORD_INVALID', '当前密码不正确。');
      const newPassword = validatePassword(body.newPassword);
      if (auth.user.totp) requireFactorCode(body.totp);
      if (safeEqual(body.currentPassword, newPassword)) fail(400, 'PASSWORD_UNCHANGED', '新密码应与当前密码不同。');
      if (auth.user.totp) await consumeFactor(auth.user, body.totp);
      const passwordHash = await hashPassword(newPassword);
      await saveUser(auth.user, { passwordHash, mustChangePassword: false, securityVersion: secretToken() });
      await repo.audit(auth.user.id, 'identity.password.changed', auth.user.id);
      await tellPasswordChanged(auth.user);
      return signedOutResponse(auth.kind);
    }
    if (method === 'POST' && route === '/auth/totp/setup') {
      const auth = await authenticate(request, { required: true, csrf: true, allowEnrollment: true });
      const body = await readJson(request, 8192);
      await repo.throttle('totp-setup', auth.user.id, 5, 60);
      if (auth.user.totp) fail(409, 'TOTP_ALREADY_ENABLED', '认证器已绑定。');
      if (!await verifyPassword(body.password, auth.user.passwordHash)) fail(401, 'PASSWORD_INVALID', '当前密码不正确。');
      const secret = newTotpSecret();
      const pendingTotp = { encrypted: await encryptTotp(secret, env.PLATFORM_ENCRYPTION_KEY, auth.user.id), epoch: randomHex(16), expiresAt: now() + 10 * 60_000 };
      await repo.append(authSessionKey(auth), { ...auth.session, pendingTotp }, auth.session.revision || 0);
      const label = encodeURIComponent(`StuDev:${auth.user.qq}`);
      return response({ secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=StuDev&algorithm=SHA1&digits=6&period=30` });
    }
    if (method === 'POST' && route === '/auth/totp/confirm') {
      const auth = await authenticate(request, { required: true, csrf: true, allowEnrollment: true });
      const body = await readJson(request, 8192);
      await repo.throttle('totp-confirm', auth.user.id, 8, 60);
      const pending = auth.session.pendingTotp;
      if (auth.user.totp || !pending || pending.expiresAt <= now()) fail(400, 'TOTP_SETUP_EXPIRED', '请重新开始认证器绑定。');
      const secret = await decryptTotp(pending.encrypted, env.PLATFORM_ENCRYPTION_KEY, auth.user.id);
      const counter = matchedTotpCounter(secret, body.code, now());
      if (counter === null) fail(401, 'MFA_INVALID', '动态验证码无效。');
      const recoveryCodes = Array.from({ length: 10 }, () => randomHex(10).toUpperCase().match(/.{1,5}/g).join('-'));
      const totp = { encrypted: pending.encrypted, epoch: pending.epoch, recoveryHashes: recoveryCodes.map((code) => digest(`${auth.user.id}:${code}`)), enrolledAt: iso(now) };
      // Both atomic writes are deliberately before session elevation. Losing requests cannot gain access.
      await repo.putNew(`identity/totp-used/${auth.user.id}/${totp.epoch}/${counter}.json`, { usedAt: iso(now) });
      const user = await saveUser(auth.user, { totp, securityVersion: secretToken() });
      await repo.append(authSessionKey(auth), { ...auth.session, securityVersion: user.securityVersion, mfaVerified: true, pendingTotp: null }, auth.session.revision || 0);
      await repo.audit(user.id, 'identity.totp.enabled', user.id);
      return response({ recoveryCodes });
    }
    if (method === 'POST' && route === '/auth/totp/disable') {
      const auth = await authenticate(request, { required: true, csrf: true });
      const body = await readJson(request, 8192);
      if (auth.user.role === 'owner') fail(403, 'STAFF_TOTP_REQUIRED', '所有者账号必须保留认证器验证。');
      await repo.throttle('totp-disable', auth.user.id, 5, 60);
      if (!await verifyPassword(body.password, auth.user.passwordHash)) fail(401, 'PASSWORD_INVALID', '当前密码不正确。');
      await consumeFactor(auth.user, body.code);
      await saveUser(auth.user, { totp: null, securityVersion: secretToken() });
      await repo.audit(auth.user.id, 'identity.totp.disabled', auth.user.id);
      return signedOutResponse(auth.kind);
    }
    if (method === 'GET' && route === '/admin/users') {
      await authenticate(request, { staff: true });
      const url = new URL(request.url);
      const refresh = url.searchParams.get('refresh') === '1';
      const [users, orgs] = await Promise.all([loadAllUsers({ refresh }), loadOrganizations(repo)]);
      return response({ items: users.map(user => publicUser(user, orgs, true)) });
    }
    if (method === 'POST' && route === '/admin/users/batch') {
      const auth = await authenticate(request, { owner: true, csrf: true });
      const body = await readJson(request, 262144);
      const orgs = await loadOrganizations(repo);
      const orgId = typeof body.organizationId === 'string' ? body.organizationId.trim() : '';
      const targetOrg = orgId ? organization(orgId, orgs) : null;
      if (!targetOrg) fail(400, 'INVALID_ORGANIZATION', '请选择要导入的组织。');
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (title !== '' && targetOrg.titles.length > 0 && !targetOrg.titles.includes(title)) {
        fail(400, 'INVALID_POSITION', '请选择该组织的职务。');
      }
      const [appointment] = validateMemberships([{
        organizationId: targetOrg.id, title, startsOn: body.startsOn, endsBefore: body.endsBefore,
      }], orgs, appointmentYear());
      const parsed = [];
      if (Array.isArray(body.members)) {
        for (const row of body.members) {
          const sid = normalizeStudentId(row?.studentId);
          const rn = normalizeRealName(row?.realName || row?.name);
          const qq = row?.qq ? qqValue(String(row.qq)) : '';
          parsed.push({ studentId: sid, realName: rn, qq });
        }
      } else if (typeof body.lines === 'string') {
        const rawLines = body.lines.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        for (const line of rawLines) {
          const parts = line.split(/[\s,\t]+/).filter(Boolean);
          if (parts.length < 2) fail(400, 'INVALID_FIELD', `格式有误（每行请填“学号 姓名”）：${line}`);
          parsed.push({
            studentId: normalizeStudentId(parts[0]),
            realName: normalizeRealName(parts.slice(1).join(' ')),
            qq: '',
          });
        }
      }
      if (!parsed.length || parsed.length > 500) fail(400, 'INVALID_MEMBERS', '单次可导入 1–500 位成员。');
      const dedup = new Map();
      for (const row of parsed) dedup.set(row.studentId, row);

      let created = 0; let updated = 0; let skipped = 0;
      const touched = [];
      for (const row of dedup.values()) {
        const existingClaim = await repo.get(studentKey(row.studentId));
        const existingUser = existingClaim?.id && ID.test(existingClaim.id) ? await repo.latest(userKey(existingClaim.id)) : null;
        if (existingUser) {
          const currentMemberships = Array.isArray(existingUser.memberships) ? existingUser.memberships : [];
          if (currentMemberships.some(m => overlapsMembership(m, appointment))) {
            skipped++;
            continue;
          }
          const nextMemberships = validateMemberships([...currentMemberships, appointment], orgs, appointmentYear());
          touched.push(await saveUser(existingUser, { memberships: nextMemberships }, { syncIndex: false, orgs }));
          updated++;
          continue;
        }
        if (row.qq && await repo.get(`identity/qq/${row.qq}.json`)) {
          fail(409, 'QQ_ALREADY_REGISTERED', `QQ ${row.qq} 已存在记录。`);
        }
        const id = randomUUID();
        if (row.qq) await repo.putNew(`identity/qq/${row.qq}.json`, { id });
        await claimStudent(row.studentId, id);
        touched.push(await createUser({
          id, qq: row.qq, nickname: '', email: row.qq ? `${row.qq}@qq.com` : '', emailVerified: false,
          studentId: row.studentId, realName: row.realName, identityVerified: true,
          memberships: [appointment],
          signature: '', role: 'user', status: 'pending', passwordHash: '', mustChangePassword: false,
          securityVersion: secretToken(), totp: null, createdAt: iso(now), updatedAt: iso(now),
        }, { syncIndex: false, orgs }));
        created++;
      }
      if (touched.length) await syncDirectoryIndex(touched);
      await repo.audit(auth.user.id, 'identity.users.batch_imported', targetOrg.id, { created, updated, skipped, total: dedup.size });
      return response({ created, updated, skipped, total: dedup.size }, 201);
    }
    if (method === 'POST' && route === '/admin/users') {
      const auth = await authenticate(request, { owner: true, csrf: true });
      const body = await readJson(request, 8192);
      const studentId = normalizeStudentId(body.studentId);
      const realName = normalizeRealName(body.realName);
      const role = body.role === undefined ? 'admin' : body.role;
      if (!['admin', 'user'].includes(role)) fail(400, 'INVALID_ROLE', '预录成员角色须为成员或管理员。');
      const qq = role === 'user' && (body.qq === undefined || body.qq === '') ? '' : qqValue(body.qq);
      const orgs = await loadOrganizations(repo);
      const memberships = validateMemberships(body.memberships ?? [], orgs, appointmentYear());
      const signature = body.signature === undefined ? '' : text(body.signature, '个性签名', 120, false);
      if (await repo.get(studentKey(studentId))) fail(409, 'STUDENT_ID_ALREADY_REGISTERED', '该学号已存在记录。');
      if (qq && await repo.get(`identity/qq/${qq}.json`)) fail(409, 'QQ_ALREADY_REGISTERED', '该 QQ 号已存在记录。');
      if (role === 'admin') await authorizeCredentialChange(auth.user, body.totp);
      const id = randomUUID();
      if (qq) await repo.putNew(`identity/qq/${qq}.json`, { id });
      await claimStudent(studentId, id);
      const user = await createUser({
        id, qq, nickname: '', email: qq ? `${qq}@qq.com` : '', emailVerified: false,
        studentId, realName, identityVerified: true,
        memberships, signature,
        role, status: 'pending', passwordHash: '', mustChangePassword: false,
        securityVersion: secretToken(), totp: null, createdAt: iso(now), updatedAt: iso(now),
      });
      await repo.audit(auth.user.id, 'identity.user.seeded', id);
      return response({ user: publicUser(user, orgs, true) }, 201);
    }
    if (method === 'GET' && route === '/admin/audit') {
      await authenticate(request, { owner: true });
      const keys = (await repo.list('audit/')).slice(0, 500);
      return response({ items: (await Promise.all(keys.map((key) => repo.get(key)))).filter(Boolean) });
    }
    const management = route.match(/^\/admin\/users\/([a-f0-9-]{36})(\/reset-password|\/reset-totp|\/delete)?$/);
    if (['POST', 'DELETE'].includes(method) && management) {
      const auth = await authenticate(request, { staff: true, csrf: true });
      const user = await loadUser(management[1]);
      if (auth.user.role !== 'owner' && user.role !== 'user') fail(403, 'OWNER_REQUIRED', '管理员账号由所有者管理。');
      if (management[2] === '/delete' || method === 'DELETE') {
        await deleteUser(user);
        await repo.audit(auth.user.id, 'identity.user.deleted', user.id, { studentId: user.studentId, qq: user.qq });
        return response({ ok: true });
      }
      const body = await readJson(request, 8192);
      if (management[2] === '/reset-password') {
        const password = validatePassword(body.password);
        await authorizeCredentialChange(auth.user, body.totp);
        const passwordHash = await hashPassword(password);
        await saveUser(user, { passwordHash, mustChangePassword: true, securityVersion: secretToken() });
        await repo.audit(auth.user.id, 'identity.password.reset', user.id);
        return response({ ok: true });
      }
      if (management[2] === '/reset-totp') {
        await authorizeCredentialChange(auth.user, body.totp);
        await saveUser(user, { totp: null, securityVersion: secretToken() });
        await repo.audit(auth.user.id, 'identity.totp.reset', user.id);
        return response({ ok: true });
      }
      if (body.revision !== user.revision) fail(409, 'REVISION_CONFLICT', '账号已更新，请刷新后重试。');
      const role = body.role === undefined ? user.role : body.role;
      const status = body.status === undefined ? user.status : body.status;
      if (!['owner', 'admin', 'user'].includes(role) || !['active', 'disabled', 'pending'].includes(status)) fail(400, 'INVALID_ROLE', '账号角色或状态无效。');
      if (user.role === 'owner' && (role !== 'owner' || status !== 'active')) fail(403, 'LAST_OWNER_PROTECTED', '不能停用或降级平台所有者。');
      if (role === 'owner' && user.role !== 'owner') fail(403, 'OWNER_PROVISIONING_REQUIRED', '所有者由受控初始化配置管理。');
      const studentId = body.studentId === undefined ? (user.studentId || '') : normalizeStudentId(body.studentId);
      if (auth.user.role !== 'owner' && role !== user.role) fail(403, 'OWNER_REQUIRED', '角色由所有者管理。');
      const realName = body.realName === undefined ? (user.realName || '') : normalizeRealName(body.realName);
      const rawNick = body.nickname === undefined ? undefined : String(body.nickname).trim();
      const nickname = rawNick === undefined ? user.nickname : text(rawNick, '昵称', 40);
      const nameChanged = realName !== (user.realName || '');
      const identityChanged = studentId !== (user.studentId || '') || nameChanged;
      if (studentId && !user.studentId && !realName) fail(400, 'INVALID_REAL_NAME', '首次绑定学号时请同时填写真实姓名。');
      if (body.identityVerified !== undefined && typeof body.identityVerified !== 'boolean') fail(400, 'INVALID_FIELD', '身份核验状态无效。');
      let identityVerified = body.identityVerified !== undefined ? body.identityVerified : (identityChanged ? false : (user.identityVerified === true));
      if (identityVerified && !profileComplete({ ...user, studentId, realName })) fail(409, 'PROFILE_REQUIRED', '账号需先补齐学号与真实姓名，再核验身份。');
      if (body.memberships !== undefined && auth.user.role !== 'owner') fail(403, 'OWNER_REQUIRED', '组织归属由所有者统一维护。');
      const orgs = await loadOrganizations(repo);
      const memberships = body.memberships === undefined ? user.memberships : validateMemberships(body.memberships, orgs, appointmentYear());
      const signature = body.signature === undefined ? (user.signature || '') : text(body.signature, '个性签名', 120, false);
      const changedSecurity = role !== user.role || status !== user.status || studentId !== user.studentId;
      if (role !== user.role) await authorizeCredentialChange(auth.user, body.totp);
      if (studentId && studentId !== user.studentId) {
        await bindStudent(user, studentId, realName);
      }
      const updated = await saveUser(user, { role, status, nickname, studentId, realName, identityVerified, memberships, signature, ...(changedSecurity ? { securityVersion: secretToken() } : {}) }, { orgs });
      if (user.studentId && studentId !== user.studentId) {
        const previous = await repo.get(studentKey(user.studentId));
        if (previous?.id === user.id) await repo.remove(studentKey(user.studentId));
      }
      await repo.audit(auth.user.id, 'identity.user.updated', user.id, { role, status, previousRole: user.role, previousStatus: user.status });
      if (identityChanged || identityVerified !== (user.identityVerified === true)) await repo.audit(auth.user.id, identityChanged ? 'identity.profile.corrected' : 'identity.verification.updated', user.id, { identityVerified, profileComplete: profileComplete(updated) });
      return response({ user: publicUser(updated, orgs, true) });
    }
    fail(404, 'NOT_FOUND', '接口不存在。');
  }
  return { handle, authenticate, publicUser, loadAllUsers, loadOrganizations: () => loadOrganizations(repo) };
}
