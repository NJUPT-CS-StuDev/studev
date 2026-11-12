// Run with --output <njupt-data/evidence/contributions>. The existing private owner files stay outside the repo.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import product from '../../product.json' with { type: 'json' };
import { LiveClient } from './live-client.mjs';
import { loginOwner } from './bootstrap-owner.mjs';
import { privateFile } from '../private/files.mjs';

export async function exportContributions(client, output) {
  const result = await client.call(`/admin/forms/${product.forms.data}/submissions`, { expected: 200 });
  const accepted = result.body.items.filter(record => record.status === 'accepted');
  let count = 0;
  for (const record of accepted) {
    if (!/^[a-f0-9-]{36}$/.test(record.id)) throw new Error('Invalid submission ID');
    const folder = join(output, record.id);
    await mkdir(folder, { recursive: true });
    const files = [];
    for (const file of record.files) {
      if (!/^[a-f0-9-]{36}$/.test(file.id) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error('Invalid contribution attachment');
      const safeName = basename(file.name.replaceAll('\\', '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 150);
      if (!safeName) throw new Error('Attachment has no usable name');
      const path = `${file.id}-${safeName}`;
      const signed = (await client.call(`/submissions/${record.id}/files/${file.id}/download`, { method: 'POST', body: {}, expected: 200 })).body.download;
      const url = new URL(signed.url);
      if (url.protocol !== 'https:' || url.username || url.password || signed.method !== 'GET') throw new Error('Invalid attachment download');
      let response;
      try { response = await fetch(url, { headers: signed.headers, redirect: 'error', signal: AbortSignal.timeout(60000) }); }
      catch { throw new Error('Contribution attachment download failed'); }
      if (!response.ok || !response.body) throw new Error(`Attachment download failed (${response.status})`);
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > file.size) throw new Error('Attachment size changed'); chunks.push(chunk); }
      if (size !== file.size) throw new Error('Attachment size changed');
      await writeFile(join(folder, path), Buffer.concat(chunks));
      files.push({ id: file.id, name: file.name, path, size, type: file.type });
    }
    // Acquisition evidence contains the public material and its review, never student identity or signed links.
    await writeFile(join(folder, 'submission.json'), JSON.stringify({ id: record.id, formId: record.formId, status: record.status, answers: record.answers, review: record.review, createdAt: record.createdAt, files }, null, 2) + '\n');
    count++;
  }
  return { accepted: count, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node scripts/platform/export-contributions.mjs --output <evidence/contributions>');
  const output = resolve(args[1]);
  await mkdir(output, { recursive: true });
  const access = JSON.parse(await readFile(privateFile('.env.platform-access.local.json'), 'utf8'));
  const recovery = JSON.parse(await readFile(privateFile('.env.platform-owner-recovery.local.json'), 'utf8'));
  const client = new LiveClient(product.origin);
  try { await loginOwner(client, access, recovery); console.log(JSON.stringify(await exportContributions(client, output))); }
  finally { if (client.csrf) await client.call('/auth/logout', { method: 'POST', body: {} }); }
}
