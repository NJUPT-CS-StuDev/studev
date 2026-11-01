package top.hicancan.studev.data

import android.content.res.AssetManager
import android.content.Context
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import top.hicancan.studev.navigation.Endpoint

@Serializable
data class Entrance(val at: List<Double>, val source: String)

@Serializable
data class OpeningHours(
    val week: Map<String, List<List<String>>>,
    val daily: List<List<String>> = emptyList(),
    val weekdays: Map<String, List<List<String>>> = emptyMap(),
    val note: String? = null,
)

@Serializable
private data class OpeningRecord(val hours: OpeningHours, val sources: List<JsonObject> = emptyList())

/** The shared package contract. Absent optional fields stay absent on serialization. */
@Serializable
data class Place(
    val id: String,
    val kind: String,
    val parent: String,
    val names: List<String>,
    val centre: List<Double>? = null,
    val levels: Int? = null,
    val houses: List<String> = emptyList(),
    val entrances: List<Entrance> = emptyList(),
    val floor: String? = null,
    val seats: Int? = null,
    @SerialName("room_kinds") val roomKinds: List<String> = emptyList(),
    val sources: List<String>,
    val amap: String? = null,
    val routing: Endpoint,
    val hours: OpeningHours? = null,
    val category: String? = null,
    val featured: Boolean = false,
) {
    val endpoint get() = routing
    val kindLabel get() = when (kind) { "building" -> "楼栋"; "room" -> "教室"; else -> kind }
    fun displayName(byId: Map<String, Place>): String {
        names.firstOrNull { it.isNotBlank() }?.let { return it.trim() }
        if (kind == "building") {
            var parentPlace = byId[parent]
            while (parentPlace != null) {
                parentPlace.names.firstOrNull { it.isNotBlank() }?.let { return "${category ?: "建筑"} · ${it.trim()}" }
                parentPlace = byId[parentPlace.parent]
            }
            return "未命名建筑"
        }
        return "${category ?: kind} · 未命名地点"
    }
}

fun roomDisplayName(room: String?, byId: Map<String, Place>): String? {
    if (room == null) return null
    val place = byId[room]
    if (place == null) return room.substringAfterLast('/')
    val title = place.displayName(byId)
    if (place.kind == "room") {
        var parent = byId[place.parent]
        while (parent != null && parent.kind != "building") parent = byId[parent.parent]
        if (parent != null) return "${parent.displayName(byId)}-$title"
    }
    return title
}

/** Pure binding: glyph placeholders remain intact for MapLibre. */
object StyleTokens {
    const val DATA = "asset://data/space/仙林"
    const val ASSETS = "asset://map"
    fun resolve(json: String, data: String = DATA, assets: String = ASSETS): String = json.replace("{data}", data).replace("{assets}", assets)
}

class CampusPackage private constructor(
    val version: String,
    val places: List<Place>,
    private val lightStyle: String,
    private val darkStyle: String,
    val basemapFile: File?,
) {
    val byId = places.associateBy { it.id }
    fun position(place: Place) = place.centre ?: byId[place.parent]?.centre
    fun style(dark: Boolean) = if (dark) darkStyle else lightStyle
    companion object {
        const val BASE = "data/space/仙林"
        suspend fun load(assets: AssetManager): CampusPackage = withContext(Dispatchers.IO) {
            load(assets, null)
        }
        suspend fun load(context: Context): CampusPackage = withContext(Dispatchers.IO) {
            val mapFile = File(context.filesDir, "campus-map/basemap.pmtiles").apply {
                parentFile?.mkdirs()
                context.assets.open("$BASE/basemap.pmtiles").use { input -> outputStream().use { output -> input.copyTo(output) } }
            }
            load(context.assets, mapFile)
        }
        private fun load(assets: AssetManager, mapFile: File?): CampusPackage {
            fun text(path: String) = assets.open(path).bufferedReader().use { it.readText() }
            val places = Json.decodeFromString<List<Place>>(text("$BASE/entities.json"))
            val opening = Json.decodeFromString<Map<String, OpeningRecord>>(text("data/hours.json"))
            val data = mapFile?.parentFile?.let { "file://${it.absolutePath}" } ?: StyleTokens.DATA
            fun style(path: String) = StyleTokens.resolve(text(path), data, StyleTokens.ASSETS)
            return CampusPackage(text("data/version.txt").trim(), places.map { place -> place.copy(hours = opening[place.id]?.hours) },
                style("$BASE/style-light.json"), style("$BASE/style-dark.json"), mapFile)
        }
    }
}
