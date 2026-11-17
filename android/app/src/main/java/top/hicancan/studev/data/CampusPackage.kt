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
    /** The entity it lies in; none for a place off the campus. */
    val parent: String? = null,
    val names: List<String>,
    val centre: List<Double>? = null,
    val levels: Int? = null,
    val houses: List<String> = emptyList(),
    val entrances: List<Entrance> = emptyList(),
    val title: String? = null,
    val floor: String? = null,
    val seats: Int? = null,
    @SerialName("room_kinds") val roomKinds: List<String> = emptyList(),
    val sources: List<String>,
    val routing: Endpoint,
    val hours: OpeningHours? = null,
    /** From njupt-map's one vocabulary, with its group and how prominently the map shows it (tier 1–3); a room is a 教室. */
    val category: String? = null,
    val group: String? = null,
    val tier: Int? = null,
) {
    val endpoint get() = routing
    val kindLabel get() = when (kind) { "building" -> "楼栋"; "room" -> "教室"; else -> kind }
    fun displayName(byId: Map<String, Place>): String {
        names.firstOrNull { it.isNotBlank() }?.let { return it.trim() }
        if (kind == "building") {
            var parentPlace = parent?.let(byId::get)
            while (parentPlace != null) {
                parentPlace.names.firstOrNull { it.isNotBlank() }?.let { return "${category ?: "建筑"} · ${it.trim()}" }
                parentPlace = parentPlace.parent?.let(byId::get)
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
        var parent = place.parent?.let(byId::get)
        while (parent != null && parent.kind != "building") parent = parent.parent?.let(byId::get)
        if (parent != null) return "${parent.displayName(byId)}-$title"
    }
    return title
}

/** Pure binding: glyph placeholders remain intact for MapLibre. */
object StyleTokens {
    const val DATA = "asset://data/space/仙林"
    const val ASSETS = "asset://data/space/assets"
    fun resolve(json: String, data: String = DATA, assets: String = ASSETS): String = json.replace("{data}", data).replace("{assets}", assets)
}

class CampusPackage private constructor(
    val version: String,
    val places: List<Place>,
    val style: String,
    val basemapFile: File?,
    val repository: AcademicRepository,
) {
    val byId = places.associateBy { it.id }
    fun position(place: Place) = place.centre ?: place.parent?.let(byId::get)?.centre
    companion object {
        const val BASE = "data/space/仙林"
        suspend fun load(context: Context, repository: AcademicRepository? = null): CampusPackage = withContext(Dispatchers.IO) {
            val repo = repository ?: AcademicRepository.open(context)
            suspend fun text(path: String) = repo.bytes(path).decodeToString()
            val mapFile = repo.localFile("space/仙林/basemap.pmtiles")
            val places = Json.decodeFromString<List<Place>>(text("space/仙林/entities.json"))
            val opening = Json.decodeFromString<Map<String, OpeningRecord>>(text("hours.json"))
            val rooms = repo.rooms().rooms.associateBy { it.id }
            val data = mapFile?.parentFile?.let { "file://${it.absolutePath}" } ?: StyleTokens.DATA
            CampusPackage(requireNotNull(repo.release.map_version), places.map { place ->
                val room = rooms[place.id]
                place.copy(hours = opening[place.id]?.hours, names = (place.names + room?.names.orEmpty()).distinct(), seats = room?.seats, roomKinds = room?.kinds.orEmpty())
            }, StyleTokens.resolve(text("space/仙林/style.json"), data, repo.mapAssets()), mapFile, repo)
        }
    }
}
