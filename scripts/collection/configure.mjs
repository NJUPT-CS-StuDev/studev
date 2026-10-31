import product from '../../product.json' with { type: 'json' };
// Run locally only. Reads the approved, git-ignored OSCA configuration without printing secrets.
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { hashPassword } from '../../src/server/collection-auth.mjs';
import { privateFile } from '../private/files.mjs';

const configPath = privateFile('.env.collection.local');
const accessPath = privateFile('.env.collection-access.local.json');
const original = parseEnv(await readFile(configPath, 'utf8'));
if (!original.OSCA_ACCESS_KEY_ID || !original.OSCA_SECRET_ACCESS_KEY) throw new Error('Approved OSCA credentials are missing.');
let access;
try { access = JSON.parse(await readFile(accessPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
  access = { adminUrl: `${product.origin}/admin/`, submitUrl: `${product.origin}/submit/`, adminPassword: randomBytes(24).toString('base64url'), inviteCode: randomBytes(12).toString('base64url'), createdAt: new Date().toISOString() };
  await writeFile(accessPath, JSON.stringify(access, null, 2), { flag: 'w' });
}
const config = {
  ...original,
  COLLECTION_ENABLED: 'true',
  COLLECTION_ORIGIN: product.origin,
  COLLECTION_ID: 'club-2026-10',
  COLLECTION_TITLE: '社团资料收集',
  COLLECTION_INSTRUCTIONS: '请使用活动负责人提供的收件码，提交本次活动所需资料。文件仅供负责人查看。',
  COLLECTION_ADMIN_HASH: original.COLLECTION_ADMIN_HASH || await hashPassword(access.adminPassword),
  COLLECTION_INVITE_HASH: original.COLLECTION_INVITE_HASH || await hashPassword(access.inviteCode),
  COLLECTION_SESSION_SECRET: original.COLLECTION_SESSION_SECRET || randomBytes(48).toString('base64url'),
  COLLECTION_MAX_FILE_BYTES: '20971520',
  COLLECTION_MAX_SUBMISSIONS: '500',
};
await writeFile(configPath, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
console.log(JSON.stringify({ localConfiguration: 'ready', credentialsPrinted: false }));
if (process.argv.includes('--sync')) {
  const cli = process.env.EDGEONE_CLI_PATH;
  if (!cli) throw new Error('Set EDGEONE_CLI_PATH to the official installed EdgeOne CLI.');
  // Values are passed as discrete arguments, never shell-expanded, and all CLI output is captured.
  const credentialsOnly = process.argv.includes('--credentials-only');
  for (const [key, value] of Object.entries(config).filter(([name]) => credentialsOnly ? ['OSCA_ACCESS_KEY_ID', 'OSCA_SECRET_ACCESS_KEY'].includes(name) : name.startsWith('OSCA_') || name.startsWith('COLLECTION_'))) {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, 'makers', 'env', 'set', key, value, '-e', 'production'], { env: { ...process.env, PAGES_SOURCE: 'skills' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('error', () => resolve({ code: 1, output: 'Unable to launch the installed CLI.' }));
      child.on('close', (code) => resolve({ code, output }));
    });
    if (result.code !== 0) {
      let safe = result.output;
      for (const secret of Object.values(config)) if (secret.length > 3) safe = safe.split(secret).join('[redacted]');
      console.error(JSON.stringify({ key, status: 'failed', error: safe }));
      process.exit(1);
    }
    console.log(JSON.stringify({ key, status: 'configured', valuePrinted: false }));
  }
}
