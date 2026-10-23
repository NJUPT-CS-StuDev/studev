#!/usr/bin/env node
/**
 * Verify an OSCA private, prefix-scoped S3 credential without exposing it.
 *
 * Default: configuration check only, no network requests or files written.
 * Run explicitly: node scripts/verify-osca-upload.mjs --run
 *
 * Read ONLY from this process's environment (never reads .env or a profile):
 *   OSCA_ACCESS_KEY_ID, OSCA_SECRET_ACCESS_KEY, OSCA_BUCKET
 *   OSCA_ENDPOINT (default https://fgws3-ocloud.ihep.ac.cn)
 *   OSCA_REGION   (default us-east-1)
 *   OSCA_PREFIX   (default studev-submissions/)
 *   STUDEV_ORIGIN (default https://studev.hicancan.top)
 *
 * --run writes random 1 KiB staging/final test objects under
 * <OSCA_PREFIX>_verification/ and deletes only its own objects in finally.
 * It never creates buckets, policies, access keys, or changes CORS.
 * It HEADs one random nonexistent object OUTSIDE OSCA_PREFIX to verify denial;
 * it does not list or read other files. Use a prefix-scoped credential.
 *
 * Credentials and signed URLs are never printed or saved. Reports contain
 * status/code/hash only, except a cleanup-failure report retains the random
 * test key locally to allow recovery. Reports are restricted to the task's
 * D:\Temp\codex\studev-osca-upload-20261021 directory.
 *
 * This verifies HTTP behavior from Node. A real browser must still verify
 * CORS enforcement and the deployed application end to end.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPORT_ROOT = 'D:\\Temp\\codex\\studev-osca-upload-20261021';
const MIME = 'text/plain; charset=utf-8';
const TIMEOUT_MS = 20_000;
const REJECTED = new Set([401, 403]);

class VerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'VerificationError';
    this.code = code;
  }
}

export function readConfig(env = process.env) {
  const required = ['OSCA_ACCESS_KEY_ID', 'OSCA_SECRET_ACCESS_KEY', 'OSCA_BUCKET'];
  const missing = required.filter((name) => !env[name]?.trim());
  const endpoint = new URL(env.OSCA_ENDPOINT || 'https://fgws3-ocloud.ihep.ac.cn');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname)) {
    throw new VerificationError('INVALID_HTTPS_ENDPOINT');
  }
  if (!endpoint.hostname.endsWith('.ihep.ac.cn')) {
    throw new VerificationError('ENDPOINT_NOT_IN_IHEP_DOMAIN');
  }
  const bucket = env.OSCA_BUCKET?.trim() || '';
  if (bucket && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,127}$/.test(bucket)) {
    throw new VerificationError('INVALID_BUCKET_NAME');
  }
  let prefix = env.OSCA_PREFIX || 'studev-submissions/';
  if (!prefix.endsWith('/')) prefix += '/';
  if (prefix.startsWith('/') || prefix.includes('\\') || prefix.includes('//') ||
      prefix.split('/').some((segment) => segment === '.' || segment === '..') ||
      /[\x00-\x1f\x7f]/u.test(prefix)) {
    throw new VerificationError('INVALID_TEST_PREFIX');
  }
  const origin = new URL(env.STUDEV_ORIGIN || 'https://studev.hicancan.top');
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password ||
      (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
    throw new VerificationError('INVALID_ORIGIN');
  }
  const region = env.OSCA_REGION || 'us-east-1';
  if (!/^[a-z0-9-]{1,64}$/.test(region)) throw new VerificationError('INVALID_REGION');
  return {
    configured: missing.length === 0,
    missing,
    endpoint: endpoint.origin,
    bucket,
    prefix,
    region,
    origin: origin.origin,
    accessKeyId: env.OSCA_ACCESS_KEY_ID || '',
    secretAccessKey: env.OSCA_SECRET_ACCESS_KEY || '',
  };
}

export function assessCors(headers, { origin, method, requestHeaders = [] }) {
  const allowOrigin = headers.get('access-control-allow-origin') || '';
  const methods = (headers.get('access-control-allow-methods') || '').split(',').map((x) => x.trim().toUpperCase());
  const allowedHeaders = (headers.get('access-control-allow-headers') || '').split(',').map((x) => x.trim().toLowerCase());
  return {
    originAllowed: allowOrigin === '*' || allowOrigin === origin,
    methodAllowed: methods.includes('*') || methods.includes(method.toUpperCase()),
    headersAllowed: allowedHeaders.includes('*') || requestHeaders.every((x) => allowedHeaders.includes(x.toLowerCase())),
    credentialsMode: 'omit',
    browserEnforcementVerified: false,
  };
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function request(url, init = {}) {
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Raw fetch errors can contain the signed URL; never serialize them.
    throw new VerificationError('NETWORK_OR_REDIRECT_FAILURE');
  }
}

async function responseCode(response) {
  if (response.ok) return null;
  try {
    const text = (await response.text()).slice(0, 32_768);
    return /<Code>([A-Za-z0-9_-]{1,100})<\/Code>/u.exec(text)?.[1] || null;
  } catch {
    return null;
  }
}

async function requireStatus(response, name, statuses, report, details = {}) {
  const ok = statuses.has(response.status);
  const check = { name, status: ok ? 'passed' : 'failed', httpStatus: response.status, ...details };
  const code = await responseCode(response);
  if (code) check.serviceCode = code;
  report.checks.push(check);
  emit(check);
  if (!ok) throw new VerificationError(`CHECK_FAILED_${name.toUpperCase()}`);
}

async function readTestObject(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new VerificationError('GET_RESPONSE_BODY_MISSING');
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new VerificationError('GET_RESPONSE_EXCEEDS_TEST_SIZE');
      parts.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts);
}

function safeFailure(error) {
  // Only our enumerated errors are printable; SDK errors may carry secrets.
  return error instanceof VerificationError ? error.code : 'UNEXPECTED_FAILURE_REDACTED';
}

async function saveReport(report) {
  // All runtime outputs stay in the task-specific temporary directory.
  const root = path.resolve(REPORT_ROOT);
  const file = path.resolve(root, `osca-protocol-${report.runId}.json`);
  if (!file.startsWith(`${root}${path.sep}`)) throw new VerificationError('INVALID_REPORT_PATH');
  await mkdir(root, { recursive: true });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

export async function runVerification(config) {
  if (!config.configured) throw new VerificationError('MISSING_ENVIRONMENT');
  let sdk;
  let getSignedUrl;
  try {
    sdk = await import('@aws-sdk/client-s3');
    ({ getSignedUrl } = await import('@aws-sdk/s3-request-presigner'));
  } catch {
    throw new VerificationError('AWS_SDK_DEPENDENCIES_UNAVAILABLE');
  }
  const client = new sdk.S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 1,
  });
  const runId = randomUUID();
  const key = `${config.prefix}_verification/${runId}.txt`;
  const finalKey = `${config.prefix}_verification/${randomUUID()}-final.txt`;
  const rejectedCopyKey = `${config.prefix}_verification/${randomUUID()}-rejected.txt`;
  const staleCopyKey = `${config.prefix}_verification/${randomUUID()}-stale.txt`;
  const cleanupKeys = new Set();
  // A fresh nonexistent object outside the allowed prefix, never existing data.
  const outsideKey = `studev-verification-denied-${runId}/missing.txt`;
  const body = Buffer.alloc(1024, 0x20);
  Buffer.from(`StudDev OSCA protocol verification\nRun ${runId}\nNo personal information.\n`).copy(body);
  randomBytes(16).toString('hex').split('').forEach((char, index) => { body[256 + index] = char.charCodeAt(0); });
  const expectedHash = createHash('sha256').update(body).digest('hex');
  const report = {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    bytes: body.byteLength,
    sha256: expectedHash,
    checks: [],
    browserEnforcementVerified: false,
    completed: false,
    cleanup: 'not-needed',
  };
  const sign = (Command, input = {}, options = {}) => getSignedUrl(
    client,
    new Command({ Bucket: config.bucket, Key: key, ...input }),
    { expiresIn: 60, ...options },
  );
  let writeAttempted = false;
  try {
    const putUrl = await sign(sdk.PutObjectCommand, { ContentType: MIME, ContentLength: body.byteLength, IfNoneMatch: '*' }, { signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']) });
    const signedPutHeaders = new URL(putUrl).searchParams.get('X-Amz-SignedHeaders')?.split(';') || [];
    if (!['content-length', 'content-type', 'if-none-match'].every((header) => signedPutHeaders.includes(header))) {
      throw new VerificationError('PUT_SIZE_AND_TYPE_NOT_BOUND_IN_SIGNATURE');
    }
    const options = await request(putUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: config.origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type,if-none-match',
      },
    });
    const cors = assessCors(options.headers, { origin: config.origin, method: 'PUT', requestHeaders: ['content-type', 'if-none-match'] });
    await requireStatus(options, 'object_preflight', new Set([200, 204]), report, cors);
    if (!cors.originAllowed || !cors.methodAllowed || !cors.headersAllowed) {
      throw new VerificationError('OBJECT_PREFLIGHT_HEADERS_INCOMPLETE');
    }
    writeAttempted = true;
    cleanupKeys.add(key);
    const put = await request(putUrl, { method: 'PUT', headers: { 'Content-Type': MIME, 'If-None-Match': '*', Origin: config.origin }, body });
    await requireStatus(put, 'presigned_put', new Set([200, 201, 204]), report);
    await put.body?.cancel();

    const replay = await request(putUrl, { method: 'PUT', headers: { 'Content-Type': MIME, 'If-None-Match': '*', Origin: config.origin }, body });
    // Some S3-compatible gateways silently ignore If-None-Match. Record the
    // capability honestly and verify the independent final-copy path below.
    await requireStatus(replay, 'conditional_put_replay_observed', new Set([200, 201, 204, 412, 409, 403]), report, {
      overwritePrevented: [412, 409, 403].includes(replay.status),
    });
    await replay.body?.cancel();

    // Fetch calculates Content-Length for the actual body. An extra byte must
    // invalidate the signature binding the declared size, never modify data.
    const tooLong = await request(putUrl, { method: 'PUT', headers: { 'Content-Type': MIME, 'If-None-Match': '*' }, body: Buffer.concat([body, Buffer.from('!')]) });
    await requireStatus(tooLong, 'signed_size_mismatch_denied', REJECTED, report);

    // A proxy may gzip text responses and strip HEAD Content-Length / weaken
    // ETag. Trusted metadata reads must request the identity representation.
    const head = await request(await sign(sdk.HeadObjectCommand), { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
    await requireStatus(head, 'head_object', new Set([200]), report);
    const headDiagnostics = {
      name: 'head_metadata',
      expectedBytes: body.byteLength,
      contentLength: head.headers.get('content-length'),
      contentType: head.headers.get('content-type'),
      contentEncoding: head.headers.get('content-encoding'),
      transferEncoding: head.headers.get('transfer-encoding'),
      etag: head.headers.get('etag'),
      server: head.headers.get('server'),
      date: head.headers.get('date'),
    };
    report.checks.push(headDiagnostics);
    emit(headDiagnostics);
    if (Number(head.headers.get('content-length')) !== body.byteLength) throw new VerificationError('HEAD_SIZE_MISMATCH');
    const etag = head.headers.get('etag');
    if (!etag || etag.startsWith('W/')) throw new VerificationError('HEAD_STRONG_ETAG_MISSING');

    const getUrl = await sign(sdk.GetObjectCommand);
    const get = await request(getUrl);
    await requireStatus(get, 'presigned_get', new Set([200]), report);
    const received = await readTestObject(get, body.byteLength);
    if (createHash('sha256').update(received).digest('hex') !== expectedHash) throw new VerificationError('GET_HASH_MISMATCH');
    report.checks.push({ name: 'content_integrity', status: 'passed', sha256: expectedHash });
    emit(report.checks.at(-1));

    // The application uses fetch with If-Match, not an ordinary link: both
    // the preflight and the gateway's conditional GET must work.
    const conditionalUrl = await sign(sdk.GetObjectCommand, {
      IfMatch: etag,
      ResponseContentType: 'application/octet-stream',
      ResponseContentDisposition: 'attachment; filename="studev-verification.txt"',
    }, { signableHeaders: new Set(['if-match']) });
    const getPreflight = await request(conditionalUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: config.origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'if-match',
      },
    });
    const getCors = assessCors(getPreflight.headers, { origin: config.origin, method: 'GET', requestHeaders: ['if-match'] });
    await requireStatus(getPreflight, 'conditional_get_preflight', new Set([200, 204]), report, getCors);
    if (!getCors.originAllowed || !getCors.methodAllowed || !getCors.headersAllowed) {
      throw new VerificationError('CONDITIONAL_GET_PREFLIGHT_HEADERS_INCOMPLETE');
    }
    const conditionalGet = await request(conditionalUrl, { headers: { 'If-Match': etag, Origin: config.origin } });
    await requireStatus(conditionalGet, 'conditional_get', new Set([200]), report);
    if (!/^attachment(?:;|$)/iu.test(conditionalGet.headers.get('content-disposition') || '')) {
      throw new VerificationError('DOWNLOAD_ATTACHMENT_OVERRIDE_UNSUPPORTED');
    }
    if (conditionalGet.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream') {
      throw new VerificationError('DOWNLOAD_CONTENT_TYPE_OVERRIDE_UNSUPPORTED');
    }
    const conditionalBody = await readTestObject(conditionalGet, body.byteLength);
    if (createHash('sha256').update(conditionalBody).digest('hex') !== expectedHash) throw new VerificationError('CONDITIONAL_GET_HASH_MISMATCH');
    report.checks.push({ name: 'download_headers_and_integrity', status: 'passed', sha256: expectedHash });
    emit(report.checks.at(-1));

    // This request has a valid signature for a deliberately incorrect ETag.
    // A 200 response would mean OSCA ignores If-Match and is unsafe to assume.
    const wrongEtag = '"00000000000000000000000000000000"';
    const mismatchUrl = await sign(sdk.GetObjectCommand, { IfMatch: wrongEtag }, { signableHeaders: new Set(['if-match']) });
    await requireStatus(await request(mismatchUrl, { headers: { 'If-Match': wrongEtag } }), 'if_match_mismatch_denied', new Set([412, 403]), report);

    // The final destination is generated only server-side and is never given
    // a presigned PUT. Probe CopySourceIfMatch rather than assume this gateway
    // implements it. Always compare the final copy's metadata before accepting
    // it; a new destination is used for every attempt.
    const copySource = [config.bucket, ...key.split('/')].map(encodeURIComponent).join('/');
    const copy = async (destination, sourceEtag, name, expectedSuccess) => {
      cleanupKeys.add(destination);
      let output;
      let status;
      let code;
      try {
        output = await client.send(new sdk.CopyObjectCommand({
          Bucket: config.bucket,
          Key: destination,
          CopySource: copySource,
          CopySourceIfMatch: sourceEtag,
          MetadataDirective: 'COPY',
        }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
        status = output.$metadata?.httpStatusCode;
      } catch (error) {
        // Never print SDK errors, messages, headers, requests, or URLs.
        status = error?.$metadata?.httpStatusCode;
        if (/^[A-Za-z0-9_-]{1,100}$/u.test(error?.name || '')) code = error.name;
      }
      const success = status === 200 && Boolean(output?.CopyObjectResult?.ETag);
      const denied = [412, 403].includes(status);
      const ok = expectedSuccess === null ? success || denied : expectedSuccess ? success : denied;
      const check = { name, status: ok ? 'passed' : 'failed', httpStatus: status || null };
      if (expectedSuccess === null) check.sourcePreconditionEnforced = denied;
      if (code) check.serviceCode = code;
      report.checks.push(check);
      emit(check);
      if (!ok) throw new VerificationError(`CHECK_FAILED_${name.toUpperCase()}`);
      return output;
    };
    const mismatchCopy = await copy(rejectedCopyKey, wrongEtag, 'copy_source_mismatch_capability', null);
    await requireStatus(await request(await sign(sdk.HeadObjectCommand, { Key: rejectedCopyKey }), {
      method: 'HEAD', headers: { 'Accept-Encoding': 'identity' },
    }), 'mismatched_copy_destination_observed', new Set([mismatchCopy ? 200 : 404]), report);

    const copied = await copy(finalKey, etag, 'copy_source_match', true);
    const finalHead = await request(await sign(sdk.HeadObjectCommand, { Key: finalKey }), {
      method: 'HEAD', headers: { 'Accept-Encoding': 'identity' },
    });
    await requireStatus(finalHead, 'final_head_object', new Set([200]), report);
    const finalEtag = finalHead.headers.get('etag');
    // S3-compatible CopyObject XML may return its ETag without surrounding
    // quotes; HEAD remains the authoritative strong entity validator.
    const copyResultEtag = copied.CopyObjectResult.ETag.replace(/^"|"$/gu, '');
    const finalMetadataMatches = finalEtag === etag && finalEtag.replace(/^"|"$/gu, '') === copyResultEtag &&
      !finalEtag.startsWith('W/') && Number(finalHead.headers.get('content-length')) === body.byteLength &&
      finalHead.headers.get('content-type') === head.headers.get('content-type');
    report.checks.push({ name: 'final_copy_metadata', status: finalMetadataMatches ? 'passed' : 'failed',
      strongEtagPreserved: finalEtag === etag, bytes: Number(finalHead.headers.get('content-length')),
      contentTypePreserved: finalHead.headers.get('content-type') === head.headers.get('content-type') });
    emit(report.checks.at(-1));
    if (!finalMetadataMatches) throw new VerificationError('FINAL_COPY_METADATA_MISMATCH');

    // Replay the exact original staging PUT with a different same-size body.
    // Even when a gateway accepts it, the private final object must stay intact.
    const changedBody = Buffer.from(body);
    changedBody[body.length - 1] ^= 1;
    const stagingReplay = await request(putUrl, {
      method: 'PUT', headers: { 'Content-Type': MIME, 'If-None-Match': '*', Origin: config.origin }, body: changedBody,
    });
    await requireStatus(stagingReplay, 'staging_replay_after_copy', new Set([200, 201, 204, 412, 409, 403]), report, {
      sourceOverwriteAccepted: [200, 201, 204].includes(stagingReplay.status),
    });
    await stagingReplay.body?.cancel();
    if ([200, 201, 204].includes(stagingReplay.status)) {
      const staleCopy = await copy(staleCopyKey, etag, 'stale_source_after_replay_capability', null);
      const staleHead = await request(await sign(sdk.HeadObjectCommand, { Key: staleCopyKey }), {
        method: 'HEAD', headers: { 'Accept-Encoding': 'identity' },
      });
      await requireStatus(staleHead, 'stale_copy_destination_observed', new Set([staleCopy ? 200 : 404]), report);
      if (staleCopy) {
        if (!staleHead.headers.get('etag') || staleHead.headers.get('etag') === etag) {
          throw new VerificationError('STALE_FINAL_COPY_METADATA_DID_NOT_DETECT_SOURCE_REPLACEMENT');
        }
        report.checks.push({ name: 'final_metadata_validation_rejects_replaced_source', status: 'passed' });
        emit(report.checks.at(-1));
      }
    }
    const finalGet = await request(await sign(sdk.GetObjectCommand, { Key: finalKey, IfMatch: finalEtag }), {
      headers: { 'If-Match': finalEtag, 'Accept-Encoding': 'identity' },
    });
    await requireStatus(finalGet, 'final_get_after_staging_replay', new Set([200]), report);
    const finalBytes = await readTestObject(finalGet, body.byteLength);
    if (createHash('sha256').update(finalBytes).digest('hex') !== expectedHash) {
      throw new VerificationError('FINAL_CONTENT_CHANGED_BY_STAGING_REPLAY');
    }
    report.checks.push({ name: 'final_content_immutable_after_staging_replay', status: 'passed', sha256: expectedHash });
    emit(report.checks.at(-1));

    const unsigned = new URL(getUrl);
    unsigned.search = '';
    await requireStatus(await request(unsigned), 'anonymous_get_denied', REJECTED, report);

    const expired = await sign(sdk.GetObjectCommand, {}, { expiresIn: 1, signingDate: new Date(Date.now() - 120_000) });
    await requireStatus(await request(expired), 'expired_get_denied', REJECTED, report);

    const changedPath = new URL(getUrl);
    changedPath.pathname += '-tampered';
    await requireStatus(await request(changedPath), 'changed_path_denied', REJECTED, report);

    const wrongSignature = new URL(getUrl);
    const signature = wrongSignature.searchParams.get('X-Amz-Signature');
    if (!signature) throw new VerificationError('PRESIGN_SIGNATURE_MISSING');
    wrongSignature.searchParams.set('X-Amz-Signature', `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`);
    await requireStatus(await request(wrongSignature), 'wrong_signature_denied', REJECTED, report);

    const outside = await sign(sdk.HeadObjectCommand, { Key: outsideKey });
    await requireStatus(await request(outside, { method: 'HEAD' }), 'outside_prefix_denied', REJECTED, report);
    report.completed = true;
  } catch (error) {
    report.failure = safeFailure(error);
    emit({ status: 'failed', code: report.failure });
  } finally {
    if (writeAttempted) {
      try {
        for (const [index, cleanupKey] of [...cleanupKeys].entries()) {
          const deleted = await request(await sign(sdk.DeleteObjectCommand, { Key: cleanupKey }), { method: 'DELETE' });
          await requireStatus(deleted, `delete_test_object_${index + 1}`, new Set([200, 204, 404]), report);
          await deleted.body?.cancel();
          const absent = await request(await sign(sdk.HeadObjectCommand, { Key: cleanupKey }), { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
          await requireStatus(absent, `test_object_absent_${index + 1}`, new Set([404]), report);
        }
        report.cleanup = 'verified';
      } catch (error) {
        report.cleanup = 'failed';
        report.cleanupFailure = safeFailure(error);
        // Local-only recovery information, never printed or sent elsewhere.
        report.cleanupObjectKeys = [...cleanupKeys];
        report.completed = false;
        emit({ status: 'failed', code: 'TEST_OBJECT_CLEANUP_FAILED' });
      }
    }
    client.destroy();
    report.finishedAt = new Date().toISOString();
    await saveReport(report);
  }
  emit({ status: report.completed ? 'passed' : 'failed', sha256: expectedHash, cleanup: report.cleanup, browserEnforcementVerified: false });
  return report;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.includes('--help')) {
    emit({ mode: 'help', run: 'node scripts/verify-osca-upload.mjs --run', default: 'configuration-check-only', requiredEnv: ['OSCA_ACCESS_KEY_ID', 'OSCA_SECRET_ACCESS_KEY', 'OSCA_BUCKET'], optionalEnv: ['OSCA_ENDPOINT', 'OSCA_REGION', 'OSCA_PREFIX', 'STUDEV_ORIGIN'], bytes: 1024, reportRoot: REPORT_ROOT });
    return 0;
  }
  if (args.some((argument) => argument !== '--run')) throw new VerificationError('UNKNOWN_ARGUMENT');
  const config = readConfig(env);
  if (!args.includes('--run')) {
    emit({ mode: 'configuration-check-only', configured: config.configured, missingEnv: config.missing, networkRequests: 0, filesWritten: 0, remoteWrites: 0 });
    return 0;
  }
  if (!config.configured) {
    emit({ status: 'blocked', code: 'MISSING_ENVIRONMENT', missingEnv: config.missing });
    return 2;
  }
  const report = await runVerification(config);
  return report.completed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    emit({ status: 'failed', code: safeFailure(error) });
    process.exitCode = 1;
  });
}
