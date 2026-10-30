package top.hicancan.studev.data

import android.content.res.AssetManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import top.hicancan.studev.navigation.Endpoint

@Serializable
data class Entrance(val at: List<Double>, val source: String)

@Serializable
data class OpeningHours(val week: Map<String, List<List<String>>>, val note: String? = null)

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
    val use: String,
    val routing: Endpoint,
    val hours: OpeningHours? = null,
    val category: String? = null,
    val featured: Boolean = false,
) {
    val kindLabel get() = when (kind) { "building" -> "楼栋"; "room" -> "教室"; else -> kind }
}

/** Pure binding: glyph placeholders remain intact for MapLibre. */
object StyleTokens {
    const val DATA = "asset://data/space/仙林"
    const val ASSETS = "asset://map"
    fun resolve(json: String): String = json.replace("{data}", DATA).replace("{assets}", ASSETS)
}

class CampusPackage private constructor(
    val version: String,
    val places: List<Place>,
    private val lightStyle: String,
    private val darkStyle: String,
) {
    val byId = places.associateBy { it.id }
    fun position(place: Place) = place.centre ?: byId[place.parent]?.centre
    fun style(dark: Boolean) = if (dark) darkStyle else lightStyle
    companion object {
        const val BASE = "data/space/仙林"
        suspend fun load(assets: AssetManager): CampusPackage = withContext(Dispatchers.IO) {
            fun text(path: String) = assets.open(path).bufferedReader().use { it.readText() }
            CampusPackage(text("data/version.txt").trim(), Json.decodeFromString(text("$BASE/places.json")),
                StyleTokens.resolve(text("$BASE/style-light.json")),
                StyleTokens.resolve(text("$BASE/style-dark.json")))
        }
    }
}
