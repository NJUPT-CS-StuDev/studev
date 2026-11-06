package top.hicancan.studev.world

import top.hicancan.studev.data.*
import java.time.*

/** Presentation of published intervals. No academic dates or occupancy are inferred. */
object CampusDay {
    val zone: ZoneId = ZoneId.of(top.hicancan.studev.BuildConfig.CAMPUS_TIME_ZONE)
    fun now(clock: Clock = Clock.systemUTC()): ZonedDateTime = clock.instant().atZone(zone)
    fun weekOf(weeks: List<TeachingWeek>, date: LocalDate): TeachingWeek? = weeks.find { date.toString() >= it.start && date.toString() <= it.end }
    fun weekday(week: TeachingWeek, date: LocalDate) = java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(week.start), date).toInt() + 1
    fun clamp(weeks: List<TeachingWeek>, date: LocalDate): LocalDate = if (weeks.isEmpty()) date else date.coerceIn(LocalDate.parse(weeks.first().start), LocalDate.parse(weeks.last().end))
}
