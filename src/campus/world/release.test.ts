import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { FORMATS } from './formats';
import { campusPointer, releaseAt, resourceAt, validRelease } from './release';

it('resolves every public component of the actual snapshot against the discovered data entry', async () => {
    const snapshot = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
    expect(validRelease(snapshot)).toBe(true);
    // The snapshot this build ships with is in the encodings it reads.
    expect(snapshot.formats).toEqual(FORMATS);
    expect(validRelease({ ...snapshot, formats: undefined })).toBe(false);
    const resolved = releaseAt(snapshot, 'https://moved-data.example');
    for (const key of ['base', 'map_base', 'knowledge_base', 'search_base', 'texts_base'] as const)
        expect(resolved[key]).toBe(`https://moved-data.example${snapshot[key]}`);
    expect(snapshot).not.toHaveProperty('android');
    expect(validRelease({ ...snapshot, map_base: 'https://another.example' + snapshot.map_base })).toBe(false);
    expect(validRelease({ ...snapshot, texts_base: '/texts/../private' })).toBe(false);
    expect(validRelease({ ...snapshot, base: '/data/some-other-revision' })).toBe(false);
    const pointer = JSON.parse(JSON.stringify(campusPointer(snapshot)));
    expect(validRelease(pointer)).toBe(true);
    const { core: _core, all: _all, bytes: _bytes, ...expected } = snapshot;
    expect(pointer).toEqual(expected);
    expect(Buffer.byteLength(JSON.stringify(pointer))).toBeLessThan(2048);
});

it('keeps a real knowledge filename containing a hash in the request path', () => {
    const path = '/knowledge/20261116-1914/materials/batch-2/数学建模/2018年美赛O奖论文：C题-能源联盟Team-#82150.md';
    const url = new URL(resourceAt(path, 'https://data.example/campus-release.json'));
    expect(decodeURIComponent(url.pathname)).toBe(path);
    expect(url.hash).toBe('');
});
