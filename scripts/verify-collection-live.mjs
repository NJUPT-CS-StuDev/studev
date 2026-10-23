// Explicit live smoke check for the deployed API. Does not upload files or modify submissions.
// Reads only the locally provisioned admin secret, never prints cookies, hashes or signed URLs.
import { readFile } from 'node:fs/promises';
const access = JSON.parse(await readFile(new URL('../.env.collection-access.local.json', import.meta.url), 'utf8'));
const origin = 'https://studev.hicancan.top';
const base = `${origin}/api/collection`;
async function check(name, path, init, expected) {
  const r = await fetch(base + path, { ...init, signal: AbortSignal.timeout(30000) });
  const body = await r.json().catch(() => ({}));
  console.log(JSON.stringify({ name, status: r.status, code: body.error?.code, passed: r.status === expected }));
  if (r.status !== expected) throw new Error(`${name}: unexpected status`);
  return { r, body };
}
const json = (body, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...extra }, body: JSON.stringify(body) });
try {
  await check('configuration', '/config', {}, 200);
  await check('anonymous_admin_denied', '/admin/submissions', {}, 401);
  await check('cross_origin_denied', '/admin/login', json({ password: 'not-a-password' }, { Origin: 'https://example.invalid' }), 403);
  await check('wrong_password_denied', '/admin/login', json({ password: 'not-a-password' }), 401);
  const { r, body } = await check('admin_login', '/admin/login', json({ password: access.adminPassword }), 200);
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  if (!cookie || !body.csrfToken) throw new Error('Missing protected session');
  await check('authenticated_list', '/admin/submissions', { headers: { Cookie: cookie } }, 200);
  await check('logout_without_csrf_denied', '/admin/logout', json({}, { Cookie: cookie }), 403);
  await check('logout', '/admin/logout', json({}, { Cookie: cookie, 'X-CSRF-Token': body.csrfToken }), 200);
  await check('revoked_session_denied', '/admin/submissions', { headers: { Cookie: cookie } }, 401);
} catch(error) {
  console.error(JSON.stringify({ status: 'failed', message: String(error.message).replace(/https?:\/\/\S+/g,'[url]') }));
  process.exitCode=1;
}
