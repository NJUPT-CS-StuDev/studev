package top.hicancan.studev.map

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import top.hicancan.studev.data.OpeningHours
import top.hicancan.studev.data.Place

/** Where to go at a moment. The web's homePolicy.ts is the reference; the same golden cases pass here. */
object Recommendations {
    enum class Open(val label: String) { Open("营业中"), Closing("即将关闭"), Closed("已关闭"), Unknown("") }
    data class Item(val place: Place, val metres: Double, val status: Open)

    private fun clock(value: String) = value.split(":").let { it[0].toInt() * 60 + it[1].toInt() }

    /** Whether a place is open, its hours today and when it closes, as openingStatus in src/campus/map/model/homePolicy.ts. */
    data class Hours(val open: Open, val today: String, val closesAt: String?)

    fun status(hours: OpeningHours?, day: Int, minute: Int): Open = hoursAt(hours, day, minute).open

    /** Half-open intervals, closing 30 minutes before the end, overnight windows carried from the day before. */
    fun hoursAt(hours: OpeningHours?, day: Int, minute: Int): Hours {
        if (hours == null) return Hours(Open.Unknown, "", null)
        val todays = hours.week[day.toString()].orEmpty()
        val today = if (todays.isEmpty()) "今日不开放" else todays.joinToString(" · ") { it.joinToString("–") }
        val intervals = mutableListOf<Pair<Int, Int>>()
        hours.week[day.toString()].orEmpty().forEach { val start = clock(it[0]); val end = clock(it[1]); intervals += start to if (end <= start) end + 1440 else end }
        hours.week[(if (day == 1) 7 else day - 1).toString()].orEmpty().forEach { val start = clock(it[0]); val end = clock(it[1]); if (end < start) intervals += start - 1440 to end }
        hours.week[(if (day == 7) 1 else day + 1).toString()].orEmpty().forEach { val start = clock(it[0]); val end = clock(it[1]); intervals += start + 1440 to end + if (end <= start) 2880 else 1440 }
        var end = intervals.filter { minute >= it.first && minute < it.second }.maxOfOrNull { it.second } ?: return Hours(Open.Closed, today, null)
        while (true) {
            val next = max(end, intervals.filter { it.first <= end && it.second > minute }.maxOfOrNull { it.second } ?: end)
            if (next == end) break
            end = next
        }
        return Hours(if (end - minute <= 30) Open.Closing else Open.Open, today, "%02d:%02d".format((end % 1440) / 60, end % 60))
    }

    /** Where people on campus go at each part of the day, most likely first, as categories of the map's vocabulary. */
    fun categories(hour: Int) = when (hour) {
        in 5..10 -> listOf("教学楼", "图书馆", "食堂")
        in 11..13 -> listOf("食堂", "超市便利")
        in 14..16 -> listOf("教学楼", "图书馆", "体育")
        in 17..18 -> listOf("食堂", "超市便利")
        in 19..21 -> listOf("图书馆", "教学楼", "体育")
        else -> listOf("宿舍", "超市便利")
    }
    /** What closes and is then no use to suggest. */
    private val CLOSES = setOf("食堂", "超市便利")

    private fun metres(a: List<Double>, b: List<Double>): Double {
        val rad = Math.PI / 180
        val h = sin((b[1] - a[1]) * rad / 2).pow(2) + cos(a[1] * rad) * cos(b[1] * rad) * sin((b[0] - a[0]) * rad / 2).pow(2)
        return 6371008.8 * 2 * asin(sqrt(max(0.0, min(1.0, h))))
    }

    fun of(places: Collection<Place>, day: Int, minute: Int, from: List<Double>): List<Item> {
        val order = categories(minute / 60)
        val rank = mapOf(Open.Open to 0, Open.Closing to 0, Open.Unknown to 1, Open.Closed to 2)
        val shown = mutableMapOf<String?, Int>()
        return places.filter { (it.kind == "building" || it.kind == "place") && it.centre != null && it.id.startsWith("${top.hicancan.studev.BuildConfig.DEFAULT_CAMPUS}/") && it.category in order }
            .map { Item(it, metres(from, it.centre!!), status(it.hours, day, minute)) }
            .filterNot { it.place.category in CLOSES && it.status == Open.Closed }
            .sortedWith(compareBy<Item>({ order.indexOf(it.place.category) }, { rank.getValue(it.status) }, { it.metres }, { it.place.id }))
            .filter { item -> val count = shown[item.place.category] ?: 0; shown[item.place.category] = count + 1; count < 3 }
    }
}
