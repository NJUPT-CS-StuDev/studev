import { readFileSync } from 'node:fs';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';

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

/** Start the search worker and its WebAssembly download while the visit resolves its campus snapshot. The island's
 * modules are preloaded with every page's (./module-preload.mjs). */
export default function searchPreload() {
    let warm;
    return {
        name: 'studev-search-preload',
        hooks: {
            'astro:config:setup': ({ updateConfig }) => updateConfig({ vite: { plugins: [{
                name: 'studev-search-module-graph',
                apply: 'build',
                generateBundle(_options, bundle) {
                    for (const chunk of Object.values(bundle)) {
                        if (chunk.type === 'chunk' && chunk.fileName.startsWith('_astro/') &&
                            chunk.facadeModuleId?.replaceAll('\\', '/').includes('/src/pages/search/index.astro?astro&type=script&')) warm = '/' + chunk.fileName;
                    }
                },
            }] } }),
            'astro:build:done': async ({ dir }) => {
                const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
                const { inputs } = searchBootstrap(release, 'https://build.invalid', true);
                await Promise.all(inputs.map(({ source, asset }) => copyFile(source, new URL(asset.slice(1), dir))));
                const page = new URL('search/index.html', dir);
                const html = await readFile(page, 'utf8');
                if (!warm) throw new Error('The search page has no warm-up module');
                const wasm = (await readdir(new URL('_astro/', dir))).find(name => /^wasm_search_wasm_bg-.+\.wasm$/.test(name));
                if (!wasm) throw new Error('The search worker has no WebAssembly to preload');
                const script = `<script type="module" src="${warm}"></script>`;
                const seed = html.match(/<script[^>]*data-search-base=[^>]*>[\s\S]*?<\/script>/)?.[0];
                const entry = html.match(/<link[^>]*\bdata-campus-entry\b[^>]*>/)?.[0];
                if (!seed || !html.includes(script)) throw new Error('The search page has no worker seed');
                if (!entry) throw new Error('The search page has no campus entry preload');
                const kernel = `<script data-search-wasm="/_astro/${wasm}">(${preloadKernel})()</script>`;
                const early = `${entry}${kernel}${seed}<script type="module" async src="${warm}"></script>`;
                await writeFile(page, html.replace(script, '').replace(seed, '').replace(entry, '').replace(/<meta charset="UTF-8">/i, tag => tag + early));
            },
        },
    };
}

function preloadKernel() {
    const url = document.currentScript.dataset.searchWasm;
    if (navigator.connection?.saveData) return;
    try { if (localStorage.getItem('studev-search-kernel') === url) return; } catch { /* The cold path still works without storage. */ }
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'fetch';
    link.type = 'application/wasm';
    link.crossOrigin = 'anonymous';
    link.href = url;
    document.head.append(link);
}
