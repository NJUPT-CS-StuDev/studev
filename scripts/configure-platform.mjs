// Local provisioning only. No credentials are ever printed or placed in shell command text.
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { hashPassword } from '../src/server/collection-auth.mjs';
import { privateFile } from './private-file.mjs';

const envPath = privateFile('.env.platform.local');
const accessPath = privateFile('.env.platform-access.local.json');
let config = {}, access;
try { config = parseEnv(await readFile(envPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
try { access = JSON.parse(await readFile(accessPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const ownerQq = config.PLATFORM_OWNER_QQ || process.env.STUDEV_OWNER_QQ;
if (!/^[1-9]\d{4,11}$/.test(ownerQq || '')) throw new Error('Provide the explicitly selected owner QQ via STUDEV_OWNER_QQ for first-time provisioning.');
access ||= {
  ownerQq, ownerEmail: `${ownerQq}@qq.com`, ownerPassword: randomBytes(24).toString('base64url'),
  registrationCode: randomBytes(14).toString('base64url'),
  ownerUrl: 'https://studev.hicancan.top/login/', formsUrl: 'https://studev.hicancan.top/forms/',
  createdAt: new Date().toISOString(),
};
config = {
  ...config, PLATFORM_ENABLED: 'true', PLATFORM_ORIGIN: 'https://studev.hicancan.top',
  PLATFORM_SESSION_SECRET: config.PLATFORM_SESSION_SECRET || randomBytes(48).toString('base64url'),
  PLATFORM_ENCRYPTION_KEY: config.PLATFORM_ENCRYPTION_KEY || randomBytes(32).toString('base64'),
  PLATFORM_REGISTRATION_HASH: config.PLATFORM_REGISTRATION_HASH || await hashPassword(access.registrationCode),
  PLATFORM_OWNER_QQ: ownerQq,
  PLATFORM_OWNER_PASSWORD_HASH: config.PLATFORM_OWNER_PASSWORD_HASH || await hashPassword(access.ownerPassword),
  PLATFORM_OWNER_NICKNAME: config.PLATFORM_OWNER_NICKNAME || 'hicancan',
};
await writeFile(envPath, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
await writeFile(accessPath, JSON.stringify(access, null, 2) + '\n');
console.log(JSON.stringify({ localConfiguration: 'ready', credentialsPrinted: false }));

if (process.argv.includes('--sync')) {
  const cli = process.env.EDGEONE_CLI_PATH;
  if (!cli) throw new Error('Set EDGEONE_CLI_PATH to the installed official CLI entry point.');
  for (const [key, value] of Object.entries(config)) {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, 'makers', 'env', 'set', key, value, '-e', 'production'], { env: { ...process.env, PAGES_SOURCE: 'skills' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (b) => { output += b; }); child.stderr.on('data', (b) => { output += b; });
      child.on('error', () => resolve({ code: 1, output: 'Unable to launch official CLI' }));
      child.on('close', (code) => resolve({ code, output }));
    });
    if (result.code !== 0) {
      let safe = result.output;
      for (const v of Object.values(config)) if (v.length > 3) safe = safe.split(v).join('[redacted]');
      console.error(JSON.stringify({ key, status: 'failed', error: safe })); process.exit(1);
    }
    console.log(JSON.stringify({ key, status: 'configured', valuePrinted: false }));
  }
}
