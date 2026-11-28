import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CampusTools } from './campusTools';
import { textKey } from './texts';
let release: { version: string };
const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
beforeAll(async () => { release = await read('src/data/campus-release.json'); });
describe('the public campus snapshot', () => {
    it('reads knowledge by its released address, including every page of a complete material', async () => {
        const index = await read<{ topics: { id: string }[]; materials: { path: string }[] }>(join('public/data', release.version, 'knowledge/knowledge.json'));
        const fetch = vi.fn(async (url: string) => new Response(await readFile(join('public', decodeURIComponent(new URL(url, 'https://studev.cn').pathname)), 'utf8')));
        vi.stubGlobal('fetch', fetch);
        const tools = new CampusTools();
        try {
            const topic = await tools.read(textKey(`topics/${index.topics[0]!.id}`));
            expect(topic.text.length).toBeGreaterThan(0);
            const id = textKey(`sections/${index.materials[0]!.path}`);
            let offset = 0, text = '';
            do {
                const page = await tools.read(id, offset);
                expect(page.text.length).toBeLessThanOrEqual(8000);
                text += page.text;
                if (!page.next) break;
                expect(page.next).toBeGreaterThan(offset);
                offset = page.next;
            } while (true);
            expect(text).toContain('#');
            await expect(tools.read(id, text.length + 1)).rejects.toThrow('正文位置');
        } finally { tools.dispose(); vi.unstubAllGlobals(); }
    });
});
