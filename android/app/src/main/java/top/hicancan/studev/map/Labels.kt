package top.hicancan.studev.map

import top.hicancan.studev.data.Place
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * When a building or place is named over the map, as src/campus/map/model/labels.ts. The map's tier says how prominent
 * a thing is: tier 1 is named from afar, 2 closer, 3 close up. A building being taught in is named first of all, with its
 * free rooms. A place inside a building is named only once one is close enough to see into it, and a place off the
 * campus a little after one on it. Parking is never named: its lots and entrances would bury everything else.
 */
object Labels {
    data class Rule(val minZoom: Double, val priority: Int)

    private val BUILDING = listOf(15.1, 16.0, 16.8)
    private val PLACE = listOf(15.6, 16.4, 17.0)
    private const val INSIDE = 17.4
    private const val OFF_CAMPUS = 0.4
    private val UNNAMED = setOf("停车场")

    /** How a building or place is named, or null when it is not; [teaching] marks a building whose free rooms are shown. */
    fun rule(place: Place, byId: Map<String, Place>, teaching: Boolean = false): Rule? {
        val tier = place.tier ?: 3
        if (place.kind == "building") return if (teaching) Rule(14.5, 0) else Rule(BUILDING[tier - 1], tier)
        if (place.kind != "place" || place.category in UNNAMED) return null
        val parent = place.parent?.let(byId::get)
        val off = parent == null
        var minZoom = PLACE[tier - 1] + if (off) OFF_CAMPUS else 0.0
        if (parent?.kind == "building") minZoom = max(minZoom, INSIDE)
        return Rule((minZoom * 10).roundToInt() / 10.0, tier + 1 + if (off) 1 else 0)
    }
}
