package top.hicancan.studev.world

import java.time.LocalDate

data class SlotRequest(val from: LocalDate, val to: LocalDate, val minutes: Int, val earliest: Int = 480, val latest: Int = 1320, val exclude: String? = null, val due: TaskDeadline? = null)
data class TimeSlot(val date: LocalDate, val start: Int, val end: Int, val clashes: List<String>, val penalty: Int)

/** Same scheduling rule as world/planning.ts: attendance and attitude matter; drawing order does not. */
object Planning {
    fun available(line: CampusLine, request: SlotRequest, now: Moment): List<TimeSlot> {
        if (request.minutes !in 1..840 || request.from > request.to) return emptyList()
        val out = mutableListOf<TimeSlot>()
        var date = request.from
        repeat(60) {
            if (date > request.to) return@repeat
            if (date >= now.date && (request.due == null || date.toString() <= request.due.date)) {
                val earliest = maxOf(request.earliest, if (date == now.date) now.min else 0)
                val latest = minOf(request.latest, if (request.due?.date == date.toString()) request.due.time ?: 1440 else 1440)
                val events = line.on(date).filter { it.id != request.exclude && it.task?.done == null }
                val starts = events.map { it.end }.toMutableSet()
                starts += earliest
                var min = ((earliest + 14) / 15) * 15
                while (min + request.minutes <= latest) { starts += min; min += 15 }
                for (start in starts) {
                    val end = start + request.minutes
                    if (start < earliest || end > latest) continue
                    val clashes = events.filter { it.start < end && start < it.end }
                    if (clashes.any { it.avoid == "must" }) continue
                    val soft = clashes.filter { it.avoid != "allow" }
                    out += TimeSlot(date, start, end, soft.map { it.id }.sorted(), soft.sumOf { minOf(end, it.end) - maxOf(start, it.start) })
                }
            }
            date = date.plusDays(1)
        }
        return out.sortedWith(compareBy<TimeSlot> { it.penalty }.thenBy { it.date }.thenBy { it.start })
    }
}
