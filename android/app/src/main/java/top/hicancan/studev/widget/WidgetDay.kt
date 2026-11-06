package top.hicancan.studev.widget

import top.hicancan.studev.timetable.CampusDay
import top.hicancan.studev.world.CampusLine
import top.hicancan.studev.world.LineEvent
import top.hicancan.studev.world.Moment
import java.time.Instant

/** What the home-screen widget shows: the rest of today, or tomorrow once today is done. */
object WidgetDay {
    fun of(line: CampusLine, now: Moment): List<LineEvent> =
        line.on(now.date).filter { it.end > now.min }.ifEmpty { line.on(now.date.plusDays(1)) }

    /** The next moment the widget would read differently: a class starting or ending, or midnight. */
    fun nextChange(line: CampusLine, now: Moment): Instant {
        val minute = line.on(now.date).flatMap { listOf(it.start, it.end) }.filter { it > now.min }.minOrNull()
        return if (minute != null) now.date.atStartOfDay(CampusDay.zone).plusMinutes(minute.toLong()).toInstant()
        else now.date.plusDays(1).atStartOfDay(CampusDay.zone).toInstant()
    }
}
