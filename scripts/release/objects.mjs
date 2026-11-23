import { signedFetch } from '../../src/download/object-store.mjs';

export async function listDownloadObjects(store, request = signedFetch) {
    const objects = [];
    let cursor;
    do {
        const query = new URLSearchParams({ 'list-type': '2', 'encoding-type': 'url' });
        if (cursor) query.set('continuation-token', cursor);
        const answer = await request(store, 'GET', '', { query, signal: AbortSignal.timeout(20_000) });
        if (!answer.ok) throw new Error(`could not list download objects (${answer.status})`);
        const xml = await answer.text();
        if (!xml.includes('ListBucketResult')) throw new Error('unexpected download storage inventory');
        for (const [object] of xml.matchAll(/<Contents>[\s\S]*?<\/Contents>/g)) {
            const encoded = object.match(/<Key>([^<]+)<\/Key>/)?.[1];
            const size = Number(object.match(/<Size>(\d+)<\/Size>/)?.[1]);
            const etag = object.match(/<ETag>([^<]+)<\/ETag>/)?.[1]?.replaceAll('&quot;', '"');
            if (!encoded || !Number.isSafeInteger(size) || size < 0 || !etag) throw new Error('incomplete download storage inventory');
            objects.push({ key: decodeURIComponent(encoded), size, etag });
        }
        const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]?.replaceAll('&amp;', '&');
        if ((xml.includes('<IsTruncated>true</IsTruncated>') && !next) || (next && next === cursor)) {
            throw new Error('download storage inventory has no advancing continuation token');
        }
        cursor = next;
    } while (cursor);
    return objects;
}
