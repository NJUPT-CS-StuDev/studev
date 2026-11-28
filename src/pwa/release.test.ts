import { expect, it, vi } from 'vitest';

vi.mock('../data/campus-release.json', () => ({ default: {
    version: 'r1', base: '/data/r1', map_base: '/space/m1',
    knowledge_base: '/knowledge/k1', search_base: '/search/s1', formats: { search: 'wasm-search-bundle-v5', models: 'models-planes-v1' }, texts_base: '/texts/s1',
} }));

vi.mock('node:fs/promises', () => ({
    readdir: vi.fn(async (input: string) => {
        const path = input.replaceAll('\\', '/');
        const entry = (name: string, directory = false) => ({ name, isDirectory: () => directory });
        if (path.endsWith('/data/r1')) return [entry('calendar.json'), entry('knowledge', true)];
        if (path.endsWith('/knowledge')) return [entry('duplicate.md')];
        return [entry('resource.bin')];
    }),
    stat: vi.fn(async () => ({ size: 10 })),
}));

import { offlineRelease } from './release';

it('names separate immutable component files and keeps app metadata outside the data pointer', async () => {
    const result = await offlineRelease();
    expect(result.core).toEqual(['/space/m1/resource.bin']);
    expect(result.all).toEqual([
        '/data/r1/calendar.json', '/space/m1/resource.bin', '/knowledge/k1/resource.bin',
        '/search/s1/resource.bin', '/texts/s1/resource.bin',
    ]);
    expect(result.bytes).toBe(50);
    expect(result).not.toHaveProperty('android');
    expect(result.all.some(path => path.includes('duplicate'))).toBe(false);
});
