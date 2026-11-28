namespace StuDev.Map;

/** The baked buildings in transit, as src/campus/map/model/packing.ts packs them: each of the 12 byte columns in one run,
 * each position axis as zig-zagged steps from the previous vertex. Unpacking rebuilds the layout the GPU draws. */
public static class Packing
{
    /** The encoding a release declares in `formats.models`. */
    public const string Format = "models-planes-v1";
    private const int Stride = 12;

    public static byte[] Unpack(byte[] packed)
    {
        if (packed.Length % Stride != 0) throw new InvalidDataException($"a model buffer is whole vertices of {Stride} bytes");
        var count = packed.Length / Stride;
        var gpu = new byte[packed.Length];
        for (var axis = 0; axis < 3; axis++)
        {
            int low = axis * 2 * count, high = low + count, value = 0;
            for (var i = 0; i < count; i++)
            {
                var step = packed[low + i] | packed[high + i] << 8;
                value = (short)(value + ((step >>> 1) ^ -(step & 1)));
                gpu[i * Stride + axis * 2] = (byte)value;
                gpu[i * Stride + axis * 2 + 1] = (byte)(value >> 8);
            }
        }
        for (var b = 6; b < Stride; b++)
        {
            var from = b * count;
            for (var i = 0; i < count; i++) gpu[i * Stride + b] = packed[from + i];
        }
        return gpu;
    }
}
