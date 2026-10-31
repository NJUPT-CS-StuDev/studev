import type { APIRoute } from 'astro';
import { buildWorker } from '../pwa/build-worker';
import release from '../data/campus-release.json';

export const GET: APIRoute = async () => {
    return new Response(buildWorker(release.version), {
        headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' },
    });
};
