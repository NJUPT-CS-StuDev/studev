// Archive synthetic acceptance forms and disable synthetic accounts; no permanent deletion.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeOwner, writePrivate } from './bootstrap-owner.mjs';
import { privateFile } from '../private/files.mjs';
const statePath = privateFile('.env.platform-test.local.json');
async function finalize() {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const { client } = await initializeOwner();
  let archived = 0, disabled = 0;
  try {
    const forms = (await client.call('/admin/forms', { expected: 200 })).body.items;
    const labels = state.runs.map(run => run.label);
    for (const form of forms) if ((labels.some(label => form.title.startsWith(label)) || form.title.startsWith('浏览器验收 ·')) && form.status !== 'archived') {
      await client.call(`/admin/forms/${form.id}`, { method: 'POST', body: { ...form, status: 'archived' }, expected: 200 }); archived++;
    }
    const users = (await client.call('/admin/users', { expected: 200 })).body.items;
    const synthetic = new Set(state.runs.flatMap(run => run.members.map(member => member.id)).filter(Boolean));
    for (const user of users) if (synthetic.has(user.id) && user.status !== 'disabled') {
      await client.call(`/admin/users/${user.id}`, { method: 'POST', body: { revision: user.revision, role: 'user', status: 'disabled' }, expected: 200 }); disabled++;
    }
    state.finalizedAt = new Date().toISOString();
    await writePrivate(statePath, JSON.stringify(state, null, 2) + '\n');
    const finalForms = (await client.call('/admin/forms', { expected: 200 })).body.items;
    const finalUsers = (await client.call('/admin/users', { expected: 200 })).body.items;
    const syntheticForms = finalForms.filter(form => labels.some(label => form.title.startsWith(label)) || form.title.startsWith('浏览器验收 ·'));
    const syntheticUsers = finalUsers.filter(user => synthetic.has(user.id));
    if (!syntheticForms.every(form => form.status === 'archived') || !syntheticUsers.every(user => user.status === 'disabled')) throw new Error('Synthetic acceptance cleanup remains incomplete.');
    const reportPath = new URL('../../docs/platform-operations.assets/live-verification.json', import.meta.url);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    report.finalization = { finalizedAt: state.finalizedAt, archivedSyntheticForms: syntheticForms.length, disabledSyntheticUsers: syntheticUsers.length, newlyArchivedForms: archived, newlyDisabledUsers: disabled, reusableDraftTemplates: finalForms.filter(form => ['信息登记模板', '文件收集模板', '信息与材料模板'].includes(form.title) && form.status === 'draft').length, publishedForms: finalForms.filter(form => form.status === 'published').length, postconditionsVerified: true, permanentDeletion: false };
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.finalization));
  } finally { await client.call('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); }
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--run')) console.log(JSON.stringify({ status: 'inert' }));
  else try { await finalize(); } catch (error) { console.error(JSON.stringify({ status: 'failed', message: String(error.message).replace(/https?:\/\/\S+/g, '[url]') })); process.exitCode = 1; }
}
