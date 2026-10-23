// Explicit local owner initialization. Importing is inert; --run is required for live mutations.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { totpCode } from '../src/server/platform-totp.mjs';
import { LiveClient } from './platform-live-client.mjs';

const accessPath = new URL('../.env.platform-access.local.json', import.meta.url);
const recoveryPath = new URL('../.env.platform-owner-recovery.local.json', import.meta.url);
const setupPath = new URL('../.env.platform-owner-setup.local.html', import.meta.url);
const profilePath = new URL('../.env.platform-owner-profile.local.json', import.meta.url);
export async function writePrivate(path, text) {
  try { await writeFile(path, '', { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (process.platform === 'win32') {
    // icacls changes only the DACL; Set-Acl can request unavailable SACL privileges
    // on existing protected files. Refuse to write if any unexpected grant remains.
    const command = "$ErrorActionPreference='Stop'; $p=$env:STUDEV_PROTECT_FILE; $current=[System.Security.Principal.WindowsIdentity]::GetCurrent(); & icacls.exe $p /inheritance:r /grant:r ($current.Name+':(F)') 'SYSTEM:(F)' | Out-Null; if($LASTEXITCODE -ne 0){throw 'Private file ACL update failed'}; $acl=Get-Acl -LiteralPath $p; $allowed=@($current.User.Value,'S-1-5-18'); if(-not $acl.AreAccessRulesProtected -or @($acl.Access | Where-Object {$_.IsInherited -or $_.AccessControlType -ne 'Allow' -or $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed}).Count){throw 'Unexpected private file ACL'}";
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'pipe', env: { ...process.env, STUDEV_PROTECT_FILE: fileURLToPath(path) } });
  }
  await writeFile(path, text, { mode: 0o600 });
}
async function readOptional(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function ensure(result, expected, label) {
  if (result.status !== expected) {
    const code = /^[A-Z0-9_]{1,64}$/.test(result.body?.error?.code || '') ? result.body.error.code : 'UNEXPECTED_RESPONSE';
    throw new Error(`${label} failed (${result.status} ${code})`);
  }
  return result.body;
}
export async function loginOwner(client, access, recovery) {
  const profile = await readOptional(profilePath);
  const studentId = profile?.studentId || access.ownerStudentId;
  let loginPath = '/auth/login';
  let identifier = { studentId };
  let result = await client.call(loginPath, { method: 'POST', body: { ...identifier, password: access.ownerPassword } });
  if ((result.status === 401 || result.status === 400) && studentId) {
    // This migration endpoint only accepts pre-upgrade accounts with missing identity.
    // Once bound, the same QQ cannot authenticate through this endpoint again.
    loginPath = '/auth/legacy-profile-login'; identifier = { qq: access.ownerQq };
    result = await client.call(loginPath, { method: 'POST', body: { ...identifier, password: access.ownerPassword } });
  }
  if (result.status === 401 && access.pendingOwnerPassword) {
    result = await client.call(loginPath, { method: 'POST', body: { ...identifier, password: access.pendingOwnerPassword } });
    if (result.status === 200) { access.ownerPassword = access.pendingOwnerPassword; delete access.pendingOwnerPassword; await writePrivate(accessPath, JSON.stringify(access, null, 2) + '\n'); }
  }
  let body = ensure(result, 200, 'Owner login');
  if (body.mfaRequired) {
    if (!recovery?.secret) throw new Error('Owner authenticator material is required; no automatic MFA bypass is provided.');
    for (let attempt = 0; attempt < 2; attempt++) {
      result = await client.call(loginPath, { method: 'POST', body: { ...identifier, password: access.ownerPassword, totp: totpCode(recovery.secret, Math.floor(Date.now() / 30000)) } });
      if (result.status === 200) return result.body;
      if (result.body?.error?.code !== 'MFA_REPLAYED' || attempt) break;
      // Wait only for the next standard TOTP step, at most 30 seconds.
      await new Promise((r) => setTimeout(r, 30000 - Date.now() % 30000 + 100));
    }
    body = ensure(result, 200, 'Owner MFA');
  }
  return body;
}
export async function initializeOwner() {
  const access = JSON.parse(await readFile(accessPath, 'utf8'));
  let recovery = await readOptional(recoveryPath);
  const client = new LiveClient('https://studev.hicancan.top');
  let state = await loginOwner(client, access, recovery);
  if (state.passwordChangeRequired) {
    access.pendingOwnerPassword ||= randomBytes(24).toString('base64url');
    await writePrivate(accessPath, JSON.stringify(access, null, 2) + '\n');
    ensure(await client.call('/auth/password', { method: 'POST', body: { currentPassword: access.ownerPassword, newPassword: access.pendingOwnerPassword } }), 200, 'Initial password change');
    access.ownerPassword = access.pendingOwnerPassword; delete access.pendingOwnerPassword;
    await writePrivate(accessPath, JSON.stringify(access, null, 2) + '\n');
    state = await loginOwner(client, access, recovery);
  }
  if (state.enrollmentRequired) {
    const setup = ensure(await client.call('/auth/totp/setup', { method: 'POST', body: { password: access.ownerPassword } }), 200, 'Owner TOTP setup');
    recovery = { secret: setup.secret, otpauthUrl: setup.otpauthUrl, status: 'pending', createdAt: new Date().toISOString() };
    await writePrivate(recoveryPath, JSON.stringify(recovery, null, 2) + '\n');
    const confirmed = ensure(await client.call('/auth/totp/confirm', { method: 'POST', body: { code: totpCode(setup.secret, Math.floor(Date.now() / 30000)) } }), 200, 'Owner TOTP confirmation');
    recovery.recoveryCodes = confirmed.recoveryCodes; recovery.status = 'ready';
    await writePrivate(recoveryPath, JSON.stringify(recovery, null, 2) + '\n');
    const svg = await QRCode.toString(setup.otpauthUrl, { type: 'svg', width: 260, margin: 3 });
    await writePrivate(setupPath, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>StudDev 所有者认证器初始化资料</title><style>body{max-width:640px;margin:3rem auto;padding:1rem;font:16px system-ui;line-height:1.7}svg{display:block;width:260px;height:260px}code{overflow-wrap:anywhere}</style><h1>StudDev 所有者认证器</h1><p>此文件包含敏感绑定资料，仅在本机查看。用你的认证器扫描二维码，或手动输入下方密钥。请妥善保管恢复码；添加认证器后可将此初始化文件离线保管。</p>${svg}<p>手动密钥：<code>${setup.secret}</code></p><p>恢复码保存在同目录的受限 owner-recovery 配置中；不要将这些资料发送给成员或上传 Git。</p></html>`);
  }
  let session = ensure(await client.call('/auth/session'), 200, 'Owner initialized session');
  if (!session.mfaVerified || session.enrollmentRequired || session.passwordChangeRequired || session.user.role !== 'owner') throw new Error('Owner initialization remains incomplete.');
  if (session.profileRequired) {
    const profile = await readOptional(profilePath);
    if (!profile?.studentId || !profile?.realName) throw new Error('Owner student profile is required in the private local owner-profile configuration.');
    ensure(await client.call('/auth/profile', { method: 'POST', body: { studentId: profile.studentId, realName: profile.realName, revision: session.user.revision } }), 200, 'Owner identity profile');
    session = ensure(await client.call('/auth/session'), 200, 'Owner profile session');
    if (session.profileRequired || !session.user.profileComplete) throw new Error('Owner student profile remains incomplete.');
  }
  access.initializedAt ||= new Date().toISOString();
  if (session.user.studentId) access.ownerStudentId = session.user.studentId;
  await writePrivate(accessPath, JSON.stringify(access, null, 2) + '\n');
  console.log(JSON.stringify({ ownerInitialized: true, mfaVerified: true, credentialsPrinted: false }));
  return { client, access, recovery, user: session.user };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--run')) console.log(JSON.stringify({ status: 'inert', action: 'Pass --run only after the production platform has been deployed.' }));
  else {
    try { const { client } = await initializeOwner(); await client.call('/auth/logout', { method: 'POST', body: {}, expected: 200 }); }
    catch (error) { console.error(JSON.stringify({ status: 'failed', message: String(error.message).replace(/https?:\/\/\S+/g, '[url]') })); process.exitCode = 1; }
  }
}
