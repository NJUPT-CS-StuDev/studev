package top.hicancan.studev.map

import top.hicancan.studev.data.Place

/**
 * Finding a place by what someone calls it, as src/campus/map/model/find.ts: 教三 is 教3, 三食堂门口 is 三食堂, 教3-301 is
 * that room. The best match first; a place on the campus and a more prominent one before others as good.
 */
object Find {
    private const val DIGITS = "一二三四五六七八九"

    /** What a name is said as, to compare: no spaces or brackets, small letters, 教三楼 as 教3. */
    fun plainName(text: String): String {
        val said = Regex("[一二三四五六七八九](?=楼|号|栋|幢|$)").replace(text.lowercase().replace(Regex("[ \\t\\n\\r\u3000()（）·\\-—_]"), "")) { (DIGITS.indexOf(it.value) + 1).toString() }
        return Regex("^(教[1-9])楼$").replace(said, "$1")
    }

    private fun score(place: Place, said: String): Int {
        if (said.isEmpty() || place.kind !in setOf("building", "place", "room")) return 0
        val tail = plainName(place.id.substringAfter('/'))
        val names = (place.names + if (place.kind == "room") emptyList() else listOf(tail)).map(::plainName).filter { it.isNotEmpty() }
        var best = if (tail == said) 95 else 0
        for (name in names) {
            if (name == said) best = maxOf(best, 100)
            else if (place.kind == "room") continue
            else if (name.startsWith(said)) best = maxOf(best, 80 - minOf(20, name.length - said.length))
            else if (said.startsWith(name) && name.length >= 2) best = maxOf(best, 70 - minOf(20, said.length - name.length))
            else if (name.contains(said) && said.length >= 2) best = maxOf(best, 60 - minOf(20, name.length - said.length))
        }
        if (best == 0) return 0
        return best + (if (place.id.startsWith("周边/")) 0 else 5) + (4 - (place.tier ?: 3))
    }

    private fun ranked(places: Collection<Place>, said: String) =
        places.map { it to score(it, said) }.filter { it.second > 0 }.sortedWith(compareByDescending<Pair<Place, Int>> { it.second }.thenBy { it.first.id })

    /** The places that answer to a name, best first. */
    fun places(places: Collection<Place>, query: String, limit: Int = 8): List<Place> = ranked(places, plainName(query)).take(limit).map { it.first }

    /** The one place meant by a name or an id, or why it cannot be told. */
    fun meant(places: Collection<Place>, byId: Map<String, Place>, said: String): Place {
        byId[said.trim()]?.let { return it }
        val all = ranked(places, plainName(said))
        val top = all.firstOrNull() ?: error("地图里找不到“$said”。")
        val rivals = all.filter { it.second == top.second && it.first.names.firstOrNull() != top.first.names.firstOrNull() }
        if (top.second < 70 && rivals.isNotEmpty()) error("“$said”可能是：${(listOf(top) + rivals).take(4).joinToString("、") { it.first.names.firstOrNull().orEmpty() }}，说具体一点。")
        return top.first
    }

    /** Metres between two points, on the sphere, as distance in src/campus/map/model/homePolicy.ts. */
    fun metres(a: List<Double>, b: List<Double>): Double {
        val rad = Math.PI / 180
        val h = Math.sin((b[1] - a[1]) * rad / 2).let { it * it } + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2).let { it * it }
        return 6371008.8 * 2 * Math.asin(Math.sqrt(h.coerceIn(0.0, 1.0)))
    }

    /** The places of a kind (a category, or a group of them) around one place, nearest first, with how far each is. */
    fun around(places: Collection<Place>, byId: Map<String, Place>, near: Place, what: String, limit: Int = 8): List<Pair<Place, Long>> {
        val from = near.centre ?: near.parent?.let(byId::get)?.centre ?: error("地图上没有“${near.names.firstOrNull() ?: near.id}”的位置。")
        return places.filter { it.id != near.id && (it.kind == "place" || it.kind == "building") && (it.category == what || it.group == what) && it.centre != null }
            .map { it to Math.round(metres(from, it.centre!)) }
            .sortedWith(compareBy<Pair<Place, Long>> { it.second }.thenBy { it.first.id }).take(limit)
    }
}
