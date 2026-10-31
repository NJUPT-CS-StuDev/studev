package top.hicancan.studev.data

import java.io.RandomAccessFile
import java.util.zip.GZIPInputStream

/** Minimal PMTiles v3 reader used by MapLibre's custom vector source. */
class PmTilesReader(private val file: java.io.File) {
    private val archive = RandomAccessFile(file, "r")
    private val header: Header
    private val root: List<Entry>

    init {
        val bytes = read(0, 127)
        require(bytes.copyOfRange(0, 7).decodeToString() == "PMTiles") { "invalid PMTiles archive" }
        require(bytes[7].toInt() == 3) { "unsupported PMTiles version" }
        header = Header(
            rootOffset = u64(bytes, 8), rootLength = u64(bytes, 16), leafOffset = u64(bytes, 40),
            leafLength = u64(bytes, 48), tileOffset = u64(bytes, 56), internalCompression = bytes[97].toInt(),
            tileCompression = bytes[98].toInt(), minZoom = bytes[100].toInt(), maxZoom = bytes[101].toInt(),
        )
        root = decodeDirectory(decompress(read(header.rootOffset, header.rootLength), header.internalCompression))
    }

    @Synchronized fun tile(z: Int, x: Int, y: Int): ByteArray? {
        if (z !in header.minZoom..header.maxZoom) return null
        var directory = root
        val wanted = zxyToTileId(z, x, y)
        repeat(4) {
            val entry = find(directory, wanted) ?: return null
            if (entry.runLength > 0) return decompress(read(header.tileOffset + entry.offset, entry.length), header.tileCompression)
            directory = decodeDirectory(decompress(read(header.leafOffset + entry.offset, entry.length), header.internalCompression))
        }
        return null
    }

    fun close() = archive.close()

    private fun read(offset: Long, length: Long): ByteArray {
        require(length <= Int.MAX_VALUE) { "PMTiles segment too large" }
        val out = ByteArray(length.toInt())
        archive.seek(offset)
        archive.readFully(out)
        return out
    }

    private fun decompress(bytes: ByteArray, compression: Int): ByteArray = when (compression) {
        0, 1 -> bytes
        2 -> GZIPInputStream(bytes.inputStream()).use { it.readBytes() }
        else -> error("unsupported PMTiles compression $compression")
    }

    private data class Header(val rootOffset: Long, val rootLength: Long, val leafOffset: Long, val leafLength: Long,
                              val tileOffset: Long, val internalCompression: Int, val tileCompression: Int,
                              val minZoom: Int, val maxZoom: Int)
    private data class Entry(val tileId: Long, val runLength: Long, val length: Long, val offset: Long)

    private fun decodeDirectory(bytes: ByteArray): List<Entry> {
        val cursor = Cursor(bytes)
        val count = cursor.varint().toInt()
        val ids = LongArray(count)
        var previous = 0L
        repeat(count) { previous += cursor.varint(); ids[it] = previous }
        val runs = LongArray(count) { cursor.varint() }
        val lengths = LongArray(count) { cursor.varint() }
        var previousOffset = 0L
        return List(count) { index ->
            val encoded = cursor.varint()
            val offset = if (encoded == 0L && index > 0) previousOffset + lengths[index - 1] else encoded - 1
            previousOffset = offset
            Entry(ids[index], runs[index], lengths[index], offset)
        }
    }

    private fun find(entries: List<Entry>, tileId: Long): Entry? {
        var low = 0
        var high = entries.lastIndex
        while (low <= high) {
            val mid = (low + high) ushr 1
            val entry = entries[mid]
            when {
                tileId < entry.tileId -> high = mid - 1
                tileId >= entry.tileId + entry.runLength && entry.runLength > 0L -> low = mid + 1
                tileId == entry.tileId || entry.runLength == 0L || tileId < entry.tileId + entry.runLength -> return entry
                else -> return null
            }
        }
        return null
    }

    private class Cursor(private val bytes: ByteArray) {
        private var position = 0
        fun varint(): Long {
            var value = 0L
            var shift = 0
            while (true) {
                val next = bytes[position++].toInt() and 0xff
                value = value or ((next and 0x7f).toLong() shl shift)
                if (next and 0x80 == 0) return value
                shift += 7
            }
        }
    }

    private fun zxyToTileId(z: Int, x: Int, y: Int): Long {
        val dimension = 1L shl z
        var index = (dimension * dimension - 1L) / 3L
        var xx = x
        var yy = y
        var size = 1 shl (z - 1)
        while (size > 0) {
            val bitX = xx and size
            val bitY = yy and size
            index += ((3 * bitX) xor bitY).toLong() * size
            val rotated = if (bitY == 0) {
                if (bitX != 0) size - 1 - yy to size - 1 - xx else yy to xx
            } else xx to yy
            xx = rotated.first
            yy = rotated.second
            size = size shr 1
        }
        return index
    }

    private fun u64(bytes: ByteArray, offset: Int): Long {
        var value = 0L
        repeat(8) { value = value or ((bytes[offset + it].toLong() and 0xff) shl (8 * it)) }
        return value
    }
}
