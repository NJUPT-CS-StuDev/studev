package top.hicancan.studev.navigation

import kotlin.math.*
import kotlin.random.Random

/** Declared route metres drive playback; simulation never implements route matching or guidance. */
class RouteSimulator(private val route: CampusRoute, seed: Int = 42) {
    private val random = Random(seed)
    fun sample(distance: Double, timestamp: Long, jitter: Boolean = true): NavFix {
        val at = distance.coerceIn(0.0, route.distance_m)
        val offsets = route.geometry_offsets_m
        val end = offsets.indexOfFirst { it >= at }.coerceAtLeast(1).coerceAtMost(offsets.lastIndex)
        val start = end - 1
        val a = route.geometry[start]; val b = route.geometry[end]
        val t = if (offsets[end] == offsets[start]) 1.0 else (at - offsets[start]) / (offsets[end] - offsets[start])
        val lat = a[1] + (b[1] - a[1]) * t
        val lon = a[0] + (b[0] - a[0]) * t
        val north = (b[1] - a[1]) * 111_195
        val east = (b[0] - a[0]) * 111_195 * cos(Math.toRadians(lat))
        return NavFix(lon + if (jitter) random.nextDouble(-2.0, 2.0) / (111_195 * cos(Math.toRadians(lat))) else 0.0,
            lat + if (jitter) random.nextDouble(-2.0, 2.0) / 111_195 else 0.0,
            5.0, (Math.toDegrees(atan2(east, north)) + 360) % 360, timestamp, if (route.mode == "bike") 4.2 else 1.25)
    }
}
