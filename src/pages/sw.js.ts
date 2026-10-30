import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import release from '../data/campus-release.json';

export const GET: APIRoute = async () => new Response(
    `const DATA_VERSION = ${JSON.stringify(release.version)};\n` + await readFile('src/pwa/worker.js', 'utf8'),
    { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' } },
);
