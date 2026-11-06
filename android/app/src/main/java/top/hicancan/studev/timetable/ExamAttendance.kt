package top.hicancan.studev.timetable

import top.hicancan.studev.data.*

/** Explicit choices win over the same-term timetable, as in the web reference. */
object ExamAttendance {
    fun scope(term: String, klass: String) = "$term:${klass.uppercase(java.util.Locale.ROOT)}"
    fun ownCodes(release: DataRelease, schedule: ClassSchedule?): Set<String>? =
        if (release.exams == release.teaching && schedule != null) schedule.meetings.mapNotNull { it.course.code }.toSet() else null
    fun select(exams: List<Exam>, choices: Map<String, Boolean>, ownCodes: Set<String>? = null): List<Exam> =
        exams.filter { choices[it.id] ?: (ownCodes == null || it.course.code.isNullOrEmpty() || it.course.code in ownCodes) }
}
