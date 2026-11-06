package top.hicancan.studev.timetable

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

data class CampusEvent(val id: String, val title: String, val start: Instant, val end: Instant, val room: String?, val description: String, val exam: Boolean)
object CampusEvents {
    fun build(term: TeachingTerm, periods: List<TeachingPeriod>, schedule: ClassSchedule?, exams: List<Exam>, holidays: Set<LocalDate> = emptySet()): List<CampusEvent> = buildList {
        schedule?.meetings?.forEach { meeting ->
            val start = periods.find { it.period == meeting.periods.first() } ?: return@forEach
            val end = periods.find { it.period == meeting.periods.last() } ?: return@forEach
            meeting.weeks.forEach weeks@{ number ->
                val week = term.weeks.find { it.week == number } ?: return@weeks
                val date = LocalDate.parse(week.start).plusDays((meeting.weekday - 1).toLong())
                if (date in holidays) return@weeks
                add(CampusEvent("lesson:${term.term}:${meeting.id}:$number", meeting.course.name,
                    date.atTime(LocalTime.parse(start.start)).atZone(CampusDay.zone).toInstant(),
                    date.atTime(LocalTime.parse(end.end)).atZone(CampusDay.zone).toInstant(), meeting.room,
                    "${schedule.klass.name} · " + meeting.teachers.filter { number in it.weeks }.joinToString("、") { it.name }, false))
            }
        }
        exams.forEach { exam ->
            val interval = runCatching {
                val date = LocalDate.parse(exam.date)
                val start = date.atTime(LocalTime.parse(exam.start)).atZone(CampusDay.zone).toInstant()
                val end = date.atTime(LocalTime.parse(exam.end)).atZone(CampusDay.zone).toInstant()
                require(end > start)
                start to end
            }.getOrNull() ?: return@forEach
            add(CampusEvent("exam:${exam.id}", exam.course.name,
                interval.first, interval.second, exam.room,
                listOfNotNull(exam.klass, exam.teacher, exam.note).joinToString(" · "), true))
        }
    }.distinctBy { it.id }.sortedBy { it.start }
}
