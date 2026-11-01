import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPACE_DIRECTORIES, SPACE_FILES, SPACE_READERS } from '../../../scripts/data/space-contract';

describe('the campus space release contract', () => {
    it('keeps one shipped-file allow-list', () => {
        expect(Object.keys(SPACE_READERS).sort()).toEqual([...SPACE_FILES, ...SPACE_DIRECTORIES].sort());
    });

    for (const [artifact, readers] of Object.entries(SPACE_READERS)) {
        it(`${artifact} has a web or Android reader`, () => {
            expect(readers.some(([relative, marker]) => readFileSync(resolve(process.cwd(), relative), 'utf8').includes(marker))).toBe(true);
        });
    }
});
