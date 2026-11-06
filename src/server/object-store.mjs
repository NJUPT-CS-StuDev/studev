// Path-style S3 requests signed with SigV4, for the download bucket. No SDK: one signature
// shape covers a signed call and a link that stays valid for a while.
import { createHash, createHmac } from 'node:crypto';

const hmac = (key, text) => createHmac('sha256', key).update(text).digest();
const sha256 = data => createHash('sha256').update(data).digest('hex');
const REGION = 'us-east-1';
const encodePath = key => key.split('/').map(encodeURIComponent).join('/');
const signingKey = (secret, day) => ['s3', 'aws4_request'].reduce(hmac, hmac(hmac(`AWS4${secret}`, day), REGION));
const clock = () => { const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, ''); return { stamp, day: stamp.slice(0, 8), scope: `${stamp.slice(0, 8)}/${REGION}/s3/aws4_request` }; };

/** The bucket named by a process's environment, or null where it is not configured. */
export function downloadStore(env = process.env) {
    if (!env.OSCA_DOWNLOAD_ENDPOINT || !env.OSCA_DOWNLOAD_BUCKET || !env.OSCA_DOWNLOAD_ACCESS_KEY || !env.OSCA_DOWNLOAD_SECRET_KEY) return null;
    return { endpoint: env.OSCA_DOWNLOAD_ENDPOINT, bucket: env.OSCA_DOWNLOAD_BUCKET, accessKey: env.OSCA_DOWNLOAD_ACCESS_KEY, secretKey: env.OSCA_DOWNLOAD_SECRET_KEY };
}

export async function signedFetch(store, method, key, { body = '', headers = {}, query = '' } = {}) {
    const url = new URL(`/${store.bucket}/${encodePath(key)}`, store.endpoint);
    url.search = query;
    const { stamp, day, scope } = clock();
    const payload = sha256(body);
    const all = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': stamp, ...headers };
    const names = Object.keys(all).sort();
    const params = new URLSearchParams(url.search);
    params.sort();
    const canonical = [method, url.pathname, params.toString(), names.map(name => `${name}:${all[name]}\n`).join(''), names.join(';'), payload].join('\n');
    const signature = createHmac('sha256', signingKey(store.secretKey, day)).update(['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n')).digest('hex');
    const { host: _host, ...sent } = all;
    return fetch(url, { method, body: method === 'GET' || method === 'HEAD' ? undefined : body, headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${store.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` } });
}

/** A plain GET link to one object, good for `seconds` (at most seven days). */
export function presignGet(store, key, seconds, extra = {}) {
    const url = new URL(`/${store.bucket}/${encodePath(key)}`, store.endpoint);
    const { stamp, day, scope } = clock();
    const params = new URLSearchParams({ 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${store.accessKey}/${scope}`, 'X-Amz-Date': stamp, 'X-Amz-Expires': String(seconds), 'X-Amz-SignedHeaders': 'host', ...extra });
    params.sort();
    const canonicalQuery = params.toString().replaceAll('+', '%20');
    const canonical = ['GET', url.pathname, canonicalQuery, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const signature = createHmac('sha256', signingKey(store.secretKey, day)).update(['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n')).digest('hex');
    return `${url.href}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
