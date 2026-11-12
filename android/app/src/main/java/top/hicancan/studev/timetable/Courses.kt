package top.hicancan.studev.timetable

import kotlinx.serialization.Serializable
import top.hicancan.studev.data.Course
import top.hicancan.studev.data.Exam
import top.hicancan.studev.data.ExamCourse
import top.hicancan.studev.data.Lab
import top.hicancan.studev.data.TeachingGroup
import top.hicancan.studev.data.TeachingMeeting
import top.hicancan.studev.data.Teacher
import top.hicancan.studev.world.CampusLine

/**
 * A course of one's own, the same as src/campus/timetable/model/courses.ts: an elective, a lab the sheets miss, a
 * practical that takes the week. It becomes ordinary meetings, so everything a timetable does works on it unchanged.
 */
@Serializable data class CustomCourse(
    val id: String,
    val name: String,
    /** The weekdays it meets, 1 for Monday. */
    val days: List<Int>,
    val periods: List<Int>,
    val weeks: List<Int>,
    val room: String? = null,
    val teacher: String? = null,
)

object Courses {
    /** A course of one's own as the meetings a timetable draws, one for each of its days. */
    fun meetings(course: CustomCourse): List<TeachingMeeting> = course.days.map { day ->
        TeachingMeeting(
            id = "custom:${course.id}:$day",
            course = Course(null, course.name, null, null, null, null, null, null, null),
            teachers = course.teacher?.let { listOf(Teacher(it, it, null, null, course.weeks)) }.orEmpty(),
            teaching_class = TeachingGroup("custom:${course.id}"),
            campus = null, room = course.room, location = course.room, weekday = day, periods = course.periods, weeks = course.weeks,
            method = null, classes = emptyList(), kind = "event", subtype = "meeting",
        )
    }
    fun isCustom(teachingClass: String) = teachingClass.startsWith("custom:")

    /** A lesson under the name its person gave its course, if they gave one. */
    fun renamed(meeting: TeachingMeeting, names: Map<String, String>): TeachingMeeting =
        names[TimetablePresentation.identity(meeting)]?.let { meeting.copy(course = meeting.course.copy(name = it)) } ?: meeting
    /** A lab under the name its person gave the course it belongs to. */
    fun renamed(lab: Lab, meetings: List<TeachingMeeting>, names: Map<String, String>): Lab =
        names[TimetablePresentation.linked(lab, meetings)]?.let { lab.copy(course = lab.course.copy(name = it)) } ?: lab
    /** An exam under the name its person gave the course it belongs to. */
    fun renamed(exam: Exam, meetings: List<TeachingMeeting>, names: Map<String, String>): Exam =
        names[TimetablePresentation.linked(exam.course.code, exam.course.name, meetings)]?.let { exam.copy(course = ExamCourse(exam.course.code, it)) } ?: exam

    /** A timeline as its person names things: every lesson, lab and exam under the name they gave its course. */
    fun named(line: CampusLine, names: Map<String, String>): CampusLine = if (names.isEmpty()) line else CampusLine(
        line.term, line.periods, line.meetings.map { renamed(it, names) }, line.labs.map { renamed(it, line.meetings, names) },
        line.exams.map { renamed(it, line.meetings, names) }, line.holidays, line.run, line.tasks,
    )

    /** "1-16", "1-8,10,12-14", "单1-15", "双 2-16": the weeks written; null when the text is not weeks. */
    fun parseWeeks(text: String, last: Int): List<Int>? {
        val parity = when { Regex("^\\s*单").containsMatchIn(text) -> 1; Regex("^\\s*双").containsMatchIn(text) -> 0; else -> null }
        val body = text.replace(Regex("^\\s*[单双]\\s*"), "").replace("周", "")
        val weeks = sortedSetOf<Int>()
        for (part in body.split(Regex("[,，、\\s]+")).filter { it.isNotEmpty() }) {
            val match = Regex("^(\\d{1,2})(?:[-~–](\\d{1,2}))?$").find(part) ?: return null
            val from = match.groupValues[1].toInt()
            val to = match.groupValues[2].ifEmpty { match.groupValues[1] }.toInt()
            if (from < 1 || to < from || to > last) return null
            for (week in from..to) if (parity == null || week % 2 == parity) weeks += week
        }
        return weeks.toList().ifEmpty { null }
    }
}
