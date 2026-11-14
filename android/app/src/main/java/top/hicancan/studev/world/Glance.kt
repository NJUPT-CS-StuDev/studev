package top.hicancan.studev.world

import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * What a glance outside the app shows: the home-screen widgets here and the desktop widgets on Windows read the same
 * line through the same rules as src/campus/world/glance.ts, locked by the parity golden. The calendar glance shows a
 * day, a week or the term; the list glance shows what is due and the exams ahead.
 */
object Glance {
    const val HORIZON = 30
    const val EXAM_DAYS = 14

    data class Day(val date: LocalDate, val events: List<LineEvent>)
    data class TermDay(val date: LocalDate, val lessons: Int, val exam: Boolean, val off: Boolean)
    data class TermWeek(val week: Int, val start: LocalDate, val days: List<TermDay>)
    data class ExamDay(val date: LocalDate, val days: Int, val events: List<LineEvent>)

    private fun open(event: LineEvent) = event.kind != "run" && event.task?.done == null

    /** The rest of today, or the next day that has something. */
    fun day(line: CampusLine, now: Moment): Day {
        val left = line.on(now.date).filter { open(it) && it.end > now.min }
        if (left.isNotEmpty()) return Day(now.date, left)
        for (offset in 1..HORIZON) {
            val date = now.date.plusDays(offset.toLong())
            val events = line.on(date).filter(::open)
            if (events.isNotEmpty()) return Day(date, events)
        }
        return Day(now.date, emptyList())
    }

    /** The week shown, Monday to Sunday, the weekend only when something happens on it. */
    fun week(line: CampusLine, now: Moment): List<Day> {
        val monday = line.weekShown(now)
        return (0L until 7L).map { monday.plusDays(it) }.map { date -> Day(date, line.on(date).filter(::open)) }
            .filter { it.date.dayOfWeek.value <= 5 || it.events.isNotEmpty() }
    }

    /** The term as weeks of days: lessons on each, an exam, a day off. */
    fun term(line: CampusLine): List<TermWeek> = line.term.weeks.map { week ->
        val first = LocalDate.parse(week.start)
        val start = first.minusDays(first.dayOfWeek.value - 1L)
        TermWeek(week.week, start, (0L until 7L).map { start.plusDays(it) }.map { date ->
            val events = line.on(date)
            TermDay(date, events.count { it.kind == "class" || it.kind == "lab" }, events.any { it.kind == "exam" }, line.holidays.containsKey(date))
        })
    }

    /** The groups of the app's own list a glance shows: what is late and what falls in the coming week. */
    val GROUPS = listOf("overdue", "today", "tomorrow", "week")

    /** Open tasks late or falling in the coming week, planned or due, in the list's own groups and order. */
    fun due(line: CampusLine, now: Moment): List<Task> =
        line.tasks.filter { it.parent == null && it.deleted != true && it.done == null && Tasks.group(it, now) in GROUPS }.sortedWith(Tasks.order)

    /** Exams in the next two weeks, after today. */
    fun exams(line: CampusLine, now: Moment): List<ExamDay> = line.exams.map { LocalDate.parse(it.date) }.distinct().sorted()
        .map { it to ChronoUnit.DAYS.between(now.date, it).toInt() }.filter { (_, away) -> away in 1..EXAM_DAYS }
        .map { (date, away) -> ExamDay(date, away, line.on(date).filter { it.kind == "exam" }) }

    /** The next moment a glance reads differently: something starting or ending today, else the next midnight. */
    fun nextChange(line: CampusLine, now: Moment): Moment =
        line.on(now.date).flatMap { listOf(it.start, it.end) }.filter { it > now.min }.minOrNull()?.let { Moment(now.date, it) } ?: Moment(now.date.plusDays(1), 0)
}
