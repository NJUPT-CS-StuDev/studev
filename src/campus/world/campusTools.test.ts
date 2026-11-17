import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import initialize from '../../../node_modules/wasm-search/wasm/wasm_search_wasm.js';
import { SearchRuntime } from '../../../node_modules/wasm-search/dist/runtime.js';
import { ArtifactSource } from '../../../node_modules/wasm-search/dist/artifacts.js';
import { CacheStore } from '../../../node_modules/wasm-search/dist/cache.js';
import release from '../../data/campus-release.json';
import channels from './channels.json';
import { CampusTools } from './campusTools';
import { courseSaid } from './answers';
import { textKey } from './texts';
import type { Knowledge } from './knowledge';
import { initialize as initializeRouting } from 'wayfind';

const base = join('public', release.base);
let engine: SearchRuntime;
let index: Knowledge;
beforeAll(async () => {
    await initialize({ module_or_path: await readFile('node_modules/wasm-search/wasm/wasm_search_wasm_bg.wasm') });
    await initializeRouting(await readFile('node_modules/wayfind/wasm/wayfind_wasm_bg.wasm'));
    vi.stubGlobal('location', { origin: 'https://studev.test' });
    index = JSON.parse(await readFile(join(base, 'knowledge/knowledge.json'), 'utf8')) as Knowledge;
    // Only transport is local: the production WASM, range-reader, search runtime and published bundle are real.
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
        const relative = decodeURIComponent(new URL(url, 'https://studev.test').pathname);
        const path = join('public', relative);
        const range = new Headers(options?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/);
        if (!range) return new Response(await readFile(path));
        const file = await open(path);
        try {
            const start = Number(range[1]), count = Number(range[2]) - start + 1;
            const buffer = Buffer.alloc(count);
            const { bytesRead } = await file.read(buffer, 0, count, start);
            return new Response(buffer.subarray(0, bytesRead), { status: 206 });
        } finally { await file.close(); }
    });
    engine = new SearchRuntime(new ArtifactSource(`https://studev.test${release.base}/search`, new CacheStore(64 * 1024 * 1024)), 128 * 1024 * 1024);
    await engine.initialize();
});
afterAll(() => { engine?.dispose(); vi.unstubAllGlobals(); });

it('uses released building access for real room routes and retains the requested room destinations', async () => {
    const tools = new CampusTools();
    try {
        const inside = await tools.route({ from: '仙林/教1-102', to: '仙林/教1-101' });
        expect(inside).toMatchObject({ from: '教1-102', to: '教1-101', scope: 'within-building', building: '教1', from_floor: '1', to_floor: '1' });
        expect(inside).not.toHaveProperty('distance_m'); expect(inside).not.toHaveProperty('duration_s');
        expect(new URL(inside.url, 'https://studev.test').searchParams.get('nav')).toBe('仙林/教1-101');
        const outside = await tools.route({ from: '仙林/教1-101', to: '仙林/教2-101' });
        expect(outside).toMatchObject({ scope: 'to-entrance', arrival: '教2入口', floor: '1' });
        expect('distance_m' in outside && outside.distance_m).toBeGreaterThan(0);
        expect(outside.steps.at(-1)).toBe('进入教2后，前往1 层 · 教2-101');
        expect(new URL(outside.url, 'https://studev.test').searchParams.get('nav')).toBe('仙林/教2-101');
        const bike = await tools.route({ from: '仙林/教1-101', to: '仙林/教2-101', mode: 'bike' });
        expect(new URL(bike.url, 'https://studev.test').searchParams.get('mode')).toBe('bike');
    } finally { tools.dispose(); }
});

it('finds the released TCP past-paper passages in exam materials and reads their exact search IDs', async () => {
    const channel = channels.find(channel => channel.label === '考试资料')!;
    const answer = await engine.search({ query: '拥塞控制', offset: 0, limit: 6, sort: 'relevance', filters: { sourceIds: channel.sources } }, () => {});
    const compiled = answer.results.filter(result => result.source === 'sections');
    expect(compiled.length).toBeGreaterThan(0);
    const tools = new CampusTools();
    try {
        for (const hit of compiled) {
            const read = await tools.read(textKey(hit.id));
            expect(read.title).toBe(hit.title);
            expect(read.text.length).toBeGreaterThan(0);
            expect(read.url).toBe(hit.url);
        }
    } finally { tools.dispose(); }
}, 20000);

it('reads every exact TCP topic and material address offered by the course and its reference passages', async () => {
    const said = courseSaid(index, [], '计算机通信与网络');
    expect(said.found).toBe(true);
    if (!('chapters' in said) || !('materials' in said)) throw new Error('published network course missing');
    const topic = index.topics.find(topic => topic.id === '计算机网络/tcp_flow_congestion')!;
    expect(said.chapters.flatMap(chapter => chapter.topics).some(item => item.id === textKey(`topics/${topic.id}`))).toBe(true);
    const ids = [textKey(`topics/${topic.id}`), ...Object.values(said.materials).flat().map(item => item.id), ...topic.references.map(ref => textKey(`sections/${ref.material}#${ref.anchor}`))];
    const tools = new CampusTools();
    try {
        for (const id of ids) expect((await tools.read(id)).title.length, id).toBeGreaterThan(0);
        // A mistyped path is a bad tool reference, not evidence that the source material is absent.
        await expect(tools.read('sections/计算机通信与网络/计算3')).rejects.toThrow('未知资料引用');
        await expect(tools.read('0000000000000000')).rejects.toThrow('未知资料引用');
    } finally { tools.dispose(); }
}, 20000);
