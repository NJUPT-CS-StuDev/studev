// How the baked buildings travel. njupt-map bakes them as the GPU draws them: 12 bytes a vertex (position int16 ×3,
// normal int8 ×3, colour uint8 ×3), triangle after triangle. That layout gzips poorly, because neighbouring bytes are
// unrelated and each position repeats most of its neighbour. In transit each axis holds the step from the previous
// vertex (int16 arithmetic wraps, so every value round-trips), zig-zagged so small steps either way are small numbers,
// and each of the 12 byte columns lies in one run of its own. gzip then sees long runs of near-zero bytes: the campus
// shrinks from 2.2 MB to about 0.3 MB, and unpacking is one pass that rebuilds the GPU layout.

/** The transport encoding a release declares in `formats.models`; a client that reads another cannot draw it. */
export const MODELS_FORMAT = 'models-planes-v1';
const STRIDE = 12;

const zigzag = (step: number) => ((step << 1) ^ (step >> 15)) & 0xffff;
const unzigzag = (value: number) => (value >>> 1) ^ -(value & 1);

/** The GPU layout to the transport layout (before gzip). */
export function packModels(gpu: Uint8Array): Uint8Array {
    if (gpu.length % STRIDE) throw new Error(`a model buffer is whole vertices of ${STRIDE} bytes`);
    const count = gpu.length / STRIDE;
    const view = new DataView(gpu.buffer, gpu.byteOffset, gpu.byteLength);
    const out = new Uint8Array(gpu.length);
    const previous = [0, 0, 0];
    for (let i = 0; i < count; i++) {
        for (let axis = 0; axis < 3; axis++) {
            const value = view.getInt16(i * STRIDE + axis * 2, true);
            const step = zigzag((value - previous[axis]!) << 16 >> 16);
            previous[axis] = value;
            out[(axis * 2) * count + i] = step & 0xff;
            out[(axis * 2 + 1) * count + i] = step >> 8;
        }
        for (let byte = 6; byte < STRIDE; byte++) out[byte * count + i] = gpu[i * STRIDE + byte]!;
    }
    return out;
}

/** The transport layout (after gunzip) back to what the GPU draws. */
export function unpackModels(packed: Uint8Array): Uint8Array {
    if (packed.length % STRIDE) throw new Error(`a model buffer is whole vertices of ${STRIDE} bytes`);
    const count = packed.length / STRIDE;
    const gpu = new Uint8Array(packed.length);
    const view = new DataView(gpu.buffer);
    for (let axis = 0; axis < 3; axis++) {
        const low = axis * 2 * count, high = low + count;
        let value = 0;
        for (let i = 0; i < count; i++) {
            value = (value + unzigzag(packed[low + i]! | packed[high + i]! << 8)) << 16 >> 16;
            view.setInt16(i * STRIDE + axis * 2, value, true);
        }
    }
    for (let byte = 6; byte < STRIDE; byte++) {
        const from = byte * count;
        for (let i = 0; i < count; i++) gpu[i * STRIDE + byte] = packed[from + i]!;
    }
    return gpu;
}
