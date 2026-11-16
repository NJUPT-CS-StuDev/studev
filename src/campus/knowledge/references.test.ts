import { readFile } from 'node:fs/promises';
import { initialize, read } from 'docstream';
import { beforeAll, expect, it } from 'vitest';
import { referencePreviews } from './references';
import type { Knowledge } from '@/world/knowledge';

beforeAll(async () => {
    await initialize(new Uint8Array(await readFile(new URL('../../../node_modules/docstream/wasm/docstream_wasm_bg.wasm', import.meta.url))));
});

it('identifies every military-theory passage by its real anchor and distinguishes repeated numbers with its text', async () => {
    const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
    const knowledge: Knowledge = JSON.parse(await readFile(`public${release.base}/knowledge/knowledge.json`, 'utf8'));
    const material = knowledge.materials.find(item => item.title === '《军事理论》复习填空题集（含答案）')!;
    const source = await readFile(`public${release.base}/knowledge/${material.path}`, 'utf8');
    const previews = referencePreviews(read(source).map(block => ({ block })));
    const refs = knowledge.topics.find(topic => topic.id === '军事理论/现代国防观')!.references.filter(ref => ref.material === material.path);
    expect(refs.length).toBeGreaterThan(3);
    expect(new Set(refs.map(ref => ref.anchor)).size).toBe(refs.length);
    for (const ref of refs) {
        const preview = previews.get(ref.anchor)!;
        expect(preview, ref.anchor).toBeTruthy();
        expect(preview.title).toBe(ref.heading);
        expect(preview.excerpt).not.toMatch(/^(?:答案|参考解答)[：:]/);
    }
    const repeated = [...previews.values()].filter(preview => /^简答\s*12$/.test(preview.title));
    expect(repeated.length).toBeGreaterThan(1);
    expect(new Set(repeated.map(preview => preview.excerpt)).size).toBeGreaterThan(1);
});
