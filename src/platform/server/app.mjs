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
    const started = performance.now();
    const timings = new Map();
    const measure = async (name, run) => {
      const start = performance.now();
      try { return await run(); }
      finally { timings.set(name, Math.max(timings.get(name) || 0, performance.now() - start)); }
    };
    function timed(result) {
      timings.set('platform', performance.now() - started);
      result.headers.set('Server-Timing', [...timings].map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(', '));
      return result;
    }
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
      const identity = createIdentity({ repo, env, now, academicYear });
      // Never fall back to cookies when an Authorization header is present.
      // Validate it before exempting any endpoint from the browser boundary.
      if (hasAuthorization(request)) await measure('auth', () => identity.authenticate(request, { required: true, allowEnrollment: true }));
      const identityResponse = await measure('identity', () => identity.handle(context, path));
      if (identityResponse) return timed(identityResponse);
      if (path === '/api/platform/ai') {
        timings.delete('identity');
        return timed(await createAiService({ identity, repo, env, now, measure })(context, path));
      }
      const syncResponse = await createSyncService({ identity, repo })(context, path);
      if (syncResponse) return timed(syncResponse);
      timings.delete('identity');
      const collections = createCollectionsService({ repo, identity, env, now, getGateway, measure });
      const collectionsResponse = await measure('collection', () => collections.handle(context, path));
      if (collectionsResponse) return timed(collectionsResponse);
      fail(404, 'NOT_FOUND', '接口不存在。');
    } catch (error) {
      if (error instanceof AppError) return timed(response({ error: { code: error.code, message: error.message } }, error.status));
      safeLog(error);
      return timed(response({ error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试。' } }, 503));
    }
  };
}
