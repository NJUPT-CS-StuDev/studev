import type { APIRoute } from 'astro';
import { buildDownloadWorker } from '../../pwa/build-worker';

/** Served from inside /download/ so its default scope is /download/ and it needs
 * no Service-Worker-Allowed header. Kept out of the PWA worker so that worker's
 * install-time precache can never delay the download page again. */
export const GET: APIRoute = async () => new Response(buildDownloadWorker(), {
    headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' },
});
