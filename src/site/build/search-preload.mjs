import { readFileSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';

export function searchBootstrap(release, origin, bundled) {
    const base = new URL(release.search_base + '/', origin);
    const manifest = JSON.parse(readFileSync(`public${base.pathname}manifest.json`, 'utf8'));
    const mirrors = [...(manifest.mirrors ?? [])];
    const inputs = [manifest.index, ...(manifest.segments ?? [])].map(({ pack }) => {
        const url = new URL(manifest.packs[pack], base);
        const asset = bundled ? '/_astro/search-' + url.pathname.split('/').slice(-2).join('-') : url.href;
        if (bundled) mirrors[pack] = asset;
        return { source: 'public' + url.pathname, asset };
    });
    if (bundled) manifest.mirrors = mirrors;
    return { base: base.href.slice(0, -1), manifest, inputs };
}

/** Fetch the search island's module graph in parallel. The worker owns fetching
 * its WebAssembly and index files. Document preload responses are scoped to the document. */
export default function searchPreload() {
    const modules = new Map();
    let warm;
    return {
        name: 'studev-search-preload',
        hooks: {
            'astro:config:setup': ({ updateConfig }) => updateConfig({ vite: { plugins: [{
                name: 'studev-search-module-graph',
                apply: 'build',
                generateBundle(_options, bundle) {
                    for (const chunk of Object.values(bundle)) {
                        if (chunk.type === 'chunk' && chunk.fileName.startsWith('_astro/')) {
                            const path = '/' + chunk.fileName;
                            modules.set(path, chunk.imports.map(path => '/' + path));
                            if (chunk.facadeModuleId?.replaceAll('\\', '/').includes('/src/pages/search/index.astro?astro&type=script&')) warm = path;
                        }
                    }
                },
            }] } }),
            'astro:build:done': async ({ dir }) => {
                const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
                const { inputs } = searchBootstrap(release, 'https://build.invalid', true);
                await Promise.all(inputs.map(({ source, asset }) => copyFile(source, new URL(asset.slice(1), dir))));
                const page = new URL('search/index.html', dir);
                const html = await readFile(page, 'utf8');
                const island = html.match(/<astro-island[^>]*component-url="(\/_astro\/SearchApp\.[^"]+)"[^>]*renderer-url="([^"]+)"/);
                if (!island) throw new Error('The search page has no search island to preload');
                if (!warm) throw new Error('The search page has no warm-up module');
                const preload = new Set([warm, ...island.slice(1)]);
                for (const path of preload) {
                    const imports = modules.get(path);
                    if (!imports) throw new Error(`Missing search module graph for ${path}`);
                    for (const dep of imports) if (modules.has(dep)) preload.add(dep);
                }
                const links = [...preload].map(path => `<link rel="modulepreload" href="${path}">`).join('');
                const script = `<script type="module" src="${warm}"></script>`;
                const seed = html.match(/<script[^>]*data-search-base=[^>]*>[\s\S]*?<\/script>/)?.[0];
                if (!seed || !html.includes(script)) throw new Error('The search page has no worker seed');
                const early = `${links}${seed}<script type="module" async src="${warm}"></script>`;
                await writeFile(page, html.replace(script, '').replace(seed, '').replace(/<meta charset="UTF-8">/i, tag => tag + early));
            },
        },
    };
}
