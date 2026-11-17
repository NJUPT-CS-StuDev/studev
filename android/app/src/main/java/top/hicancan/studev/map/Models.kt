package top.hicancan.studev.map

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import top.hicancan.studev.data.CampusPackage

/** The baked buildings from njupt-map, drawn by native code inside the map's frame. */
object Models {
    @Serializable data class Index(val origin: List<Double>, val scale: Double, val buildings: Map<String, List<Int>>)
    class Loaded(val index: Index, val bytes: ByteBuffer)

    init { System.loadLibrary("campusmodels") }

    suspend fun load(repository: top.hicancan.studev.data.AcademicRepository): Loaded {
        val index = Json.decodeFromString<Index>(repository.bytes("space/仙林/models.json").decodeToString())
        val raw = java.util.zip.GZIPInputStream(repository.bytes("space/仙林/models.bin.gzip").inputStream()).use { it.readBytes() }
        return Loaded(index, ByteBuffer.allocateDirect(raw.size).order(ByteOrder.LITTLE_ENDIAN).put(raw).apply { rewind() })
    }

    external fun host(bytes: ByteBuffer, lon: Double, lat: Double, scale: Double): Long
    external fun look(first: Int, count: Int, flatten: Float, night: Float, faded: Float, r: Float, g: Float, b: Float)
}
