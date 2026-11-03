import { buildSync } from 'esbuild';

function build(entry: string, define: Record<string, string>): string {
    return buildSync({
        entryPoints: [entry], bundle: true, write: false,
        format: 'iife', target: 'es2022', define,
    }).outputFiles[0]!.text;
}

export function buildWorker(version: string): string {
    return build('src/pwa/worker.js', { DATA_VERSION: JSON.stringify(version) });
}

/** Same bundling, different entry and no injected version: the download worker
 * carries no offline payload, so it needs nothing defined. */
export function buildDownloadWorker(): string {
    return build('src/download/worker.js', {});
}
