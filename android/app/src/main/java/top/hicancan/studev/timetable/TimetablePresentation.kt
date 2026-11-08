package top.hicancan.studev.timetable

import kotlinx.serialization.Serializable
import top.hicancan.studev.data.TeachingMeeting
import java.util.Locale

/** The same answers as src/campus/timetable/model/presentation.ts, checked against src/campus/world/parity/golden.json. */
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
    /** Where each tone sits on the hue circle, in 30° steps; same as src/campus/timetable/model/courseColors.ts. */
    private val tonePosition = listOf(7, 5, 4, 3, 2, 1, 0, 11, 10, 9, 8, 6)
    /** Which tone to prefer when all else is equal: the first three 120° apart, the first six 60° apart. */
    private val toneOrder = listOf(0, 7, 3, 9, 5, 1, 10, 6, 2, 8, 4, 11)
    private fun apart(left: Int, right: Int) = kotlin.math.abs(tonePosition[left] - tonePosition[right]).let { minOf(it, tonePosition.size - it) }
    /** One timetable's colours: courses meeting on the same day get different tones, at least one tone apart
     *  where they can; a tone is shared only by courses that never meet on the same day. */
    fun tones(meetings: List<TeachingMeeting>): Map<String, Int> {
        val days = meetings.groupBy(::identity).mapValues { (_, rows) -> rows.map { it.weekday }.toSet() }
        val ids = days.keys.sorted()
        val neighbours = ids.associateWith { id -> ids.filter { other -> other != id && days.getValue(id).any { it in days.getValue(other) } } }
        val tones = mutableMapOf<String, Int>()
        val used = IntArray(tonePosition.size)
        for (id in ids.sortedWith(compareByDescending<String> { neighbours.getValue(it).size }.thenBy { it })) {
            val near = neighbours.getValue(id).mapNotNull { tones[it] }
            fun score(tone: Int) = listOf(if (tone in near) 0 else 1, (near.map { apart(tone, it) } + 2).min(), -used[tone], -toneOrder.indexOf(tone))
            var best = toneOrder.first()
            for (tone in toneOrder) {
                val (left, right) = score(tone) to score(best)
                val at = left.indices.firstOrNull { left[it] != right[it] }
                if (at != null && left[at] > right[at]) best = tone
            }
            tones[id] = best
            used[best]++
        }
        return tones
    }
    fun alternating(weeks: List<Int>): String? = if (weeks.size >= 2 && weeks.all { it % 2 == weeks.first() % 2 }) {
        if (weeks.first() % 2 == 1) "单周" else "双周"
    } else null
    /** On this week, off this week within its run of weeks (greyed in place), or not shown. */
    fun state(meeting: TeachingMeeting, week: Int): String = when {
        week in meeting.weeks -> "active"
        week in meeting.weeks.min()..meeting.weeks.max() -> "off"
        else -> "hidden"
    }
    fun note(meeting: TeachingMeeting): String = listOfNotNull(
        if (meeting.room == "翻转课堂线上自学") "翻转课堂 · 线上自学" else null,
        meeting.method?.takeIf { it != "面授讲课" }?.trim()?.takeIf { it.isNotEmpty() },
    ).joinToString(" · ")
    fun room(meeting: TeachingMeeting): String = if (meeting.room == "翻转课堂线上自学") "" else meeting.room?.let(top.hicancan.studev.world.Names::room).orEmpty()
    private fun intersects(a: TeachingMeeting, b: TeachingMeeting) = a.weekday == b.weekday && a.periods.first() <= b.periods.last() && a.periods.last() >= b.periods.first()
    fun cells(meetings: List<TeachingMeeting>, week: Int): List<TimetableCell> = buildList {
        val tones = tones(meetings)
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
                    val label = if (state == "off") listOfNotNull(alternating(meeting.weeks), "本周不上课").joinToString(" · ")
                        else if (kind.isNotEmpty()) "${if (kind == "parallel") "并行" else "重叠"} $count 项" else ""
                    add(TimetableCell(meeting.id, day, meeting.periods, meeting.course.name, room(meeting), state,
                        tones.getValue(identity(meeting)), note(meeting), label, slot, slotEnds.size, kind, count))
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
