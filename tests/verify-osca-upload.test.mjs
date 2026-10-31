import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assessCors, readConfig } from '../scripts/collection/verify-storage.mjs';

const script = fileURLToPath(new URL('../scripts/collection/verify-storage.mjs', import.meta.url));
const fakeEnv = {
  OSCA_ACCESS_KEY_ID: 'test-key-never-log',
  OSCA_SECRET_ACCESS_KEY: 'test-secret-never-log',
  OSCA_BUCKET: 'verification-test-bucket',
};

test('default execution with credentials is inert and never prints the credentials', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: fakeEnv, timeout: 5_000 });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.mode, 'configuration-check-only');
  assert.equal(output.configured, true);
  assert.equal(output.networkRequests, 0);
  assert.equal(output.remoteWrites, 0);
  assert.equal(output.filesWritten, 0);
  assert.ok(!result.stdout.includes(fakeEnv.OSCA_ACCESS_KEY_ID));
  assert.ok(!result.stdout.includes(fakeEnv.OSCA_SECRET_ACCESS_KEY));
});

test('explicit run without credentials refuses before touching the network', () => {
  const result = spawnSync(process.execPath, [script, '--run'], { encoding: 'utf8', env: {}, timeout: 5_000 });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout.trim()).code, 'MISSING_ENVIRONMENT');
});

test('misdirected endpoints and traversal prefixes cannot receive signing credentials', () => {
  assert.throws(() => readConfig({ ...fakeEnv, OSCA_ENDPOINT: 'https://attacker.example' }), /ENDPOINT_NOT_IN_IHEP_DOMAIN/u);
  assert.throws(() => readConfig({ ...fakeEnv, OSCA_ENDPOINT: 'http://fgws3-ocloud.ihep.ac.cn' }), /INVALID_HTTPS_ENDPOINT/u);
  assert.throws(() => readConfig({ ...fakeEnv, OSCA_PREFIX: 'studev-submissions/../other/' }), /INVALID_TEST_PREFIX/u);
});

test('CORS header assessment reports missing permissions and does not claim browser proof', () => {
  const limited = assessCors(new Headers({
    'access-control-allow-origin': 'https://studev.hicancan.top',
    'access-control-allow-methods': 'GET, HEAD',
    'access-control-allow-headers': 'content-type',
  }), { origin: 'https://studev.hicancan.top', method: 'PUT', requestHeaders: ['content-type'] });
  assert.equal(limited.originAllowed, true);
  assert.equal(limited.methodAllowed, false);
  assert.equal(limited.browserEnforcementVerified, false);
  assert.equal(limited.credentialsMode, 'omit');
});
