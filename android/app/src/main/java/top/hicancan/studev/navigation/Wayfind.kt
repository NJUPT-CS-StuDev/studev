package top.hicancan.studev.navigation

import android.content.res.AssetManager
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import top.hicancan.studev.data.CampusPackage

@Serializable
sealed class Endpoint {
    @Serializable @SerialName("position") data class Position(val position: List<Double>) : Endpoint()
    @Serializable @SerialName("target") data class Target(val id: String) : Endpoint()
}
@Serializable
data class RouteRequest(
    val origin: Endpoint, val destination: Endpoint, val mode: String = "walk",
    val avoid_steps: Boolean = false, val max_snap_distance_m: Double = 100.0, val alternatives: Int = 3,
)
@Serializable data class RouteResponse(val routes: List<CampusRoute>)
@Serializable data class RouteSegment(
    val geometry_start: Int, val geometry_end: Int, val distance_m: Double,
    val duration_s: Double, val edge: Int?, val name: String?, val steps: Boolean,
)
@Serializable data class Landmark(val name: String, val at: List<Double>, val relation: String)
@Serializable data class ManeuverAction(
    val kind: String, val modifier: String, val offset_m: Double,
    val way_name: String? = null, val landmark: Landmark? = null,
)
@Serializable data class Maneuver(
    val type: String, val modifier: String, val position: List<Double>,
    val bearing_before: Double, val bearing_after: Double, val offset_m: Double,
    val distance_to_next_m: Double, val way_name: String?, val target_id: String? = null,
    val landmark: Landmark? = null, val leads_to_arrival: Boolean = false,
    val following_actions: List<ManeuverAction> = emptyList(), val instruction: String,
)
@Serializable data class CampusRoute(
    val mode: String, val geometry: List<List<Double>>, val geometry_offsets_m: List<Double>,
    val distance_m: Double, val duration_s: Double, val segments: List<RouteSegment>, val maneuvers: List<Maneuver>,
    val via: String,
)
@Serializable data class ManeuverDistance(val maneuver: Maneuver, val distance_m: Double)
@Serializable data class VoicePrompt(val maneuver_index: Int, val stage: String, val text: String)
@Serializable data class NavigationUpdate(
    val distance_travelled_m: Double, val distance_remaining_m: Double, val eta_s: Double,
    val matched_position: List<Double>, val matched_distance_m: Double,
    val current: ManeuverDistance, val next: ManeuverDistance?, val voice_prompts: List<VoicePrompt>,
    val off_route: Boolean, val arrived: Boolean,
)
data class NavFix(val longitude: Double, val latitude: Double, val accuracy: Double,
                  val heading: Double?, val timestamp: Long, val speed: Double = 0.0) {
    val position get() = listOf(longitude, latitude)
}
interface NavigationSession : AutoCloseable { fun update(fix: NavFix): NavigationUpdate }
interface RoutingEngine : AutoCloseable {
    fun route(request: RouteRequest): List<CampusRoute>
    fun navigate(route: CampusRoute): NavigationSession
}
object WayfindProtocol {
    // Kotlin defaults (three alternatives) intentionally differ from Rust's default (one).
    val json = Json { encodeDefaults = true }
    fun request(request: RouteRequest) = json.encodeToString(request)
}

/** Native objects are confined to the caller's IO mutex, including destruction. */
class Wayfind(graph: String) : RoutingEngine {
    private val router = top.hicancan.wayfind.Router(graph)
    override fun route(request: RouteRequest) = Json.decodeFromString<RouteResponse>(
        router.route(WayfindProtocol.request(request))).routes
    override fun navigate(route: CampusRoute): NavigationSession {
        val native = top.hicancan.wayfind.Navigator(Json.encodeToString(route))
        return object : NavigationSession {
            override fun update(fix: NavFix) = Json.decodeFromString<NavigationUpdate>(native.update(
                fix.longitude, fix.latitude, fix.accuracy, fix.heading, fix.timestamp.toDouble()))
            override fun close() = native.close()
        }
    }
    override fun close() = router.close()
    companion object {
        fun load(assets: AssetManager) = Wayfind(assets.open("${CampusPackage.BASE}/network.json")
            .bufferedReader().use { it.readText() })
    }
}

enum class TripPhase { Planning, Navigating, Arrived }
data class TripState(
    val phase: TripPhase = TripPhase.Planning, val update: NavigationUpdate? = null,
    val rerouting: Boolean = false, val reroutes: Int = 0,
) {
    fun accept(value: NavigationUpdate) = copy(
        phase = if (value.arrived) TripPhase.Arrived else TripPhase.Navigating,
        update = value, rerouting = value.off_route && !value.arrived,
    )
    val banner get() = update?.let { if (it.arrived) it.current else it.next ?: it.current }
}

fun metres(value: Double): String = if (value >= 1000) String.format(java.util.Locale.CHINA, "%.1f 公里", value / 1000)
    else "${value.toInt().coerceAtLeast(0)} 米"
fun minutes(seconds: Double) = kotlin.math.ceil(seconds / 60).toInt().coerceAtLeast(1)

/** Compact visual/accessibility caption; full instructions always come from the kernel. */
fun maneuverLabel(kind: String, modifier: String) = when (kind) {
    "stairs" -> "经过楼梯"; "arrive" -> "到达"
    else -> when (modifier) {
        "left" -> "左转"; "right" -> "右转"; "slight_left" -> "向左前方"; "slight_right" -> "向右前方"
        "sharp_left" -> "向左后方"; "sharp_right" -> "向右后方"; else -> "直行"
    }
}
