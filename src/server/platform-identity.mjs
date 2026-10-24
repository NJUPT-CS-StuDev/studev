import { randomBytes, randomUUID } from 'node:crypto';
import { digest, hashPassword, mac, safeEqual, validPasswordHash, verifyPassword } from './collection-auth.mjs';
import { fail, platformOrigin, readJson, requireOrigin, response, text } from './platform-common.mjs';
import { isConflict } from './platform-store.mjs';
import { decryptTotp, encryptTotp, matchedTotpCounter, newTotpSecret } from './platform-totp.mjs';
import { ROSTER_SCHEMA, ROSTER_SEED_2026_2027, SUPPORTED_ROSTER_TERMS, buildRosterSnapshot, normalizeDepartmentName, normalizeRoleTitle, qqAvatarUrl } from './platform-roster.mjs';

const API = '/api/platform';
const MAX_SESSION_SECONDS = 7200;
const ID = /^[a-f0-9-]{36}$/;
const QQ = /^[1-9]\d{4,11}$/;
const userKey = (id) => `identity/users/${id}`;
const sessionKey = (id) => `identity/sessions/${id}`;
const staffRole = (role) => role === 'admin' || role === 'owner';
const iso = (now) => new Date(now()).toISOString();
const secretToken = () => randomBytes(32).toString('base64url');

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
  // Only trust the platform-supplied connection address, never caller-controlled headers.
  return typeof context.clientIp === 'string' && context.clientIp.length <= 100 ? context.clientIp : 'unknown';
}
function cookieValue(request, name) {
  const cookies = String(request.headers.get('cookie') || '').split(';').map((v) => v.trim());
  const matches = cookies.filter((v) => v.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

export function createIdentity({ repo, env, now = Date.now }) {
  const origin = platformOrigin(env);
  const local = origin.startsWith('http://');
  const cookieName = local ? 'studev_platform_dev' : '__Host-studev_platform';
  const sessionSecret = env.PLATFORM_SESSION_SECRET;
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32 || !validPasswordHash(env.PLATFORM_OWNER_PASSWORD_HASH) || !QQ.test(String(env.PLATFORM_OWNER_QQ || '')) || !/^[A-Za-z0-9+/]{43}=$/.test(String(env.PLATFORM_ENCRYPTION_KEY || ''))) {
    fail(503, 'NOT_CONFIGURED', '平台身份配置尚未完成。');
  }
  let bootstrapPromise;
  function publicUser(user) {
    return {
      id: user.id,
      qq: user.qq,
      avatarUrl: user.avatarUrl || qqAvatarUrl(user.qq),
      nickname: user.nickname,
      email: user.email,
      emailVerified: user.emailVerified === true,
      studentId: user.studentId || '',
      realName: user.realName || '',
      identityVerified: user.identityVerified === true,
      profileComplete: profileComplete(user),
      term: user.term || '',
      department: normalizeDepartmentName(user.department || ''),
      title: normalizeRoleTitle(user.title || '', user.studentId || ''),
      order: Number.isSafeInteger(user.order) ? user.order : 999,
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
        studentId: '', realName: '', identityVerified: false,
        term: '', department: '', title: '', order: 999, signature: '',
        role: 'owner', status: 'active', passwordHash: env.PLATFORM_OWNER_PASSWORD_HASH, mustChangePassword: true,
        securityVersion: secretToken(), totp: null, createdAt: iso(now), updatedAt: iso(now) };
      try { await repo.append(userKey(index.id), user, 0); await repo.audit('system', 'identity.owner.initialized', index.id); }
      catch (error) { if (!isConflict(error)) throw error; const winner = await repo.latest(userKey(index.id)); if (winner?.role !== 'owner') throw error; }
    })();
    return bootstrapPromise;
  }
  function sessionCookie(token, seconds = MAX_SESSION_SECONDS) {
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${local ? '' : '; Secure'}`;
  }
  function seal(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${data}.${mac(sessionSecret, data)}`;
  }
  function open(token) {
    if (typeof token !== 'string' || token.length > 1024) return null;
    const [data, sig, extra] = token.split('.');
    if (!data || !sig || extra || !safeEqual(mac(sessionSecret, data), sig)) return null;
    try {
      const value = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
      const seconds = Math.floor(now() / 1000);
      return value.v === 1 && /^[a-f0-9]{48}$/.test(value.sid) && Number.isSafeInteger(value.exp) && value.exp > seconds && value.exp <= seconds + MAX_SESSION_SECONDS ? value : null;
    } catch { return null; }
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
  async function authenticate(request, { required = false, staff = false, owner = false, csrf = false, allowEnrollment = false } = {}) {
    await bootstrap();
    const payload = open(cookieValue(request, cookieName));
    let session, user;
    if (payload) {
      session = await repo.latest(sessionKey(payload.sid));
      if (session && !session.revoked && session.expiresAt > now() && ID.test(session.userId)) {
        user = await repo.latest(userKey(session.userId));
        if (!user || user.status !== 'active' || user.securityVersion !== session.securityVersion) user = null;
      }
    }
    if (!user) {
      if (required || staff || owner || csrf) fail(401, 'AUTH_REQUIRED', '请先登录。');
      return null;
    }
    if (owner && user.role !== 'owner') fail(403, 'OWNER_REQUIRED', '此操作仅限所有者。');
    if (staff && !staffRole(user.role)) fail(403, 'STAFF_REQUIRED', '此操作仅限管理员。');
    const state = setupStatus(user, session);
    if (!allowEnrollment && (state.passwordChangeRequired || state.enrollmentRequired || state.mfaRequired || state.profileRequired)) fail(403, 'AUTH_SETUP_REQUIRED', '请先完成身份资料、密码修改与安全验证。');
    if ((owner || user.role === 'owner' || user.totp) && !allowEnrollment && !session.mfaVerified) fail(403, 'MFA_REQUIRED', '请完成动态验证码验证。');
    if (csrf) {
      requireOrigin(request, env);
      if (!safeEqual(request.headers.get('x-csrf-token') || '', session.csrfToken)) fail(403, 'CSRF_REJECTED', '页面已失效，请刷新后重试。');
    }
    return { user, csrfToken: session.csrfToken, sessionId: session.id, mfaVerified: Boolean(session.mfaVerified), session };
  }
  async function startSession(user, mfaVerified) {
    const id = randomBytes(24).toString('hex');
    const session = await repo.append(sessionKey(id), { id, userId: user.id, securityVersion: user.securityVersion, csrfToken: secretToken(), mfaVerified,
      expiresAt: now() + MAX_SESSION_SECONDS * 1000, revoked: false, createdAt: iso(now) }, 0);
    return { session, cookie: sessionCookie(seal({ v: 1, sid: id, exp: Math.floor(session.expiresAt / 1000) })) };
  }
  async function sessionResponse(user, mfaVerified) {
    const { session, cookie } = await startSession(user, mfaVerified);
    return response({ user: publicUser(user), csrfToken: session.csrfToken, ...setupStatus(user, session) }, 200, { 'Set-Cookie': cookie });
  }
  async function saveUser(current, changes) {
    return repo.append(userKey(current.id), { ...current, ...changes, updatedAt: iso(now) }, current.revision);
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
    if (!current.studentId) {
      // Fix a single binding target before writing the global student-ID index. Two
      // first-time profile requests must not reserve two IDs for one account.
      const key = `identity/binding/${current.id}.json`;
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
  async function consumeFactor(user, code) {
    if (!user.totp) fail(400, 'TOTP_NOT_ENABLED', '尚未绑定认证器。');
    if (typeof code !== 'string' || code.length > 64) fail(401, 'MFA_INVALID', '动态验证码或恢复码无效。');
    const normalized = code.trim().toUpperCase();
    const recoveryHash = digest(`${user.id}:${normalized}`);
    let key;
    if (user.totp.recoveryHashes?.includes(recoveryHash)) {
      key = `identity/recovery-used/${user.id}/${user.totp.epoch}/${recoveryHash}.json`;
    } else {
      const secret = decryptTotp(user.totp.encrypted, env.PLATFORM_ENCRYPTION_KEY, user.id);
      const counter = matchedTotpCounter(secret, normalized, now());
      if (counter === null) fail(401, 'MFA_INVALID', '动态验证码或恢复码无效。');
      key = `identity/totp-used/${user.id}/${user.totp.epoch}/${counter}.json`;
    }
    try { await repo.putNew(key, { usedAt: iso(now) }); }
    catch (error) { if (isConflict(error)) fail(401, 'MFA_REPLAYED', '此验证码已使用，请使用下一个验证码或未使用的恢复码。'); throw error; }
  }
  async function loadUser(id) {
    if (!ID.test(id)) fail(404, 'USER_NOT_FOUND', '账号不存在。');
    const user = await repo.latest(userKey(id));
    if (!user) fail(404, 'USER_NOT_FOUND', '账号不存在。');
    return user;
  }
  async function loadAllUsers() {
    const keys = await repo.list('identity/qq/');
    const indices = await Promise.all(keys.slice(0, 1000).map((key) => repo.get(key)));
    const seen = new Set();
    const uniqueIds = [];
    for (const index of indices) {
      if (ID.test(index?.id || '') && !seen.has(index.id)) {
        seen.add(index.id);
        uniqueIds.push(index.id);
      }
    }
    const users = await Promise.all(uniqueIds.map((id) => repo.latest(userKey(id))));
    return users.filter(Boolean);
  }
  async function rebuildRoster(term = '2026-2027') {
    if (!term || !/^[0-9]{4}-[0-9]{4}$/.test(term)) return null;
    const users = await loadAllUsers();
    const snapshot = buildRosterSnapshot(users, term, iso(now));
    await repo.put(`roster/${term}.json`, snapshot);
    return snapshot;
  }
  async function seedAndSyncRoster(term = '2026-2027') {
    if (term === '2026-2027') {
      for (const seed of ROSTER_SEED_2026_2027) {
        const studentRef = await repo.get(studentKey(seed.studentId));
        const qqRef = await repo.get(`identity/qq/${seed.qq}.json`);
        const targetId = studentRef?.id || qqRef?.id;
        const existing = targetId && ID.test(targetId) ? await repo.latest(userKey(targetId)) : null;
        if (existing) {
          const nextStudentId = existing.studentId || seed.studentId;
          const nextRealName = existing.realName || seed.realName;
          const nextTerm = existing.term || seed.term;
          const nextDept = normalizeDepartmentName(existing.department || seed.department);
          const nextTitle = normalizeRoleTitle(existing.title !== undefined && existing.title !== '' ? existing.title : seed.title, nextStudentId);
          const nextOrder = Number.isSafeInteger(existing.order) && existing.order !== 999 ? existing.order : seed.order;
          const nextSig = existing.signature !== undefined && existing.signature !== '' ? existing.signature : seed.signature;
          const nextVerified = true;
          if (!existing.studentId && nextStudentId) await claimStudent(nextStudentId, existing.id);
          if (existing.studentId !== nextStudentId || existing.realName !== nextRealName || existing.term !== nextTerm || existing.department !== nextDept || (existing.title || '') !== nextTitle || existing.order !== nextOrder || (existing.signature || '') !== nextSig || existing.identityVerified !== nextVerified) {
            await saveUser(existing, {
              studentId: nextStudentId,
              realName: nextRealName,
              term: nextTerm,
              department: nextDept,
              title: nextTitle,
              order: nextOrder,
              signature: nextSig,
              identityVerified: nextVerified,
            });
          }
        } else {
          const id = targetId && ID.test(targetId) ? targetId : randomUUID();
          if (!qqRef) {
            try { await repo.putNew(`identity/qq/${seed.qq}.json`, { id }); }
            catch (error) { if (!isConflict(error)) throw error; }
          }
          await claimStudent(seed.studentId, id);
          const pendingUser = {
            id,
            qq: seed.qq,
            nickname: seed.realName,
            email: `${seed.qq}@qq.com`,
            emailVerified: false,
            studentId: seed.studentId,
            realName: seed.realName,
            identityVerified: true,
            term: seed.term,
            department: seed.department,
            title: seed.title,
            order: seed.order,
            signature: seed.signature,
            role: 'member',
            status: 'pending',
            passwordHash: '',
            mustChangePassword: false,
            securityVersion: secretToken(),
            totp: null,
            createdAt: iso(now),
            updatedAt: iso(now),
          };
          try { await repo.append(userKey(id), pendingUser, 0); }
          catch (error) { if (!isConflict(error)) throw error; }
        }
      }
    }
    return rebuildRoster(term);
  }
  async function bodyFor(request) { requireOrigin(request, env); return readJson(request, 8192); }

  async function handle(context, rawPath) {
    const path = rawPath.split('?')[0].replace(/\/+$/, '');
    if (!path.startsWith(`${API}/auth/`) && !path.startsWith(`${API}/admin/users`) && !path.startsWith(`${API}/admin/roster`) && !path.startsWith(`${API}/public/roster`) && !path.startsWith(`${API}/members`) && path !== `${API}/admin/audit`) return null;
    await bootstrap();
    const request = context.request;
    const route = path.slice(API.length);
    const method = request.method;
    if (method === 'GET' && route === '/auth/config') return response({ registrationEnabled: validPasswordHash(env.PLATFORM_REGISTRATION_HASH), emailDeliveryEnabled: false });
    if (method === 'GET' && route === '/public/roster') {
      const url = new URL(request.url);
      const term = (url.searchParams.get('term') || '2026-2027').trim();
      if (!/^[0-9]{4}-[0-9]{4}$/.test(term)) fail(400, 'INVALID_TERM', '届别格式无效。');
      if (!SUPPORTED_ROSTER_TERMS.has(term)) fail(404, 'ROSTER_NOT_FOUND', '该届别档案名册不存在。');
      let snapshot = await repo.get(`roster/${term}.json`);
      if (!snapshot || snapshot.schema !== ROSTER_SCHEMA) snapshot = await seedAndSyncRoster(term);
      return response(snapshot, 200, { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=60' });
    }
    if (method === 'GET' && route === '/members') {
      const auth = await authenticate(request, { required: true });
      const currentRoster = await repo.get('roster/2026-2027.json');
      if (!currentRoster || currentRoster.schema !== ROSTER_SCHEMA) {
        await seedAndSyncRoster('2026-2027');
      }
      const users = await loadAllUsers();
      const visible = auth.user.role === 'owner' ? users : users.filter((u) => u.status !== 'disabled');
      return response({ items: visible.map(publicUser) });
    }
    const memberProfile = route.match(/^\/members\/([a-f0-9-]{36})\/profile$/);
    if (method === 'POST' && memberProfile) {
      const auth = await authenticate(request, { staff: true, csrf: true });
      const user = await loadUser(memberProfile[1]);
      const body = await readJson(request, 8192);
      if (body.revision !== user.revision) fail(409, 'REVISION_CONFLICT', '档案已更新，请刷新后重试。');
      const rawNick = body.nickname === undefined ? undefined : String(body.nickname).trim();
      const nickname = rawNick === undefined ? user.nickname : rawNick === '' ? (user.realName || user.qq) : text(rawNick, '昵称', 40, true);
      const term = body.term === undefined ? (user.term || '') : text(body.term, '届别', 32, false);
      const department = body.department === undefined ? (user.department || '') : normalizeDepartmentName(text(body.department, '所属部门', 60, false));
      const title = body.title === undefined ? (user.title || '') : normalizeRoleTitle(text(body.title, '职务头衔', 80, false));
      const signature = body.signature === undefined ? (user.signature || '') : text(body.signature, '个性签名', 120, false);
      const order = body.order === undefined ? (user.order ?? 999) : (Number.isSafeInteger(body.order) && body.order >= 0 && body.order <= 9999 ? body.order : fail(400, 'INVALID_FIELD', '排序序号须为 0–9999 的整数。'));
      const updated = await saveUser(user, { nickname, term, department, title, signature, order });
      if (user.term || updated.term) await rebuildRoster(updated.term || user.term);
      await repo.audit(auth.user.id, 'identity.user.updated', user.id, { department, term });
      return response({ user: publicUser(updated) });
    }
    if (method === 'POST' && route === '/admin/roster/sync') {
      const auth = await authenticate(request, { owner: true, csrf: true });
      const body = await readJson(request, 8192);
      const term = typeof body.term === 'string' && /^[0-9]{4}-[0-9]{4}$/.test(body.term) ? body.term : '2026-2027';
      if (!SUPPORTED_ROSTER_TERMS.has(term)) fail(400, 'INVALID_TERM', '不支持该届别名册同步。');
      const snapshot = await seedAndSyncRoster(term);
      await repo.audit(auth.user.id, 'identity.roster.synced', term, { totalCount: snapshot.totalCount, activeCount: snapshot.activeCount });
      return response({ snapshot });
    }
    if (method === 'POST' && route === '/auth/register') {
      const body = await bodyFor(request);
      await repo.throttle('register-client', clientId(context), 60, 600);
      const qq = qqValue(body.qq), password = validatePassword(body.password);
      const studentId = normalizeStudentId(body.studentId), realName = normalizeRealName(body.realName);
      const nickname = body.nickname === undefined || body.nickname === '' ? realName : text(body.nickname, '昵称', 40, true);
      await repo.throttle('register-account', qq, 3, 600);
      if (!validPasswordHash(env.PLATFORM_REGISTRATION_HASH)) fail(403, 'REGISTRATION_CLOSED', '注册暂未开放。');
      const rawInvite = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
      let inviteValid = await verifyPassword(rawInvite, env.PLATFORM_REGISTRATION_HASH);
      if (!inviteValid && rawInvite.toUpperCase() !== rawInvite) {
        inviteValid = await verifyPassword(rawInvite.toUpperCase(), env.PLATFORM_REGISTRATION_HASH);
      }
      if (!inviteValid) fail(403, 'INVITE_INVALID', '注册邀请码不正确。');

      // Check if this studentId belongs to a pre-seeded pending roster member
      const studentClaim = await repo.get(studentKey(studentId));
      const claimedUser = studentClaim?.id && ID.test(studentClaim.id) ? await repo.latest(userKey(studentClaim.id)) : null;
      if (claimedUser && claimedUser.status === 'pending') {
        const indexKey = `identity/qq/${qq}.json`;
        const qqIndex = await repo.get(indexKey);
        if (qqIndex && qqIndex.id !== claimedUser.id && await repo.latest(userKey(qqIndex.id))) {
          fail(409, 'QQ_ALREADY_REGISTERED', '此 QQ 号已注册，请登录或联系所有者。');
        }
        if (claimedUser.qq && claimedUser.qq !== qq) {
          const oldQqIndex = await repo.get(`identity/qq/${claimedUser.qq}.json`);
          if (oldQqIndex?.id === claimedUser.id) await repo.remove(`identity/qq/${claimedUser.qq}.json`);
        }
        if (!qqIndex || qqIndex.id !== claimedUser.id) {
          await repo.put(indexKey, { id: claimedUser.id });
        }
        const activated = await saveUser(claimedUser, {
          qq,
          email: `${qq}@qq.com`,
          nickname: body.nickname === undefined || body.nickname === '' ? (claimedUser.nickname || realName) : nickname,
          realName,
          status: 'active',
          passwordHash: await hashPassword(password),
          mustChangePassword: false,
          securityVersion: secretToken(),
        });
        if (activated.term) await rebuildRoster(activated.term);
        await repo.audit(activated.id, 'identity.registered', activated.id, { activatedPending: true });
        return response({ user: publicUser(activated) }, 201);
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
      const user = await repo.append(userKey(id), { id, qq, nickname, email: `${qq}@qq.com`, emailVerified: false, role: 'member', status: 'active',
        studentId, realName, identityVerified: false,
        term: '', department: '', title: '', order: 999, signature: '',
        passwordHash, securityVersion: secretToken(), mustChangePassword: false, totp: null, createdAt: iso(now), updatedAt: iso(now) }, 0);
      await repo.audit(id, 'identity.registered', id);
      return response({ user: publicUser(user) }, 201);
    }
    if (method === 'POST' && ['/auth/login', '/auth/legacy-profile-login'].includes(route)) {
      const body = await bodyFor(request);
      await repo.throttle('login-client', clientId(context), 60, 60);
      const legacy = route === '/auth/legacy-profile-login';
      if (!legacy && body.qq !== undefined) fail(400, 'STUDENT_LOGIN_REQUIRED', '请使用学号登录，QQ 仅作为联系方式。');
      const identifier = legacy ? qqValue(body.qq) : normalizeStudentId(body.studentId);
      await repo.throttle(legacy ? 'legacy-login-account' : 'login-account', identifier, 10, 60);
      const index = await repo.get(legacy ? `identity/qq/${identifier}.json` : studentKey(identifier));
      const user = index?.id && ID.test(index.id) ? await repo.latest(userKey(index.id)) : null;
      // Use a real hash even for unknown users to avoid the cheap account-existence timing path.
      const correct = await verifyPassword(body.password, user?.passwordHash || env.PLATFORM_OWNER_PASSWORD_HASH);
      const validIdentity = legacy ? user?.qq === identifier && !profileComplete(user) && !index.registration : user?.studentId === identifier;
      if (!correct || !user || !validIdentity || user.status !== 'active') fail(401, 'LOGIN_FAILED', legacy ? '旧账号迁移登录不可用，请联系所有者。' : '学号或密码不正确，或账号尚未激活/已停用。');
      let mfaVerified = false;
      if (user.totp && body.totp) { await consumeFactor(user, body.totp); mfaVerified = true; }
      return sessionResponse(user, mfaVerified);
    }
    if (method === 'GET' && route === '/auth/session') {
      const auth = await authenticate(request, { required: true, allowEnrollment: true });
      return response({ user: publicUser(auth.user), csrfToken: auth.csrfToken, ...setupStatus(auth.user, auth.session) });
    }
    if (method === 'POST' && route === '/auth/logout') {
      const auth = await authenticate(request, { required: true, csrf: true, allowEnrollment: true });
      await repo.append(sessionKey(auth.sessionId), { ...auth.session, revoked: true, pendingTotp: null }, auth.session.revision);
      return response({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
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
      // Empty nickname clears it (falls back to realName, which display layers treat as "no nickname").
      const nickname = body.nickname === undefined ? (current.nickname || realName)
        : String(body.nickname).trim() === '' ? realName
        : text(body.nickname, '昵称', 40, true);
      const signature = body.signature === undefined ? (current.signature || '') : text(body.signature, '个性签名', 120, false);
      await bindStudent(current, studentId, realName);
      const user = await saveUser(current, { studentId, realName, nickname, signature, ...(changedIdentity ? { identityVerified: false } : {}) });
      if (user.term) await rebuildRoster(user.term);
      await repo.audit(user.id, changedIdentity ? 'identity.profile.bound' : 'identity.profile.updated', user.id, { profileComplete: profileComplete(user), identityVerified: user.identityVerified === true });
      return response({ user: publicUser(user) });
    }
    if (method === 'POST' && route === '/auth/password') {
      const auth = await authenticate(request, { required: true, csrf: true, allowEnrollment: true });
      const body = await readJson(request, 8192);
      await repo.throttle('password-change', auth.user.id, 5, 60);
      if (!await verifyPassword(body.currentPassword, auth.user.passwordHash)) fail(401, 'PASSWORD_INVALID', '当前密码不正确。');
      if (auth.user.totp && !auth.mfaVerified) await consumeFactor(auth.user, body.totp);
      const passwordHash = await hashPassword(validatePassword(body.newPassword));
      if (await verifyPassword(body.newPassword, auth.user.passwordHash)) fail(400, 'PASSWORD_UNCHANGED', '新密码应与当前密码不同。');
      await saveUser(auth.user, { passwordHash, mustChangePassword: false, securityVersion: secretToken() });
      await repo.audit(auth.user.id, 'identity.password.changed', auth.user.id);
      return response({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (method === 'POST' && route === '/auth/totp/setup') {
      const auth = await authenticate(request, { required: true, csrf: true, allowEnrollment: true });
      const body = await readJson(request, 8192);
      await repo.throttle('totp-setup', auth.user.id, 5, 60);
      if (auth.user.totp) fail(409, 'TOTP_ALREADY_ENABLED', '认证器已绑定。');
      if (!await verifyPassword(body.password, auth.user.passwordHash)) fail(401, 'PASSWORD_INVALID', '当前密码不正确。');
      const secret = newTotpSecret();
      const pendingTotp = { encrypted: encryptTotp(secret, env.PLATFORM_ENCRYPTION_KEY, auth.user.id), epoch: randomBytes(16).toString('hex'), expiresAt: now() + 10 * 60_000 };
      await repo.append(sessionKey(auth.sessionId), { ...auth.session, pendingTotp }, auth.session.revision);
      const label = encodeURIComponent(`StuDev:${auth.user.qq}`);
      return response({ secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=StuDev&algorithm=SHA1&digits=6&period=30` });
    }
    if (method === 'POST' && route === '/auth/totp/confirm') {
      const auth = await authenticate(request, { required: true, csrf: true, allowEnrollment: true });
      const body = await readJson(request, 8192);
      await repo.throttle('totp-confirm', auth.user.id, 8, 60);
      const pending = auth.session.pendingTotp;
      if (auth.user.totp || !pending || pending.expiresAt <= now()) fail(400, 'TOTP_SETUP_EXPIRED', '请重新开始认证器绑定。');
      const secret = decryptTotp(pending.encrypted, env.PLATFORM_ENCRYPTION_KEY, auth.user.id);
      const counter = matchedTotpCounter(secret, body.code, now());
      if (counter === null) fail(401, 'MFA_INVALID', '动态验证码无效。');
      const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(10).toString('hex').toUpperCase().match(/.{1,5}/g).join('-'));
      const totp = { encrypted: pending.encrypted, epoch: pending.epoch, recoveryHashes: recoveryCodes.map((code) => digest(`${auth.user.id}:${code}`)), enrolledAt: iso(now) };
      // Both atomic writes are deliberately before session elevation. Losing requests cannot gain access.
      await repo.putNew(`identity/totp-used/${auth.user.id}/${totp.epoch}/${counter}.json`, { usedAt: iso(now) });
      const user = await saveUser(auth.user, { totp, securityVersion: secretToken() });
      await repo.append(sessionKey(auth.sessionId), { ...auth.session, securityVersion: user.securityVersion, mfaVerified: true, pendingTotp: null }, auth.session.revision);
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
      return response({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (method === 'GET' && route === '/admin/users') {
      await authenticate(request, { owner: true });
      const users = await loadAllUsers();
      return response({ items: users.map(publicUser) });
    }
    if (method === 'POST' && route === '/admin/users') {
      const auth = await authenticate(request, { owner: true, csrf: true });
      const body = await readJson(request, 8192);
      const studentId = normalizeStudentId(body.studentId);
      const realName = normalizeRealName(body.realName);
      const qq = qqValue(body.qq);
      const role = body.role === undefined ? 'member' : body.role;
      if (!['admin', 'member'].includes(role)) fail(400, 'INVALID_ROLE', '预录成员角色须为成员或管理员。');
      const term = body.term === undefined ? '2026-2027' : text(body.term, '届别', 32, false);
      const department = body.department === undefined ? '' : text(body.department, '所属部门', 60, false);
      const title = body.title === undefined ? '' : text(body.title, '职务头衔', 80, false);
      const signature = body.signature === undefined ? '' : text(body.signature, '个性签名', 120, false);
      const order = body.order === undefined ? 999 : (Number.isSafeInteger(body.order) && body.order >= 0 && body.order <= 9999 ? body.order : fail(400, 'INVALID_FIELD', '排序序号须为 0–9999 的整数。'));
      if (await repo.get(studentKey(studentId))) fail(409, 'STUDENT_ID_ALREADY_REGISTERED', '该学号已存在记录。');
      if (await repo.get(`identity/qq/${qq}.json`)) fail(409, 'QQ_ALREADY_REGISTERED', '该 QQ 号已存在记录。');
      const id = randomUUID();
      await repo.putNew(`identity/qq/${qq}.json`, { id });
      await claimStudent(studentId, id);
      const user = await repo.append(userKey(id), {
        id, qq, nickname: realName, email: `${qq}@qq.com`, emailVerified: false,
        studentId, realName, identityVerified: true,
        term, department, title, order, signature,
        role, status: 'pending', passwordHash: '', mustChangePassword: false,
        securityVersion: secretToken(), totp: null, createdAt: iso(now), updatedAt: iso(now),
      }, 0);
      if (term) await rebuildRoster(term);
      await repo.audit(auth.user.id, 'identity.user.seeded', id, { studentId, qq, department, term });
      return response({ user: publicUser(user) }, 201);
    }
    if (method === 'GET' && route === '/admin/audit') {
      await authenticate(request, { owner: true });
      const keys = (await repo.list('audit/')).slice(0, 500);
      return response({ items: (await Promise.all(keys.map((key) => repo.get(key)))).filter(Boolean) });
    }
    const management = route.match(/^\/admin\/users\/([a-f0-9-]{36})(\/reset-password|\/reset-totp|\/delete)?$/);
    if (['POST', 'DELETE'].includes(method) && management) {
      const auth = await authenticate(request, { owner: true, csrf: true });
      const user = await loadUser(management[1]);
      if (management[2] === '/delete' || method === 'DELETE') {
        if (user.role === 'owner') fail(403, 'CANNOT_DELETE_OWNER', '不能删除所有者账号。');
        await repo.remove(`identity/qq/${user.qq}.json`);
        if (user.studentId) await repo.remove(studentKey(user.studentId));
        const userKeys = await repo.list(`identity/users/${user.id}`);
        for (const k of userKeys) await repo.remove(k);
        if (user.term) await rebuildRoster(user.term);
        await repo.audit(auth.user.id, 'identity.user.deleted', user.id, { studentId: user.studentId, qq: user.qq });
        return response({ ok: true });
      }
      const body = await readJson(request, 8192);
      if (management[2] === '/reset-password') {
        const passwordHash = await hashPassword(validatePassword(body.password));
        await saveUser(user, { passwordHash, mustChangePassword: true, securityVersion: secretToken() });
        await repo.audit(auth.user.id, 'identity.password.reset', user.id);
        return response({ ok: true });
      }
      if (management[2] === '/reset-totp') {
        await saveUser(user, { totp: null, securityVersion: secretToken() });
        await repo.audit(auth.user.id, 'identity.totp.reset', user.id);
        return response({ ok: true });
      }
      if (body.revision !== user.revision) fail(409, 'REVISION_CONFLICT', '账号已更新，请刷新后重试。');
      const role = body.role === undefined ? user.role : body.role;
      const status = body.status === undefined ? user.status : body.status;
      if (!['owner', 'admin', 'member'].includes(role) || !['active', 'disabled', 'pending'].includes(status)) fail(400, 'INVALID_ROLE', '账号角色或状态无效。');
      if (user.role === 'owner' && (role !== 'owner' || status !== 'active')) fail(403, 'LAST_OWNER_PROTECTED', '不能停用或降级平台所有者。');
      if (role === 'owner' && user.role !== 'owner') fail(403, 'OWNER_PROVISIONING_REQUIRED', '所有者由受控初始化配置管理。');
      const studentId = body.studentId === undefined ? (user.studentId || '') : normalizeStudentId(body.studentId);
      if (user.studentId && studentId !== user.studentId) fail(403, 'STUDENT_ID_LOCKED', '学号由首次绑定锁定，更正需受控维护，不能在此直接修改。');
      const realName = body.realName === undefined ? (user.realName || '') : normalizeRealName(body.realName);
      const rawNick = body.nickname === undefined ? undefined : String(body.nickname).trim();
      const nickname = rawNick === undefined ? user.nickname : rawNick === '' ? (realName || user.realName || user.qq) : text(rawNick, '昵称', 40, true);
      const nameChanged = realName !== (user.realName || '');
      const identityChanged = studentId !== (user.studentId || '') || nameChanged;
      if (studentId && !user.studentId && !realName) fail(400, 'INVALID_REAL_NAME', '首次绑定学号时请同时填写真实姓名。');
      if (body.identityVerified !== undefined && typeof body.identityVerified !== 'boolean') fail(400, 'INVALID_FIELD', '身份核验状态无效。');
      let identityVerified = identityChanged ? false : (body.identityVerified ?? (user.identityVerified === true));
      if (identityVerified && !profileComplete({ ...user, studentId, realName })) fail(409, 'PROFILE_REQUIRED', '账号需先补齐学号与真实姓名，再核验身份。');
      const term = body.term === undefined ? (user.term || '') : text(body.term, '届别', 32, false);
      const department = body.department === undefined ? (user.department || '') : normalizeDepartmentName(text(body.department, '所属部门', 60, false));
      const title = body.title === undefined ? (user.title || '') : normalizeRoleTitle(text(body.title, '职务头衔', 80, false));
      const signature = body.signature === undefined ? (user.signature || '') : text(body.signature, '个性签名', 120, false);
      const order = body.order === undefined ? (user.order ?? 999) : (Number.isSafeInteger(body.order) && body.order >= 0 && body.order <= 9999 ? body.order : fail(400, 'INVALID_FIELD', '排序序号须为 0–9999 的整数。'));
      const changedSecurity = role !== user.role || status !== user.status;
      if (studentId && !user.studentId) await bindStudent(user, studentId, realName);
      const updated = await saveUser(user, { role, status, nickname, studentId, realName, identityVerified, term, department, title, signature, order, ...(changedSecurity ? { securityVersion: secretToken() } : {}) });
      if (user.term || updated.term) await rebuildRoster(updated.term || user.term);
      await repo.audit(auth.user.id, 'identity.user.updated', user.id, { role, status, previousRole: user.role, previousStatus: user.status, department, term });
      if (identityChanged || identityVerified !== (user.identityVerified === true)) await repo.audit(auth.user.id, identityChanged ? 'identity.profile.corrected' : 'identity.verification.updated', user.id, { identityVerified, profileComplete: profileComplete(updated) });
      return response({ user: publicUser(updated) });
    }
    fail(404, 'NOT_FOUND', '接口不存在。');
  }
  return { handle, authenticate, publicUser };
}
