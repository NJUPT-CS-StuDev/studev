package top.hicancan.studev.map

/**
 * The baked buildings in transit, as src/campus/map/model/packing.ts packs them: each of the 12 byte columns in one run,
 * each position axis as zig-zagged steps from the previous vertex. Unpacking rebuilds the layout the GPU draws.
 */
object Packing {
    /** The encoding a release declares in `formats.models`. */
    const val FORMAT = "models-planes-v1"
    private const val STRIDE = 12

    fun unpack(packed: ByteArray): ByteArray {
        require(packed.size % STRIDE == 0) { "a model buffer is whole vertices of $STRIDE bytes" }
        val count = packed.size / STRIDE
        val gpu = ByteArray(packed.size)
        for (axis in 0 until 3) {
            val low = axis * 2 * count
            val high = low + count
            var value = 0
            for (i in 0 until count) {
                val step = (packed[low + i].toInt() and 0xff) or ((packed[high + i].toInt() and 0xff) shl 8)
                value = ((value + ((step ushr 1) xor -(step and 1))) shl 16) shr 16
                gpu[i * STRIDE + axis * 2] = value.toByte()
                gpu[i * STRIDE + axis * 2 + 1] = (value shr 8).toByte()
            }
        }
        for (byte in 6 until STRIDE) {
            val from = byte * count
            for (i in 0 until count) gpu[i * STRIDE + byte] = packed[from + i]
        }
        return gpu
    }
}
