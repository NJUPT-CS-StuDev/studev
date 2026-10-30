package top.hicancan.studev.timetable

import kotlinx.serialization.Serializable
import top.hicancan.studev.data.TeachingMeeting
import java.util.Locale

/** Contract + actual input/output examples: src/campus/academics/parity/spec.json. */
@Serializable data class TimetableCell(
    val id: String, val day: Int, val periods: List<Int>, val course: String, val room: String,
    val state: String, val colourIndex: Int, val note: String, val label: String,
    val slot: Int, val columns: Int, val overlap: String, val overlapCount: Int,
)

object TimetablePresentation {
    // Exactly ECMAScript \s, rather than the JVM's different whitespace set.
    private const val whitespaceClass = "[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]"
    private val whitespace = Regex("$whitespaceClass+")
    private val trimWhitespace = Regex("^$whitespaceClass+|$whitespaceClass+$")
    fun identity(meeting: TeachingMeeting): String = meeting.course.code?.replace(trimWhitespace, "")?.uppercase(Locale.ROOT)?.takeIf { it.isNotEmpty() }
        ?: meeting.course.name.replace(whitespace, " ").trim(' ')
    fun colourIndex(meeting: TeachingMeeting): Int {
        var hash = 2166136261L.toInt()
        identity(meeting).codePoints().forEach { hash = (hash xor it) * 16777619 }
        return (hash.toUInt() % 12u).toInt()
    }
    fun alternating(weeks: List<Int>): String? = if (weeks.size >= 2 && weeks.all { it % 2 == weeks.first() % 2 }) {
        if (weeks.first() % 2 == 1) "单周" else "双周"
    } else null
    fun suspendedWeeks(weeks: List<Int>): List<Int> {
        val sorted = weeks.distinct().sorted()
        if (sorted.size < 4) return emptyList()
        for (step in listOf(1, 2)) {
            if (step == 2 && sorted.any { (it - sorted.first()) % 2 != 0 }) continue
            val expected = (sorted.first()..sorted.last() step step).toList()
            val missing = expected.filter { it !in sorted }
            if (step == 1 && missing.size > 2) continue
            if (missing.size in 1..2 && expected.size - missing.size >= 3) return missing
            if (missing.isEmpty()) return emptyList()
        }
        return emptyList()
    }
    fun state(meeting: TeachingMeeting, week: Int): String = when {
        week in meeting.weeks -> "active"
        week in suspendedWeeks(meeting.weeks) -> "suspended"
        alternating(meeting.weeks) != null && week >= meeting.weeks.min() - 1 && week <= meeting.weeks.max() + 1 -> "inactive"
        else -> "hidden"
    }
    fun note(meeting: TeachingMeeting): String = listOfNotNull(
        if (meeting.location == "翻转课堂线上自学") "翻转课堂 · 线上自学" else null,
        meeting.method?.takeIf { it != "面授讲课" }?.trim()?.takeIf { it.isNotEmpty() },
    ).joinToString(" · ")
    fun room(meeting: TeachingMeeting): String = if (meeting.location == "翻转课堂线上自学") "" else meeting.location ?: meeting.room.orEmpty()
    private fun intersects(a: TeachingMeeting, b: TeachingMeeting) = a.weekday == b.weekday && a.periods.first() <= b.periods.last() && a.periods.last() >= b.periods.first()
    fun cells(meetings: List<TeachingMeeting>, week: Int): List<TimetableCell> = buildList {
        val active = meetings.filter { week in it.weeks }
        (1..7).forEach { day ->
            val sorted = meetings.filter { it.weekday == day && state(it, week) != "hidden" }
                .sortedWith(compareBy<TeachingMeeting> { it.periods.first() }.thenBy { it.periods.last() }.thenBy { it.id })
            val component = mutableListOf<TeachingMeeting>()
            var componentEnd = 0
            fun flush() {
                if (component.isEmpty()) return
                val slotEnds = mutableListOf<Int>()
                val positioned = component.map { meeting ->
                    val slot = slotEnds.indexOfFirst { it < meeting.periods.first() }.let { if (it < 0) slotEnds.size else it }
                    if (slot == slotEnds.size) slotEnds.add(meeting.periods.last()) else slotEnds[slot] = meeting.periods.last()
                    meeting to slot
                }
                positioned.forEach { (meeting, slot) ->
                    val state = state(meeting, week)
                    val overlap = if (state == "active") active.filter { intersects(it, meeting) } else emptyList()
                    val kind = if (overlap.size <= 1) "" else if (overlap.all { identity(it) == identity(meeting) }) "parallel" else "overlap"
                    val count = if (kind.isEmpty()) 0 else overlap.size
                    val label = when (state) {
                        "suspended" -> "本周停课"
                        "inactive" -> "${alternating(meeting.weeks).orEmpty()} · 本周不上课"
                        else -> if (kind.isNotEmpty()) "${if (kind == "parallel") "并行" else "重叠"} $count 项" else ""
                    }
                    add(TimetableCell(meeting.id, day, meeting.periods, meeting.course.name, room(meeting), state,
                        colourIndex(meeting), note(meeting), label, slot, slotEnds.size, kind, count))
                }
                component.clear(); componentEnd = 0
            }
            sorted.forEach { meeting ->
                if (component.isNotEmpty() && meeting.periods.first() > componentEnd) flush()
                component.add(meeting); componentEnd = maxOf(componentEnd, meeting.periods.last())
            }
            flush()
        }
    }
}
