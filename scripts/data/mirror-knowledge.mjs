// Mirrors heavy knowledge media (slide images, paper scans) to OSCA / S3 object storage so static web
// hosting stays light and well under file-count limits. Idempotent per knowledge version via a marker object.
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { downloadStore, signedFetch } from '../../src/download/object-store.mjs';

const MEDIA_TYPES = {
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
};

export const isKnowledgeMedia = (relPath) => Object.hasOwn(MEDIA_TYPES, extname(relPath).toLowerCase());

async function collectMedia(root, rel = '') {
    const entries = await readdir(join(root, rel), { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
        const next = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...await collectMedia(root, next));
        else if (isKnowledgeMedia(next)) out.push(next);
    }
    return out;
}

async function putWithRetry(store, key, body, contentType) {
    let last;
    for (let attempt = 1; attempt <= 6; attempt++) {
        try {
            const response = await signedFetch(store, 'PUT', key, {
                body,
                headers: { 'content-type': contentType },
                signal: AbortSignal.timeout(30_000),
            });
            if (response.ok) return;
            const detail = await response.text().catch(() => '');
            last = new Error(`HTTP ${response.status} for ${key}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
        } catch (error) {
            last = error;
        }
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
    throw last;
}

export async function mirrorKnowledge(knowledgeDir, knowledgeVersion, env = process.env) {
    const store = downloadStore(env);
    if (!store || !knowledgeVersion) return { offloaded: false, uploaded: 0, total: 0 };

    const completeKey = `knowledge/${knowledgeVersion}/.complete`;
    try {
        const probe = await signedFetch(store, 'HEAD', completeKey);
        if (probe.ok) {
            const files = await collectMedia(knowledgeDir);
            console.log(`knowledge media already mirrored (${knowledgeVersion}, ${files.length} files)`);
            return { offloaded: true, uploaded: 0, total: files.length };
        }
    } catch {
        // Proceed to upload when the completion marker cannot be read.
    }

    const files = await collectMedia(knowledgeDir);
    if (!files.length) return { offloaded: false, uploaded: 0, total: 0 };

    console.log(`mirroring ${files.length} knowledge media files for ${knowledgeVersion}...`);
    const workers = Math.min(32, files.length);
    let cursor = 0;
    let uploaded = 0;
    let bytes = 0;

    await Promise.all(Array.from({ length: workers }, async () => {
        while (cursor < files.length) {
            const rel = files[cursor++];
            const full = join(knowledgeDir, rel);
            const data = await readFile(full);
            const type = MEDIA_TYPES[extname(rel).toLowerCase()] ?? 'application/octet-stream';
            await putWithRetry(store, `knowledge/${knowledgeVersion}/${rel}`, data, type);
            uploaded++;
            bytes += data.byteLength;
            if (uploaded % 500 === 0 || uploaded === files.length) {
                console.log(`mirrored knowledge media ${uploaded}/${files.length} (${(bytes / 1048576).toFixed(1)} MB)`);
            }
        }
    }));

    const marker = JSON.stringify({ knowledgeVersion, files: uploaded, bytes, completedAt: new Date().toISOString() });
    await putWithRetry(store, completeKey, marker, 'application/json');
    return { offloaded: true, uploaded, total: files.length };
}
