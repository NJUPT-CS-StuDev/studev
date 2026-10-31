// Local browser acceptance: all platform requests are mocked; no live accounts.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';
const base = process.argv[2] || 'http://127.0.0.1:4323';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = resolve(process.argv[3] || 'D:/Temp/codex/accounts/screenshots');
await mkdir(output, { recursive: true });
const user = { id: '00000000-0000-0000-0000-000000000001', qq: '10000901', nickname: '风中的树', realName: '合成测试同学', studentId: 'B26000001', email: '10000901@qq.com', emailVerified: false, role: 'user', status: 'active', revision: 1, profileComplete: true, identityVerified: false, totpEnabled: false, mustChangePassword: false };
let signedIn = false, requireFactor = true;
const writes = [], errors = [], requests = [];
const browser = await puppeteer.launch({ headless: true });
try {
 const page = await browser.newPage();
 page.on('pageerror', e => errors.push(e.message));
 await page.setViewport({ width: 1365, height: 1000, deviceScaleFactor: 1 });
 await page.setRequestInterception(true);
 page.on('request', async request => {
  const url = new URL(request.url());
  if (!url.pathname.startsWith('/api/platform/')) { await request.continue(); return; }
  const path = url.pathname.slice('/api/platform'.length);
  requests.push(path);
  const body = request.postData() ? JSON.parse(request.postData()) : undefined;
  if (body) writes.push({ path, body });
  let status = 200, value = {};
  const session = { user, csrfToken: 'synthetic-browser-csrf', mfaVerified: signedIn, passwordChangeRequired: false, enrollmentRequired: false, profileRequired: false, mfaRequired: false };
  if (path === '/auth/config') value = { registrationEnabled: true, emailDeliveryEnabled: false };
  else if (path === '/auth/register') { assert.equal(body.nickname, user.nickname); assert.ok(!('inviteCode' in body)); status = 201; value = { user }; }
  else if (path === '/auth/login') {
   assert.match(body.deviceId, /^[A-Za-z0-9_-]{16,128}$/); assert.ok(body.deviceName);
   if (requireFactor && body.totp !== '123456') { status = 401; value = { error: { code: 'MFA_REQUIRED', message: '请填写认证器动态验证码或恢复码。' } }; }
   else { signedIn = true; value = session; }
  } else if (path === '/auth/session') { if (signedIn) value = session; else { status = 401; value = { error: { code: 'AUTH_REQUIRED', message: '请先登录。' } }; } }
  else if (path === '/auth/devices') value = { items: [
   { id: '00000000-0000-0000-0000-000000000002', deviceName: 'Windows · Chrome', kind: 'cookie', current: true, createdAt: '2026-10-31T12:00:00Z', expiresAt: Date.now() + 86400000 },
   { id: '00000000-0000-0000-0000-000000000003', deviceName: 'Huawei ADA-AL00', kind: 'bearer', current: false, createdAt: '2026-10-31T11:00:00Z', expiresAt: Date.now() + 86400000 },
  ] };
  else if (path.endsWith('/revoke')) value = { ok: true };
  else { status = 403; value = { error: { code: 'STAFF_REQUIRED', message: '此操作仅限管理员。' } }; }
  await request.respond({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(value) });
 });
 const fill = async (id, value) => { await page.locator(id).fill(value); };
 await page.goto(base + '/login/?tab=register&next=/account/', { waitUntil: 'networkidle0' });
 assert.equal(await page.$('#register-invite'), null);
 await fill('#register-student-id', user.studentId); await fill('#register-real-name', user.realName); await fill('#register-nickname', user.nickname); await fill('#register-qq', user.qq);
 await fill('#register-password', 'Synthetic-password-123'); await fill('#register-confirm', 'Synthetic-password-123');
 await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
 await page.screenshot({ path: output + '/web-register-desktop.png', fullPage: true });
 await page.click('[data-register-form] button[type=submit]');
 await page.waitForFunction(() => document.querySelector('[data-auth-status]').textContent.includes('注册成功'));
 await fill('#login-password', 'Synthetic-password-123'); await page.click('[data-login-form] button[type=submit]');
 await page.waitForSelector('[data-login-totp]:not([hidden])');
 await page.screenshot({ path: output + '/web-login-mfa.png', fullPage: true });
 await fill('#login-totp', '123456');
 await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('[data-login-form] button[type=submit]')]);
 await page.waitForSelector('[data-account-content]:not([hidden])');
 await page.addStyleTag({ content: 'astro-dev-toolbar { display: none !important; }' });
 assert.equal(await page.$eval('[data-account-tab=members]', e => e.hidden), true);
 assert.ok(!requests.includes('/admin/users'));
 await page.waitForFunction(() => document.querySelector('[data-account-devices]').textContent.includes('Huawei'));
 await page.screenshot({ path: output + '/web-account-desktop.png', fullPage: true });
 await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
 await page.$eval('[data-account-devices]', e => e.scrollIntoView({ block: 'center' }));
 await page.screenshot({ path: output + '/web-devices-mobile.png' });
 await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
 await page.screenshot({ path: output + '/web-devices-mobile-dark.png' });
 const buttons = await page.$$('[data-account-devices] button');
 await buttons.at(-1).click();
 const confirmButtons = await page.$$('[data-account-devices] button');
 for (const button of confirmButtons) if (await button.evaluate(e => e.textContent === '确认退出')) { await button.click(); break; }
 await page.waitForFunction(() => document.querySelector('[data-devices-status]').textContent.includes('设备已退出'));
 assert.equal(writes.at(-1).path, '/auth/devices/00000000-0000-0000-0000-000000000003/revoke');
 assert.deepEqual(errors, []);
 console.log(JSON.stringify({ passed: true, writes: writes.map(w => w.path), screenshots: output, errors }));
} finally { await browser.close(); }
