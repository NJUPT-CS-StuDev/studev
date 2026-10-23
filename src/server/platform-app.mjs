import { AppError, fail, platformOrigin, requireOrigin, response, safeLog } from './platform-common.mjs';
import { createRepository } from './platform-store.mjs';
import { createIdentity } from './platform-identity.mjs';
import { createFormsService } from './platform-forms.mjs';
import { metadataStore, oscaGateway } from './collection-adapters.mjs';

function storageConfig(env) {
  let endpoint;
  try { endpoint = new URL(env.OSCA_ENDPOINT); } catch { fail(503, 'NOT_CONFIGURED', '存储配置尚未完成。'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || !/^[A-Za-z0-9._-]{1,150}$/.test(env.OSCA_BUCKET || '') || !env.OSCA_ACCESS_KEY_ID || !env.OSCA_SECRET_ACCESS_KEY) fail(503, 'NOT_CONFIGURED', '存储配置无效。');
  const prefix = env.OSCA_PREFIX || 'studev-submissions/';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(prefix)) fail(503, 'NOT_CONFIGURED', '存储目录配置无效。');
  return { endpoint: endpoint.origin, bucket: env.OSCA_BUCKET, accessKeyId: env.OSCA_ACCESS_KEY_ID, secretAccessKey: env.OSCA_SECRET_ACCESS_KEY, region: env.OSCA_REGION || 'us-east-1', objectPrefix: prefix };
}

export function createPlatformHandler({ getStore = metadataStore, getGateway = oscaGateway, now = Date.now } = {}) {
  return async function handle(context) {
    try {
      const env = context.env || {};
      if (String(env.PLATFORM_ENABLED) !== 'true') fail(503, 'NOT_OPEN', '平台尚未开放，请稍后再试。');
      platformOrigin(env);
      const request = context.request;
      const path = new URL(request.url).pathname.replace(/\/+$/, '');
      if (!path.startsWith('/api/platform/')) fail(404, 'NOT_FOUND', '接口不存在。');
      if (!['GET', 'POST', 'DELETE'].includes(request.method)) fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。');
      if (['POST', 'DELETE'].includes(request.method)) requireOrigin(request, env);
      const store = getStore(env);
      const repo = createRepository(store, { now, secret: env.PLATFORM_SESSION_SECRET });
      const identity = createIdentity({ repo, env, now });
      const identityResponse = await identity.handle(context, path);
      if (identityResponse) return identityResponse;
      if (path.startsWith('/api/platform/admin/legacy/')) {
        await identity.authenticate(request, { required: true, staff: true, csrf: request.method === 'POST' });
        const collectionId = env.COLLECTION_ID || 'club-2026';
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(collectionId)) fail(503, 'NOT_CONFIGURED', '历史收件配置无效。');
        const prefix = `collections/${collectionId}/`;
        if (path === '/api/platform/admin/legacy/submissions' && request.method === 'GET') {
          const { blobs } = await store.list({ prefix: `${prefix}entries/`, consistency: 'strong' });
          const keys = blobs.map((b) => b.key).sort().slice(0, 1000);
          const items = await Promise.all(keys.map(async (key) => {
            const record = await store.get(key, { type: 'json', consistency: 'strong' });
            if (!record) return null;
            const completed = await store.get(`${prefix}completed/${record.id}.json`, { type: 'json', consistency: 'strong' });
            return { id: record.id, name: record.name, contact: record.contact, description: record.description, fileName: record.fileName, fileSize: record.fileSize, createdAt: record.createdAt, completed: Boolean(completed) };
          }));
          return response({ items: items.filter(Boolean), collectionId });
        }
        const match = path.match(/^\/api\/platform\/admin\/legacy\/submissions\/(\d{13}-[a-f0-9-]{36})\/download$/);
        if (match && request.method === 'POST') {
          const record = await store.get(`${prefix}entries/${match[1]}.json`, { type: 'json', consistency: 'strong' });
          const completed = await store.get(`${prefix}completed/${match[1]}.json`, { type: 'json', consistency: 'strong' });
          if (!record || !completed) fail(404, 'NOT_FOUND', '历史材料不存在或尚未完成。');
          const config = storageConfig(env);
          const finalPrefix = `${config.objectPrefix}${collectionId}/final/${record.id}/`;
          if (typeof completed.finalObjectKey !== 'string' || !completed.finalObjectKey.startsWith(finalPrefix)) fail(409, 'OBJECT_CHANGED', '历史附件需维护人员核查。');
          const gateway = getGateway(config);
          const head = await gateway.head(completed.finalObjectKey);
          if (!head || head.etag !== completed.etag || head.size !== completed.size || head.contentType !== completed.contentType) fail(409, 'OBJECT_CHANGED', '历史附件状态已变化，请联系维护人员。');
          return response({ download: await gateway.presignDownload({ ...record, finalObjectKey: completed.finalObjectKey }, completed.etag, 60) });
        }
      }
      const forms = createFormsService({ repo, identity, env, now, getGateway });
      const formsResponse = await forms.handle(context, path);
      if (formsResponse) return formsResponse;
      fail(404, 'NOT_FOUND', '接口不存在。');
    } catch (error) {
      if (error instanceof AppError) return response({ error: { code: error.code, message: error.message } }, error.status);
      safeLog(error);
      return response({ error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试。' } }, 503);
    }
  };
}
