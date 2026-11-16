// Knowledge media (slides and paper scans) at /data/<version>/knowledge/<path>: static Markdown and
// indexes live in dist/ and take priority over Cloud Functions; offloaded binary media lands here
// and redirects to a short-lived signed link in the download object store.
import { downloadStore, presignGet } from './object-store.mjs';

const KNOWLEDGE_VER = /__k([A-Za-z0-9._-]+?)(?:__|$)/;
const MEDIA = /\.(?:webp|png|jpe?g|gif|bmp|avif|svg|pdf)$/i;

export async function onRequest(context) {
    const { pathname } = new URL(context.request.url);
    const match = /^\/data\/([A-Za-z0-9._-]+)\/knowledge\/(.+)$/.exec(pathname);
    if (!match) return new Response('Not found', { status: 404 });
    const [, releaseVersion, rawPath] = match;
    const verMatch = KNOWLEDGE_VER.exec(releaseVersion);
    if (!verMatch) return new Response('Not found', { status: 404 });
    const parts = rawPath.split('/').map(segment => {
        try { return decodeURIComponent(segment); } catch { return ''; }
    });
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || part.includes('/') || part.includes('\\'))) {
        return new Response('Not found', { status: 404 });
    }
    const relPath = parts.join('/');
    if (!MEDIA.test(relPath) || !/^(?:materials|topics|courses)\//.test(relPath)) return new Response('Not found', { status: 404 });
    const store = downloadStore(context.env || {});
    if (!store) return new Response('Knowledge media storage is not configured', { status: 503 });
    const link = presignGet(store, `knowledge/${verMatch[1]}/${relPath}`, 600);
    return new Response(null, { status: 302, headers: { location: link, 'cache-control': 'public, max-age=300' } });
}
