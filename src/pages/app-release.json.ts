import type { APIRoute } from 'astro';
import product from '../../product.json';

export const GET: APIRoute = () => new Response(JSON.stringify({ android: product.android, campus_entry: `${product.campusOrigin}/campus-release.json` }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
});
