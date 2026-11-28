import { afterAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { prepareSite } from './site';
import { CAMPUS_POINTER_PATH, validRelease, type CampusRelease } from '../../src/campus/world/release';

const tempBase = process.platform === 'win32' ? 'D:/Temp/codex' : '/tmp/codex';
let work: string;
const snapshot = (version: string): CampusRelease => ({ version, base: `/data/${version}`, built_at: '2026-11-17T12:00:00Z', teaching: '2026-2027-1', exams: null, labs: null, rooms: '2026-2027-1',
    map_version: 'map-v1.0.0', knowledge_version: 'k1', data_version: 'data1', map_base: '/space/m1', knowledge_base: '/knowledge/k1', search_base: '/search/s1', formats: { search: 'wasm-search-bundle-v5', models: 'models-planes-v1' }, texts_base: '/texts/s1' });
afterAll(async () => { if (work && resolve(work).startsWith(resolve(tempBase) + sep)) await rm(work, { recursive: true, force: true }); });

it('publishes only the current snapshot without archives or duplicate bundled components', async () => {
    await mkdir(tempBase, { recursive: true }); work = await mkdtemp(join(tempBase, 'studev-publish-'));
    const source = join(work, 'source'), out = join(work, 'out');
    for (const version of ['r1', 'r2']) for (const path of ['calendar.json', 'space/large.bin', 'knowledge/large.md', 'search/large.bin', 'texts/large.json']) {
        const file = join(source, 'public/data', version, path); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, version);
    }
    for (const path of ['space/m1/entities.json', 'knowledge/k1/knowledge.json', 'search/s1/manifest.json', 'texts/s1/one.json']) {
        const file = join(source, 'public', path); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, '{}');
    }
    const location = snapshot('r2');
    const after = { ...location, core: ['/space/m1/entities.json'], all: ['/data/r2/calendar.json', '/space/m1/entities.json'], bytes: 3 };
    await prepareSite(out, after, source);
    expect((await readdir(out)).sort()).toEqual(['.edgeone', 'campus-pointer.json', 'campus-release.json', 'data', 'edgeone.json', 'index.html', 'knowledge', 'search', 'space', 'texts']);
    expect(await readdir(join(out, 'data'))).toEqual(['r2']);
    expect(await readdir(join(out, 'data/r2'))).toEqual(['calendar.json']);
    expect(JSON.parse(await readFile(join(out, 'campus-release.json'), 'utf8'))).toEqual(after);
    const pointer = JSON.parse(await readFile(join(out, CAMPUS_POINTER_PATH), 'utf8'));
    expect(validRelease(pointer)).toBe(true);
    expect(pointer).toEqual(location);
    expect(JSON.parse(await readFile(join(out, '.edgeone/project.json'), 'utf8')).Name).toBe('studev-data');
    for (const path of ['space/m1/entities.json', 'knowledge/k1/knowledge.json', 'search/s1/manifest.json', 'texts/s1/one.json']) expect(await readFile(join(out, path), 'utf8')).toBe('{}');
});
