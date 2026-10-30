package top.hicancan.studev.widget

import top.hicancan.studev.timetable.CampusDay
import top.hicancan.studev.timetable.CampusEvent
import java.time.Instant
import java.time.format.DateTimeFormatter

/** A presentation of published events and the kernel's walking duration. */
object WidgetLesson {
    const val BUFFER_MINUTES = 3
    fun next(events: List<CampusEvent>, now: Instant): CampusEvent? {
        val tomorrow = now.atZone(CampusDay.zone).toLocalDate().plusDays(1)
        return events.filter { it.end > now && it.start.atZone(CampusDay.zone).toLocalDate() <= tomorrow }.minByOrNull { it.start }
    }
    fun departure(event: CampusEvent, walkMinutes: Int) = event.start.minusSeconds((walkMinutes + BUFFER_MINUTES) * 60L)
    fun headline(event: CampusEvent, now: Instant, walkMinutes: Int?): String {
        val prefix = if (event.start.atZone(CampusDay.zone).toLocalDate() > now.atZone(CampusDay.zone).toLocalDate()) "明天 " else ""
        if (event.start <= now) return if (event.exam) "考试进行中" else "正在上课"
        val time = (walkMinutes?.let { departure(event, it) } ?: event.start).atZone(CampusDay.zone).format(DateTimeFormatter.ofPattern("HH:mm"))
        return prefix + time + if (walkMinutes != null) " 出门" else if (event.exam) " 考试" else " 上课"
    }
    fun detail(event: CampusEvent): String = listOf(event.title, event.room ?: event.location ?: "地点待公布",
        event.start.atZone(CampusDay.zone).format(DateTimeFormatter.ofPattern("HH:mm")) + if (event.exam) " 考试" else " 上课").joinToString(" · ")
    fun refreshAt(events: List<CampusEvent>, now: Instant): Instant {
        val midnight = now.atZone(CampusDay.zone).toLocalDate().plusDays(1).atStartOfDay(CampusDay.zone).toInstant()
        return (events.flatMap { listOf(it.start, it.end) }.filter { it > now } + midnight).min()
    }
}
