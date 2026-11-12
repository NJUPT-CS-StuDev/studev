package top.hicancan.studev.timetable

import kotlinx.serialization.Serializable
import top.hicancan.studev.data.TeachingMeeting
import java.util.Locale

/** The same answers as src/campus/timetable/model/presentation.ts, checked against src/campus/world/parity/golden.json. */
/** A lesson off its week, as src/campus/timetable/model/weekPattern.ts offWeekLessons gives it. */
@Serializable data class OffWeekLesson(val id: String, val day: Int, val periods: List<Int>, val course: String, val room: String, val colourIndex: Int, val label: String)

object TimetablePresentation {
    // Exactly ECMAScript \s, rather than the JVM's different whitespace set.
    private const val whitespaceClass = "[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]"
    private val whitespace = Regex("$whitespaceClass+")
    private val trimWhitespace = Regex("^$whitespaceClass+|$whitespaceClass+$")
    fun identity(code: String?, name: String): String = code?.replace(trimWhitespace, "")?.uppercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } ?: name.replace(whitespace, " ").trim(' ')
    fun identity(meeting: TeachingMeeting): String = identity(meeting.course.code, meeting.course.name)
    fun identity(lab: top.hicancan.studev.data.Lab): String = identity(lab.course.code, lab.course.name)
    /** Where each tone sits on the hue circle, in 30° steps; same as src/campus/timetable/model/courseColors.ts. */
    private val tonePosition = listOf(7, 5, 4, 3, 2, 1, 0, 11, 10, 9, 8, 6)
    /** Which tone to prefer when all else is equal: the first three 120° apart, the first six 60° apart. */
    private val toneOrder = listOf(0, 7, 3, 9, 5, 1, 10, 6, 2, 8, 4, 11)
    private fun apart(left: Int, right: Int) = kotlin.math.abs(tonePosition[left] - tonePosition[right]).let { minOf(it, tonePosition.size - it) }
    /** One timetable's colours: courses meeting on the same day get different tones, at least one tone apart
     *  where they can; a tone is shared only by courses that never meet on the same day. */
    fun tones(meetings: List<TeachingMeeting>): Map<String, Int> = allot(meetings.map { identity(it) to it.weekday })
    /** One timeline's colours: a lab takes its course's tone, and a course that only has labs gets one too. */
    fun tones(line: top.hicancan.studev.world.CampusLine): Map<String, Int> = allot(line.meetings.map { identity(it) to it.weekday } + line.labs.map { linked(it, line.meetings) to it.weekday })
    /**
     * A lab belongs to a lesson's course when the two carry the same course code, or the same name: the lab sheet often
     * gives a lab its own code (Linux 编程 labs are B0301371S, its lessons JS113701S), never a different name.
     */
    fun sameCourse(lab: top.hicancan.studev.data.Lab, meeting: TeachingMeeting) = sameCourse(lab.course.code, lab.course.name, meeting)
    fun sameCourse(code: String?, name: String, meeting: TeachingMeeting) = identity(code, name) == identity(meeting) ||
        top.hicancan.studev.world.Names.course(name).lowercase(Locale.ROOT) == top.hicancan.studev.world.Names.course(meeting.course.name).lowercase(Locale.ROOT)
    /** The course a lab's (or an exam's) colour, links and name follow: that of the lesson it belongs to, or its own. */
    fun linked(lab: top.hicancan.studev.data.Lab, meetings: List<TeachingMeeting>) = linked(lab.course.code, lab.course.name, meetings)
    fun linked(code: String?, name: String, meetings: List<TeachingMeeting>) = meetings.firstOrNull { sameCourse(code, name, it) }?.let(::identity) ?: identity(code, name)
    /** The tone of something on a timeline: a lesson's own, a lab its course's. */
    fun toneOf(event: top.hicancan.studev.world.LineEvent, tones: Map<String, Int>, meetings: List<TeachingMeeting>) =
        event.meeting?.let { tones[identity(it)] } ?: event.lab?.let { tones[linked(it, meetings)] }
    private fun allot(courses: List<Pair<String, Int>>): Map<String, Int> {
        val days = courses.groupBy({ it.first }, { it.second }).mapValues { (_, rows) -> rows.toSet() }
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
    private fun alternating(weeks: List<Int>): String? = if (weeks.size >= 2 && weeks.all { it % 2 == weeks.first() % 2 }) {
        if (weeks.first() % 2 == 1) "单周" else "双周"
    } else null
    /** A lesson within its run of weeks that does not meet this week: it keeps its place, greyed. */
    private fun offThisWeek(meeting: TeachingMeeting, week: Int) = week !in meeting.weeks && week in meeting.weeks.min()..meeting.weeks.max()
    /**
     * The lessons of a week that do not meet that week, within their run of weeks: a hint of what is usually there,
     * greyed in place. One that would overlap an earlier one is left out; the view leaves out any that would overlap
     * something on that week, and the lesson in front names it in its sheet.
     */
    fun offWeekLessons(meetings: List<TeachingMeeting>, week: Int, tones: Map<String, Int>): List<OffWeekLesson> {
        val kept = mutableListOf<TeachingMeeting>()
        meetings.filter { offThisWeek(it, week) }
            .sortedWith(compareBy<TeachingMeeting> { it.weekday }.thenBy { it.periods.first() }.thenBy { it.periods.last() }.thenBy { it.id })
            .forEach { meeting -> if (kept.none { it.weekday == meeting.weekday && it.periods.first() <= meeting.periods.last() && meeting.periods.first() <= it.periods.last() }) kept += meeting }
        return kept.map { meeting ->
            OffWeekLesson(meeting.id, meeting.weekday, meeting.periods, meeting.course.name, meeting.room?.let(top.hicancan.studev.world.Names::room).orEmpty(),
                tones.getValue(identity(meeting)), listOfNotNull(alternating(meeting.weeks), "本周不上课").joinToString(" · "))
        }
    }
}
