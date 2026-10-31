import { AppError, fail, platformOrigin, requireOrigin, response, safeLog } from './platform-common.mjs';
import { createRepository } from './platform-store.mjs';
import { createIdentity } from './platform-identity.mjs';
import { createFormsService } from './platform-forms.mjs';
import { metadataStore, oscaGateway } from './platform-storage.mjs';
import { hasAuthorization, bearerBootstrap } from './platform-sessions.mjs';

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
      if (['POST', 'DELETE'].includes(request.method) && !hasAuthorization(request) && !bearerBootstrap(request, path)) requireOrigin(request, env);
      const store = getStore(env);
      const repo = createRepository(store, { now, secret: env.PLATFORM_SESSION_SECRET });
      const identity = createIdentity({ repo, env, now });
      // Never fall back to cookies when an Authorization header is present.
      // Validate it before exempting any endpoint from the browser boundary.
      if (hasAuthorization(request)) await identity.authenticate(request, { required: true, allowEnrollment: true });
      const identityResponse = await identity.handle(context, path);
      if (identityResponse) return identityResponse;
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
