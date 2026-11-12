package top.hicancan.studev.widget

import top.hicancan.studev.world.CampusDay
import top.hicancan.studev.world.CampusLine
import top.hicancan.studev.world.LineEvent
import top.hicancan.studev.world.Moment
import java.time.Instant
import java.time.LocalDate

/** What the home-screen widget shows: the rest of today, or the next day that has something. */
object WidgetDay {
    fun of(line: CampusLine, now: Moment): List<LineEvent> =
        line.on(now.date).filter { it.end > now.min && it.task?.done == null }.ifEmpty {
            generateSequence(now.date.plusDays(1)) { it.plusDays(1) }.take(30).map { day -> line.on(day).filter { it.task?.done == null } }.firstOrNull { it.isNotEmpty() }.orEmpty()
        }

    /** The week a "now" view shows (what is left of this one, or the next one once it is over), Monday to
     *  Sunday, Saturday and Sunday only when something happens on them. */
    fun week(line: CampusLine, now: Moment): List<Pair<LocalDate, List<LineEvent>>> {
        val monday = line.weekShown(now)
        val days = (0L until 7L).map { monday.plusDays(it) }.map { date -> date to line.on(date).filter { it.task?.done == null } }
        return days.filter { (date, events) -> date.dayOfWeek.value <= 5 || events.isNotEmpty() }
    }

    /** The next moment the widget would read differently: a class starting or ending, or midnight. */
    fun nextChange(line: CampusLine, now: Moment): Instant {
        val minute = line.on(now.date).flatMap { listOf(it.start, it.end) }.filter { it > now.min }.minOrNull()
        return if (minute != null) now.date.atStartOfDay(CampusDay.zone).plusMinutes(minute.toLong()).toInstant()
        else now.date.plusDays(1).atStartOfDay(CampusDay.zone).toInstant()
    }
}
