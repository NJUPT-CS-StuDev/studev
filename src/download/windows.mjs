// The Windows releases at a stable address: /download/windows/<file> sends each request on to a short-lived signed
// link into the private download bucket. Velopack reads its feed (releases.win.json) and packages here, and the
// download page links the portable zip here, saved as StuDev-Windows.zip.
import { downloadStore, presignGet } from './object-store.mjs';

const FILE = /^[A-Za-z0-9._-]+$/;

export async function onRequest(context) {
    const { pathname } = new URL(context.request.url);
    const file = decodeURIComponent(pathname.replace(/^\/download\/windows\/?/, ''));
    if (!FILE.test(file) || file.startsWith('.')) return new Response('Not found', { status: 404 });
    const store = downloadStore(context.env || {});
    if (!store) return new Response('Downloads are not configured', { status: 503 });
    const portable = file.endsWith('-Portable.zip');
    const link = presignGet(store, `windows/${file}`, 600, portable ? { 'response-content-disposition': 'attachment; filename="StuDev-Windows.zip"' } : {});
    // The feed changes with each release; a package never does.
    return new Response(null, { status: 302, headers: { location: link, 'cache-control': file.endsWith('.json') ? 'no-store' : 'public, max-age=300' } });
}
