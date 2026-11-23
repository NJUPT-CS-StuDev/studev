import { AppError, fail, platformOrigin, requireOrigin, response, safeLog } from './common.mjs';
import { createRepository } from './store.mjs';
import { createIdentity } from './identity.mjs';
import { createCollectionsService } from './collections/index.mjs';
import { metadataStore, oscaGateway } from './storage.mjs';
import { hasAuthorization, bearerBootstrap } from './sessions.mjs';
import { createAiService } from './ai.mjs';
import { createSyncService } from './sync.mjs';

export function createPlatformHandler({ getStore = metadataStore, getGateway = oscaGateway, now = Date.now, academicYear } = {}) {
  const revisions = new Map();
  return async function handle(context) {
    try {
      const env = context.env || {};
      if (String(env.PLATFORM_ENABLED) !== 'true') fail(503, 'NOT_OPEN', '平台尚未开放，请稍后再试。');
      platformOrigin(env);
      const request = context.request;
      const path = new URL(request.url).pathname.replace(/\/+$/, '');
      if (!path.startsWith('/api/platform/')) fail(404, 'NOT_FOUND', '接口不存在。');
      if (!['GET', 'POST', 'DELETE'].includes(request.method)) fail(405, 'METHOD_NOT_ALLOWED', '不支持此请求方式。');
      if (['POST', 'DELETE'].includes(request.method) && !hasAuthorization(request) && !bearerBootstrap(request, path)) requireOrigin(request, env);
      const store = getStore(env);
      const repo = createRepository(store, { now, secret: env.PLATFORM_SESSION_SECRET, revisions });
      if (request.method !== 'GET' && (path === '/api/platform/collections' || path.startsWith('/api/platform/collections/')) &&
          (await repo.get('cutover/collection-submissions.json'))?.paused === true) {
        fail(503, 'COLLECTIONS_UPDATING', '收集正在更新，请稍后再试。');
      }
      const identity = createIdentity({ repo, env, now, academicYear });
      // Never fall back to cookies when an Authorization header is present.
      // Validate it before exempting any endpoint from the browser boundary.
      if (hasAuthorization(request)) await identity.authenticate(request, { required: true, allowEnrollment: true });
      const identityResponse = await identity.handle(context, path);
      if (identityResponse) return identityResponse;
      const aiResponse = await createAiService({ identity, repo, env, now })(context, path);
      if (aiResponse) return aiResponse;
      const syncResponse = await createSyncService({ identity, repo })(context, path);
      if (syncResponse) return syncResponse;
      const collections = createCollectionsService({ repo, identity, env, now, getGateway });
      const collectionsResponse = await collections.handle(context, path);
      if (collectionsResponse) return collectionsResponse;
      fail(404, 'NOT_FOUND', '接口不存在。');
    } catch (error) {
      if (error instanceof AppError) return response({ error: { code: error.code, message: error.message } }, error.status);
      safeLog(error);
      return response({ error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试。' } }, 503);
    }
  };
}
