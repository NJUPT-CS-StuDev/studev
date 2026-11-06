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
