package top.hicancan.studev.timetable

import top.hicancan.studev.data.*
import java.time.*
import java.text.Normalizer
import java.util.Locale

/** Presentation of published intervals. No academic dates or occupancy are inferred. */
object CampusDay {
    val zone: ZoneId = ZoneId.of("Asia/Shanghai")
    fun now(clock: Clock = Clock.systemUTC()): ZonedDateTime = clock.instant().atZone(zone)
    fun weekOf(weeks: List<TeachingWeek>, date: LocalDate): TeachingWeek? = weeks.find { date.toString() >= it.start && date.toString() <= it.end }
    fun weekday(week: TeachingWeek, date: LocalDate) = java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(week.start), date).toInt() + 1
    fun clamp(weeks: List<TeachingWeek>, date: LocalDate): LocalDate = if (weeks.isEmpty()) date else date.coerceIn(LocalDate.parse(weeks.first().start), LocalDate.parse(weeks.last().end))
    fun periodAt(periods: List<TeachingPeriod>, time: LocalTime): Int {
        val sorted = periods.sortedBy { it.period }
        return (sorted.find { time >= LocalTime.parse(it.start) && time <= LocalTime.parse(it.end) }
            ?: sorted.find { LocalTime.parse(it.start) > time } ?: sorted.lastOrNull())?.period ?: 1
    }
    fun isFree(day: RoomDay, room: String, from: Int, to: Int = from): Boolean = (from..to).all { p ->
        day.free?.let { room in it[p.toString()].orEmpty() } ?: day.occupied[room].orEmpty().none { p in it.periods.first()..it.periods.last() }
    }
    fun occupants(day: RoomDay, room: String, period: Int): List<RoomOccupant>? = if (isFree(day, room, period)) emptyList()
        else day.occupied[room].orEmpty().filter { period in it.periods.first()..it.periods.last() }.ifEmpty { null }
    fun freeRun(day: RoomDay, room: String, from: Int, last: Int) = (from..last).takeWhile { isFree(day, room, it) }.size
    private fun fold(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKC).lowercase(Locale.ROOT).replace(Regex("[－—–\\s]"), "")
    fun roomMatches(room: Room, query: String) = (listOf(room.id, room.number, room.building, room.building + room.number) + room.names).any { fold(it).contains(fold(query)) }
    fun eligible(room: Room, everything: Boolean = false) = room.listed && (everything || room.kinds.any { kind -> listOf("多媒体", "非多媒体", "翻转课堂").any(kind::contains) })
}

data class CampusEvent(val id: String, val title: String, val start: Instant, val end: Instant, val room: String?, val location: String?, val description: String, val exam: Boolean)
object CampusEvents {
    fun build(term: TeachingTerm, periods: List<TeachingPeriod>, schedule: ClassSchedule?, exams: List<Exam>): List<CampusEvent> = buildList {
        schedule?.meetings?.forEach { meeting ->
            val start = periods.find { it.period == meeting.periods.first() } ?: return@forEach
            val end = periods.find { it.period == meeting.periods.last() } ?: return@forEach
            meeting.weeks.forEach weeks@{ number ->
                val week = term.weeks.find { it.week == number } ?: return@weeks
                val date = LocalDate.parse(week.start).plusDays((meeting.weekday - 1).toLong())
                add(CampusEvent("lesson:${term.term}:${meeting.id}:$number", meeting.course.name,
                    date.atTime(LocalTime.parse(start.start)).atZone(CampusDay.zone).toInstant(),
                    date.atTime(LocalTime.parse(end.end)).atZone(CampusDay.zone).toInstant(), meeting.room, meeting.location,
                    "${schedule.klass.name} · " + meeting.teachers.filter { number in it.weeks }.joinToString("、") { it.name }, false))
            }
        }
        exams.forEach { exam ->
            val date = LocalDate.parse(exam.date)
            add(CampusEvent("exam:${exam.id}", exam.course.name,
                date.atTime(LocalTime.parse(exam.start)).atZone(CampusDay.zone).toInstant(),
                date.atTime(LocalTime.parse(exam.end)).atZone(CampusDay.zone).toInstant(), exam.room, exam.location,
                listOfNotNull(exam.klass, exam.teacher, exam.note).joinToString(" · "), true))
        }
    }.distinctBy { it.id }.sortedBy { it.start }
}
