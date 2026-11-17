package top.hicancan.studev.map

import top.hicancan.studev.data.Place
import top.hicancan.studev.data.roomDisplayName
import top.hicancan.studev.navigation.Endpoint

/** Public routing identifies the road access; the requested room remains the indoor destination. */
object Routing {
    fun accessId(place: Place) = (place.routing as Endpoint.Target).id
    fun indoor(place: Place) = accessId(place) != place.id
    fun sameAccess(from: Place, to: Place) = (to.kind == "building" || indoor(to)) && accessId(from) == accessId(to)
    fun access(place: Place, places: Map<String, Place>) = places.getValue(accessId(place))
    fun name(place: Place, places: Map<String, Place>) = when (place.kind) { "room" -> roomDisplayName(place.id, places)!!; "floor" -> "${access(place, places).displayName(places)} ${floor(place)} 层"; else -> place.displayName(places) }
    fun floor(place: Place) = place.floor ?: place.id.substringAfterLast('/').takeIf { place.kind == "floor" }
    fun location(place: Place, places: Map<String, Place>) = (floor(place)?.takeUnless { place.kind == "floor" }?.let { "$it 层 · " } ?: "") + name(place, places)
    fun inside(place: Place, places: Map<String, Place>) = "进入${name(access(place, places), places)}后，前往${location(place, places)}"
    fun duration(seconds: Double) = if (seconds < 60) "不到 1 分钟" else "${kotlin.math.ceil(seconds / 60).toInt()} 分钟"
}
