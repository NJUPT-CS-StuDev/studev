// Run with --guest for a read-only public smoke. Authenticated smoke accepts credentials over stdin.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import product from '../../product.json' with { type: 'json' };
import { totpCode } from '../../src/platform/server/totp.mjs';

const guestOnly = process.argv.includes('--guest');
let credential;
if (!guestOnly) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    credential = JSON.parse(input.trim());
    if (!credential.studentId || !credential.password) throw new Error();
  } catch {
    console.error('Credential input could not be decoded. No values logged.');
    process.exit(1);
  } finally { input = ''; }
}
const origin = product.origin;
const output = process.env.STUDEV_WEB_SMOKE_DIR || 'D:/Temp/codex/studev-web-experience';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', colorScheme: 'dark', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(45_000);
const reads = [], blocked = [];
const allowedWrites = guestOnly ? [] : ['/api/platform/auth/login', '/api/platform/auth/logout'];
const safePath = path => path.replace(/\/collections\/items\/[^/]+/, '/collections/items/:id').replace(/\/collections\/submissions\/[^/]+/, '/collections/submissions/:id');
let stage = 'initial', signedIn = false, success = false;

page.on('requestfinished', request => {
  const url = new URL(request.url());
  if (url.origin === origin && url.pathname.startsWith('/api/platform/')) {
    reads.push({ stage, path: safePath(url.pathname), method: request.method(), ms: Math.round(request.timing().responseEnd) });
  }
});
await page.route(origin + '/api/platform/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (!['GET', 'HEAD'].includes(request.method()) && !allowedWrites.includes(path)) {
    blocked.push(safePath(path));
    await route.abort('blockedbyclient');
  } else await route.continue();
});

function responseFor(path, method = 'GET') {
  return page.waitForResponse(response => new URL(response.url()).pathname === '/api/platform' + path && response.request().method() === method);
}

async function guestCollections() {
  stage = 'guest-catalog';
  await page.goto(origin + '/search/');
  const catalogResponse = responseFor('/collections');
  const tab = page.locator('.phone-tabs').getByRole('link', { name: '收集', exact: true });
  await tab.click();
  await page.waitForURL(url => url.pathname === '/forms/');
  assert.equal(await tab.getAttribute('aria-current'), 'page');
  const response = await catalogResponse;
  assert.equal(response.status(), 200);
  const catalog = await response.json();
  assert.equal(catalog.viewer, null);
  assert(catalog.items.length > 0, 'published public collections are discoverable');
  assert(catalog.items.every(item => item.visibility === 'public' && !item.canManage && !Object.hasOwn(item, 'recipients')));
  assert.equal(await page.getByRole('button', { name: '新建收集' }).count(), 0);

  stage = 'guest-detail';
  const item = catalog.items.find(item => item.id === product.forms.feedback);
  assert(item, 'the released feedback entry is present');
  const detailsResponse = responseFor('/collections/items/' + item.id);
  await page.goto(origin + '/forms/?id=' + encodeURIComponent(item.id));
  const detailResponse = await detailsResponse;
  assert.equal(detailResponse.status(), 200);
  const detail = await detailResponse.json();
  assert.equal(detail.viewer, null);
  await page.getByRole('heading', { name: item.name, exact: true }).waitFor();
  if (detail.item.rounds.some(round => round.open)) {
    await page.getByRole('link', { name: '登录后填写', exact: true }).waitFor();
  }
  assert(!Object.hasOwn(detail, 'board'));
  assert.deepEqual(detail.mySubmissions, []);
  assert(!Object.hasOwn(detail.item, 'recipients'));
  assert.equal(reads.filter(item => item.path === '/api/platform/auth/session').length, 0);
}

async function logout() {
  if (!signedIn) return;
  await page.goto(origin + '/account/');
  await page.getByRole('heading', { name: '我的账号', exact: true }).waitFor();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/login/');
  signedIn = false;
}

async function signedInChecks() {
  stage = 'password';
  await page.goto(origin + '/login/?next=%2Faccount%2F');
  assert.equal(await page.locator('[data-me]').count(), 0);
  await page.locator('#login-student-id').fill(credential.studentId);
  await page.locator('#login-password').fill(credential.password);
  const first = responseFor('/auth/login', 'POST');
  await page.locator('[data-login-form] button[type=submit]').click();
  let loginResponse = await first, loginData = await loginResponse.json();
  if (loginData.mfaRequired || ['MFA_REQUIRED', 'TOTP_REQUIRED'].includes(loginData.error?.code)) {
    stage = 'mfa';
    await page.locator('#login-totp').waitFor();
    await page.locator('#login-totp').fill(totpCode(credential.totpSecret, Math.floor(Date.now() / 30_000)));
    const final = responseFor('/auth/login', 'POST');
    await page.locator('[data-login-form] button[type=submit]').click();
    loginResponse = await final;
    loginData = await loginResponse.json();
  }
  assert.equal(loginResponse.status(), 200);
  signedIn = true;
  credential = undefined;
  await page.waitForURL(url => url.pathname === '/account/');
  await page.getByRole('heading', { name: '我的账号', exact: true }).waitFor();
  await page.locator('[data-me]').waitFor();
  assert.equal(await page.locator('[data-me]').count(), 1);
  assert(await page.locator('[data-account-content]').isVisible());
  assert.equal(reads.filter(item => item.path === '/api/platform/auth/devices').length, 0);
  assert.equal(reads.filter(item => item.path === '/api/platform/admin/users').length, 0);

  stage = 'devices';
  await page.getByRole('tab', { name: '登录设备', exact: true }).click();
  await page.locator('[data-account-devices] h3').first().waitFor();
  assert.equal(reads.filter(item => item.path === '/api/platform/auth/devices').length, 1);

  stage = 'signed-in-catalog';
  const catalogResponse = responseFor('/collections');
  await page.goto(origin + '/forms/');
  const response = await catalogResponse;
  assert.equal(response.status(), 200);
  const catalog = await response.json();
  assert.equal(catalog.viewer.id, loginData.user.id);
  assert.equal(catalog.viewer.role, loginData.user.role);
  const workspace = page.locator('.cw-workspace');
  await workspace.getByRole('link', { name: '我的提交', exact: true }).waitFor();
  assert.equal(await workspace.getByRole('combobox', { name: '视角' }).count(), 0);
  assert.equal(await workspace.getByRole('button', { name: '新建收集', exact: true }).count(), Number(catalog.viewer.canPublish));
  stage = 'logout';
  await logout();
}

try {
  stage = 'release';
  const published = await context.request.get(origin + '/app-release.json', { headers: { 'Cache-Control': 'no-cache' } });
  assert.equal(published.status(), 200);
  const { android } = await published.json();
  assert.equal(android.versionName, product.android.versionName);
  assert.equal(android.versionCode, product.android.versionCode);
  await guestCollections();
  if (!guestOnly) await signedInChecks();
  assert.deepEqual(blocked, []);
  success = true;
  console.log(guestOnly ? 'Live mobile collection navigation and guest visibility passed.' : 'Live collection access, sign-in, account, devices and logout passed.');
} catch (error) {
  console.error('Live browser verification failed at ' + stage + ' (' + error.name + '). Account values omitted.');
  process.exitCode = 1;
} finally {
  credential = undefined;
  if (signedIn) {
    try { stage = 'cleanup'; await logout(); }
    catch { console.error('Current test session logout needs follow-up.'); }
  }
  const evidence = { success, stage, reads, blocked };
  await writeFile(join(output, 'platform-live-result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  await context.close();
  await browser.close();
}
