import { readFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { packModels, unpackModels } from './packing';

const vertices = (values: number[][]) => {
    const gpu = new Uint8Array(values.length * 12);
    const view = new DataView(gpu.buffer);
    values.forEach(([x, y, z, ...rest], i) => {
        view.setInt16(i * 12, x!, true); view.setInt16(i * 12 + 2, y!, true); view.setInt16(i * 12 + 4, z!, true);
        rest.forEach((byte, k) => { gpu[i * 12 + 6 + k] = byte; });
    });
    return gpu;
};

describe('model packing', () => {
    it('round-trips every position, including steps that wrap past the int16 range', () => {
        const gpu = vertices([[32767, -32768, 0, 1, 2, 3, 4, 5, 6], [-32768, 32767, -1, 255, 0, 128, 7, 8, 9], [0, 0, 32767, 9, 9, 9, 9, 9, 9], [1, -1, -32768, 0, 0, 0, 0, 0, 0]]);
        expect(unpackModels(packModels(gpu))).toEqual(gpu);
        const noise = new Uint8Array(12 * 5000).map(() => Math.floor(Math.random() * 256));
        expect(unpackModels(packModels(noise))).toEqual(noise);
    });

    it('refuses a buffer that is not whole vertices', () => {
        expect(() => packModels(new Uint8Array(13))).toThrow();
        expect(() => unpackModels(new Uint8Array(11))).toThrow();
    });

    it('carries the released campus exactly, several times smaller than gzip of the GPU layout', async () => {
        const release = JSON.parse(await readFile('src/data/campus-release.json', 'utf8'));
        const packed = gunzipSync(await readFile(`public${release.map_base}/仙林/models.bin.gzip`));
        const gpu = unpackModels(packed);
        // Thirteen megabytes: compared as bytes, since a deep equality walk would build millions of objects.
        expect(Buffer.compare(packModels(gpu), packed)).toBe(0);
        expect(gzipSync(packed, { level: 9 }).length * 4).toBeLessThan(gzipSync(gpu, { level: 9 }).length);
    });
});
