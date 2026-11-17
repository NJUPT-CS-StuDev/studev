import { buildSync } from 'esbuild';
import product from '../../product.json';

function build(entry: string, define: Record<string, string>): string {
    return buildSync({
        entryPoints: [entry], bundle: true, write: false,
        format: 'iife', target: 'es2022', define,
    }).outputFiles[0]!.text;
}

export function buildWorker(version: string, origin = product.campusOrigin): string {
    return build('src/pwa/worker.js', { APP_VERSION: JSON.stringify(version), APP_ORIGIN: JSON.stringify(product.origin), DATA_ORIGIN: JSON.stringify(origin), PUBLIC_ORIGINS: JSON.stringify([origin]) });
}
