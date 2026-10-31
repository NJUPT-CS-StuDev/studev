import { buildSync } from 'esbuild';

export function buildWorker(version: string): string {
    return buildSync({
        entryPoints: ['src/pwa/worker.js'], bundle: true, write: false,
        format: 'iife', target: 'es2022', define: { DATA_VERSION: JSON.stringify(version) },
    }).outputFiles[0]!.text;
}
