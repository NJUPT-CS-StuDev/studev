import product from '../../product.json';
import { expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
    readdir: vi.fn(async (input: string) => {
        const path = input.replaceAll('\\', '/');
        const entry = (name: string, directory = false) => ({ name, isDirectory: () => directory });
        if (path.endsWith('/public/map')) return [entry('style.json')];
        if (path.endsWith('/space')) return [entry('entities.json')];
        if (path.endsWith('/search')) return [entry('index.bin')];
        return [entry('space', true), entry('search', true)];
    }),
    stat: vi.fn(async (input: string) => ({ size: input.endsWith('style.json') ? 30 : input.endsWith('entities.json') ? 10 : 20 })),
}));

import { offlineRelease } from './release';

it('publishes measured complete download bytes and separates core map from the full package', async () => {
    const result = await offlineRelease();
    expect(result.bytes).toBe(60);
    expect(result.core).toEqual([`${result.base}/space/entities.json`, '/map/style.json']);
    expect(result.all).toEqual([`${result.base}/space/entities.json`, `${result.base}/search/index.bin`]);
    expect(result.android).toEqual({ versionName: product.android.versionName, versionCode: product.android.versionCode });
});
