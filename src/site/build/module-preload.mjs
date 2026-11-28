import { readdir, readFile, writeFile } from 'node:fs/promises';

/**
 * Every page names the whole static import graph of its scripts and islands up front. A browser otherwise finds a
 * module's imports only after fetching it, so a page whose island is four imports deep waits four round trips before
 * it can render; with the graph preloaded it waits one.
 */
export default function modulePreload() {
    const graph = new Map();
    return {
        name: 'studev-module-preload',
        hooks: {
            'astro:config:setup': ({ updateConfig }) => updateConfig({ vite: { plugins: [{
                name: 'studev-module-graph',
                apply: 'build',
                generateBundle(_options, bundle) {
                    for (const chunk of Object.values(bundle)) {
                        if (chunk.type === 'chunk' && chunk.fileName.startsWith('_astro/')) graph.set('/' + chunk.fileName, chunk.imports.map(path => '/' + path));
                    }
                },
            }] } }),
            'astro:build:done': async ({ dir }) => {
                for (const file of await readdir(dir, { recursive: true })) {
                    if (!file.endsWith('.html')) continue;
                    const page = new URL(file.replaceAll('\\', '/'), dir);
                    const html = await readFile(page, 'utf8');
                    const named = new Set([...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g), ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)].map(match => match[1]));
                    const entries = [...named, ...[...html.matchAll(/\b(?:component|renderer|before-hydration)-url="([^"]+)"/g)].map(match => match[1])];
                    const closure = new Set();
                    const visit = (path) => {
                        if (closure.has(path) || !graph.has(path)) return;
                        closure.add(path);
                        for (const dep of graph.get(path)) visit(dep);
                    };
                    for (const entry of entries) visit(entry);
                    const links = [...closure].filter(path => !named.has(path)).map(path => `<link rel="modulepreload" href="${path}">`).join('');
                    if (links) await writeFile(page, html.replace('</head>', links + '</head>'));
                }
            },
        },
    };
}
