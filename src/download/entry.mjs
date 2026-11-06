// /api/apk: the current Android package, straight from object storage.
import product from '../../product.json' with { type: 'json' };
import { downloadStore, presignGet } from './object-store.mjs';

export async function onRequest({ env }) {
    const store = downloadStore(env);
    if (!store) return new Response('download is not configured', { status: 503 });
    const name = `studev-${product.android.versionName}.apk`;
    const location = presignGet(store, name, 3600, { 'response-content-disposition': `attachment; filename="${name}"` });
    return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}
