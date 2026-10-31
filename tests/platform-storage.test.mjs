import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/server/platform-crypto.mjs';
import { oscaGateway } from '../src/server/platform-storage.mjs';

test('current password hashes verify without changing the stored credential format', async () => {
  const encoded = await hashPassword('synthetic-password-only', 'a'.repeat(32));
  assert.equal(await verifyPassword('synthetic-password-only', encoded), true);
  assert.equal(await verifyPassword('wrong-password', encoded), false);
  assert.equal(await verifyPassword('synthetic-password-only', 'invalid'), false);
});

test('current attachment signing binds PUT size/type and conditional safe downloads', async () => {
  const gateway = oscaGateway({ endpoint: 'https://s3.test', region: 'us-east-1', bucket: 'test-bucket', accessKeyId: 'synthetic-key', secretAccessKey: 'synthetic-secret' });
  const record = { objectKey: 'studev-submissions/platform/form/staging/file.txt', finalObjectKey: 'studev-submissions/platform/form/final/file', fileName: '资料.txt', contentType: 'text/plain', fileSize: 1024 };
  const upload = await gateway.presignUpload(record, 60);
  assert.equal(new URL(upload.url).searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
  const download = await gateway.presignDownload(record, '"etag"', 60);
  const url = new URL(download.url);
  assert.equal(url.pathname, `/test-bucket/${record.finalObjectKey}`);
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host;if-match');
  assert.match(url.searchParams.get('response-content-disposition'), /^attachment;/);
  assert.equal(url.searchParams.get('response-content-type'), 'application/octet-stream');
  assert.equal(download.headers['If-Match'], '"etag"');
});
