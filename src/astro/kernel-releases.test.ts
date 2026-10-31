import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('clean builders resolve both kernels from immutable public release URLs', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
    for (const [name, version] of [['wayfind', '0.1.0'], ['wasm-search', '1.0.3']]) {
        const url = `https://github.com/hicancan/${name}/releases/download/v${version}/${name}-${version}.tgz`;
        expect(pkg.dependencies[name!]).toBe(url);
        expect(lock.packages[''].dependencies[name!]).toBe(url);
        expect(lock.packages[`node_modules/${name}`].resolved).toBe(url);
    }
    expect(pkg.scripts.predigest).toContain('design/map/generate.mjs');
    expect(pkg.scripts.build).toContain('npm run digest');
});
