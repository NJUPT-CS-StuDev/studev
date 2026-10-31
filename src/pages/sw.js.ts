import type { APIRoute } from 'astro';
import { build } from 'esbuild';
import release from '../data/campus-release.json';

export const GET: APIRoute = async () => {
    const result = await build({ entryPoints: ['src/pwa/worker.js'], bundle: true, write: false, format: 'iife', target: 'es2022', define: { DATA_VERSION: JSON.stringify(release.version) } });
    return new Response(result.outputFiles[0]!.text, {
        headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' },
    });
};
