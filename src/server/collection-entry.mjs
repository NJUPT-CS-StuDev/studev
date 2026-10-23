import { createCollectionHandler } from './collection-app.mjs';
import { metadataStore, oscaGateway } from './collection-adapters.mjs';

const handle = createCollectionHandler({ getStore: metadataStore, getGateway: oscaGateway });
export async function onRequest(context) {
  if (String(context.env?.PLATFORM_ENABLED) === 'true') {
    return new Response(JSON.stringify({ error: { code: 'LEGACY_RETIRED', message: '收件已升级，请从全部表单或统一管理台进入。' } }), {
      status: 410, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  return handle(context);
}
