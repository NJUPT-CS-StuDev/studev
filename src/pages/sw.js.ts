import type { APIRoute } from 'astro';
import { buildWorker } from '../pwa/build-worker';
import product from '../../product.json';

export const GET: APIRoute = async () => {
    return new Response(buildWorker(product.android.versionName), {
        headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' },
    });
};
