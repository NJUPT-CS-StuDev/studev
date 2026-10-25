// Explicit synthetic browser fixture and empty draft maintenance; imports are inert.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeOwner, writePrivate } from './bootstrap-platform-owner.mjs';
import { privateFile } from './private-file.mjs';

async function prepare() {
  const path = privateFile('.env.platform-test.local.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  const run = state.runs.at(-1);
  if (run?.status !== 'api_verified' || !run.members[0]?.studentId) throw new Error('A completed student-identity API run is required.');
  const { client } = await initializeOwner();
  try {
    const forms = (await client.call('/admin/forms', { expected: 200 })).body.items;
    let updatedEmptyDrafts = 0;
    for (const form of forms) {
      if (form.status !== 'draft' || !['信息登记模板', '信息与材料模板'].includes(form.title) || !form.fields.some(field => field.id === 'name' && field.label === '姓名')) continue;
      const usage = (await client.call(`/admin/forms/${form.id}/submissions`, { expected: 200 })).body.usage;
      if (usage.authorizations !== 0) continue;
      const fields = form.fields.map(field => field.id === 'name' ? { ...field, id: 'topic', label: form.title === '信息登记模板' ? '登记内容' : '材料名称' } : field);
      if (form.title === '信息与材料模板' && !fields.some(field => field.id === 'note')) fields.splice(1, 0, { id: 'note', type: 'textarea', label: '说明' });
      await client.call(`/admin/forms/${form.id}`, { method: 'POST', body: { ...form, fields }, expected: 200 });
      updatedEmptyDrafts++;
    }
    if (!run.browserFormId) {
      const created = await client.call('/admin/forms', { method: 'POST', body: { title: `${run.label} · 学号浏览器收件`, description: '仅用于合成验收：身份由账号关联，无需重复填学号姓名。', status: 'published', access: 'members', allowEdit: true, maxSubmissions: 5, maxPerUser: 3, fields: [{ id: 'note', type: 'text', label: '材料说明', required: true }, { id: 'upload', type: 'file', label: '附件', required: true, extensions: ['txt'] }] }, expected: 201 });
      run.forms.push(created.body.form); run.browserFormId = created.body.form.id;
    }
    await writePrivate(path, JSON.stringify(state, null, 2) + '\n');
    console.log(JSON.stringify({ updatedEmptyDrafts, browserFormId: run.browserFormId, synthetic: true }));
  } finally { await client.call('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); }
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--run')) console.log(JSON.stringify({ status: 'inert' }));
  else try { await prepare(); } catch (error) { console.error(JSON.stringify({ status: 'failed', message: String(error.message).replace(/https?:\/\/\S+/g, '[url]') })); process.exitCode = 1; }
}
