import type { APIRoute } from 'astro';
import { offlineRelease } from '../pwa/release';

export const GET: APIRoute = async () => new Response(JSON.stringify(await offlineRelease()), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
});
