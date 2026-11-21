package top.hicancan.studev.timetable

import top.hicancan.studev.data.*

/**
 * Every exam the class's rows name is one's own until one says otherwise: missing an exam is the failure that matters,
 * so nothing is taken away by inference. What one takes away stays in sight, greyed, and comes back in a tap.
 * The web reference is timetable/model/examAttendance.ts.
 */
object ExamAttendance {
    fun scope(term: String, klass: String) = "$term:${klass.uppercase(java.util.Locale.ROOT)}"
    /** The exams one sits: all of them, but those one has explicitly said one does not take. */
    fun select(exams: List<Exam>, choices: Map<String, Boolean>): List<Exam> = exams.filter { choices[it.id] != false }
    /** The exams one has taken away, kept to show greyed and to restore. */
    fun skipped(exams: List<Exam>, choices: Map<String, Boolean>): List<Exam> = exams.filter { choices[it.id] == false }
    /** Exams of courses one's timetable does not have, for the one-tap clean-up; one without a course code stays. */
    fun outside(exams: List<Exam>, ownCodes: Set<String>): List<Exam> = exams.filter { val code = it.course.code; !code.isNullOrEmpty() && code !in ownCodes }
}
