import { getStore } from '@edgeone/pages-blob';
import { digest, hex, hmac } from './crypto.mjs';

export function metadataStore() {
  return getStore({ name: 'studev-collections', consistency: 'strong' });
}

// S3 Signature Version 4 over fetch: query-signed URLs the browser uses directly, and header-signed requests the
// platform makes itself. OSCA is addressed path-style (/bucket/key).
const UNSIGNED = 'UNSIGNED-PAYLOAD';
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
const stamp = (time) => new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function oscaGateway(config, now = Date.now) {
  const origin = new URL(config.endpoint);
  const objectUrl = (key) => new URL(`/${encode(config.bucket)}/${key.split('/').map(encode).join('/')}`, origin);
  function signature(method, url, headers, signedHeaders, datetime, payload) {
    const date = datetime.slice(0, 8), scope = `${date}/${config.region}/s3/aws4_request`;
    const query = [...url.searchParams].map(([k, v]) => [encode(k), encode(v)]).sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)
      .map(([k, v]) => `${k}=${v}`).join('&');
    const canonical = [method, url.pathname, query, signedHeaders.map((name) => `${name}:${String(headers[name]).trim()}\n`).join(''), signedHeaders.join(';'), payload].join('\n');
    const key = ['s3', 'aws4_request'].reduce((k, part) => hmac(k, part), hmac(hmac('AWS4' + config.secretAccessKey, date), config.region));
    return { scope, value: hex(hmac(key, ['AWS4-HMAC-SHA256', datetime, scope, digest(canonical)].join('\n'))) };
  }
  function presign(method, key, expiresIn, headers = {}, query = {}) {
    const url = objectUrl(key), datetime = stamp(now());
    const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), host: url.host };
    const signedHeaders = Object.keys(all).sort();
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    url.searchParams.set('X-Amz-Content-Sha256', UNSIGNED);
    url.searchParams.set('X-Amz-Credential', `${config.accessKeyId}/${datetime.slice(0, 8)}/${config.region}/s3/aws4_request`);
    url.searchParams.set('X-Amz-Date', datetime);
    url.searchParams.set('X-Amz-Expires', String(expiresIn));
    url.searchParams.set('X-Amz-SignedHeaders', signedHeaders.join(';'));
    url.searchParams.set('X-Amz-Signature', signature(method, url, all, signedHeaders, datetime, UNSIGNED).value);
    return url.href;
  }
  async function send(method, key, headers = {}, signal) {
    const url = objectUrl(key), datetime = stamp(now());
    const all = { ...headers, host: url.host, 'x-amz-content-sha256': UNSIGNED, 'x-amz-date': datetime };
    const signedHeaders = Object.keys(all).sort();
    const { scope, value } = signature(method, url, all, signedHeaders, datetime, UNSIGNED);
    const { host, ...sent } = all;
    const response = await fetch(url, { method, signal, headers: {
      ...sent, 'accept-encoding': 'identity',
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${value}`,
    } });
    if (method === 'HEAD' && response.status === 404) return null;
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error(`Object storage answered ${response.status}`), { name: 'ObjectStorageError', status: response.status });
    }
    return response;
  }
  return {
    async presignUpload(record, expiresIn) {
      return {
        url: presign('PUT', record.objectKey, expiresIn, { 'Content-Type': record.contentType, 'Content-Length': record.fileSize }, { 'x-id': 'PutObject' }),
        method: 'PUT', headers: { 'Content-Type': record.contentType },
        expiresAt: now() + expiresIn * 1000,
      };
    },
    // OSCA's public gateway otherwise may describe a gzip representation with a weak ETag; send() asks for identity.
    async head(objectKey) {
      const response = await send('HEAD', objectKey);
      return response && { size: Number(response.headers.get('content-length')), etag: response.headers.get('etag'), contentType: response.headers.get('content-type') };
    },
    async copy(sourceObjectKey, finalObjectKey, etag) {
      const source = `${config.bucket}/${sourceObjectKey}`.split('/').map(encodeURIComponent).join('/');
      await send('PUT', finalObjectKey, { 'x-amz-copy-source': source, 'x-amz-copy-source-if-match': etag, 'x-amz-metadata-directive': 'COPY' });
    },
    async delete(objectKey, abortSignal) {
      await send('DELETE', objectKey, {}, abortSignal);
    },
    async presignDownload(record, etag, expiresIn) {
      const fallbackName = record.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
      const contentDisposition = `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(record.fileName).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`;
      return {
        url: presign('GET', record.finalObjectKey, expiresIn, { 'If-Match': etag }, { 'response-content-disposition': contentDisposition, 'response-content-type': 'application/octet-stream', 'x-id': 'GetObject' }),
        method: 'GET', headers: { 'If-Match': etag }, fileName: record.fileName,
        expiresAt: now() + expiresIn * 1000,
      };
    },
  };
}
