package top.hicancan.studev.home

import top.hicancan.studev.data.OpeningHours
import top.hicancan.studev.data.Place
import java.time.LocalDateTime
import kotlin.math.*

enum class OpenState(val label: String) { Open("营业中"), Closing("即将关闭"), Closed("已关闭"), Unknown("开放时间待确认") }
data class HoursStatus(val state: OpenState, val today: String, val closesAt: String? = null)

/** Endpoints are half open. Overnight hours also consider yesterday, including Sunday. */
fun openingStatus(hours: OpeningHours?, now: LocalDateTime): HoursStatus {
    if (hours == null) return HoursStatus(OpenState.Unknown, "暂未公布开放时间")
    fun minutes(t: String) = t.substringBefore(':').toInt() * 60 + t.substringAfter(':').toInt()
    val day = now.dayOfWeek.value
    val today = hours.week[day.toString()].orEmpty()
    val minute = now.hour * 60 + now.minute
    val intervals = today.map { minutes(it[0]) to (minutes(it[1]).let { end -> if (end <= minutes(it[0])) end + 1440 else end }) } +
        hours.week[(if (day == 1) 7 else day - 1).toString()].orEmpty().mapNotNull {
            val start = minutes(it[0]); val end = minutes(it[1])
            if (end < start) (start - 1440) to end else null
        } + hours.week[(if (day == 7) 1 else day + 1).toString()].orEmpty().map {
            val start = minutes(it[0]); val end = minutes(it[1]); (start + 1440) to (end + if (end <= start) 2880 else 1440)
        }
    val active = intervals.filter { minute >= it.first && minute < it.second }
    // Adjacent/overlapping windows are one opening; don't claim an early closing.
    var end = active.maxOfOrNull { it.second }
    if (end != null) {
        var previous: Int
        do { previous = end!!; end = intervals.filter { it.first <= previous && it.second > minute }.maxOfOrNull { it.second } ?: previous } while (end != previous)
    }
    val text = if (today.isEmpty()) "今日不开放" else today.joinToString("  ·  ") { "${it[0]}–${it[1]}" }
    return HoursStatus(when { end == null -> OpenState.Closed; end - minute <= 30 -> OpenState.Closing; else -> OpenState.Open }, text,
        end?.let { "%02d:%02d".format((it % 1440) / 60, it % 60) })
}

enum class DayMoment(val title: String, val subtitle: String, val categories: List<String>) {
    Morning("早安，开启校园的一天", "上课前，找到你的下一站", listOf("教学楼", "图书馆", "食堂")),
    Lunch("到饭点了，好好吃饭", "附近食堂，今天想吃哪一家", listOf("食堂", "超市")),
    Afternoon("午后，继续探索校园", "学习、运动，让生活更有节奏", listOf("教学楼", "图书馆", "体育")),
    Dinner("晚饭时间，补充能量", "看看附近仍在营业的食堂", listOf("食堂", "超市")),
    Evening("晚上好，留一点时间给自己", "去图书馆，或找一处学习空间", listOf("图书馆", "教学楼", "体育")),
    Night("夜深了，平安回去", "宿舍与仍在营业的便利商店", listOf("宿舍", "超市"));
    companion object { fun at(hour: Int) = when (hour) { in 5..10 -> Morning; in 11..13 -> Lunch; in 14..16 -> Afternoon; in 17..18 -> Dinner; in 19..21 -> Evening; else -> Night } }
}
data class Recommendation(val place: Place, val distance: Double, val status: HoursStatus)

object HomeRecommendations {
    val centre = listOf(top.hicancan.studev.BuildConfig.CAMPUS_LONGITUDE, top.hicancan.studev.BuildConfig.CAMPUS_LATITUDE)
    fun distance(a: List<Double>, b: List<Double>): Double {
        val lat = Math.toRadians(b[1] - a[1]); val lon = Math.toRadians(b[0] - a[0])
        val h = sin(lat / 2).pow(2) + cos(Math.toRadians(a[1])) * cos(Math.toRadians(b[1])) * sin(lon / 2).pow(2)
        return 6371008.8 * 2 * asin(sqrt(h.coerceIn(0.0, 1.0)))
    }
    fun rank(places: List<Place>, now: LocalDateTime, position: List<Double>?, category: String? = null): List<Recommendation> {
        val moment = DayMoment.at(now.hour)
        val shown = mutableMapOf<String?, Int>()
        return places.asSequence().filter { it.kind != "room" && it.centre != null && (if (category != null) it.category == category else it.featured && it.category in moment.categories) }
            .map { Recommendation(it, distance(position ?: centre, it.centre!!), openingStatus(it.hours, now)) }
            .filter { category != null || !(it.place.category in listOf("食堂", "超市") && it.status.state == OpenState.Closed) }
            .sortedWith(compareBy<Recommendation> { if (category != null) 0 else moment.categories.indexOf(it.place.category) }
                .thenBy { when (it.status.state) { OpenState.Open, OpenState.Closing -> 0; OpenState.Unknown -> 1; OpenState.Closed -> 2 } }
                .thenBy { it.distance }.thenBy { it.place.id })
            .filter { if (category != null) true else { val count = shown[it.place.category] ?: 0; shown[it.place.category] = count + 1; count < 3 } }.toList()
    }
}
