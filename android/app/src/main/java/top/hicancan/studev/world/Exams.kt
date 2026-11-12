package top.hicancan.studev.world

import top.hicancan.studev.data.*
import java.time.LocalDate

/** What is known about exams beyond the timetable; same answers as src/campus/world/exams.ts. */
object Exams {
    /** When an exam reminds; same keys and minutes as src/campus/timetable/model/calendar.ts. */
    val REMINDERS = listOf("week" to "一周前", "days" to "三天前", "eve" to "前一天 20:00", "early" to "两小时前", "hour" to "一小时前")
    val DEFAULT_REMINDERS = listOf("eve", "hour")
    /** Minutes before an exam starting at `start` (minutes into its day). */
    fun reminderMinutes(key: String, start: Int) = when (key) { "week" -> 7 * 1440; "days" -> 3 * 1440; "eve" -> start + 240; "early" -> 120; else -> 60 }
    private fun key(code: String?, name: String) = code ?: name
    /** The changes that led to this sitting, oldest first. */
    fun changesOf(record: ExamRecord?, exam: Exam) = record?.changes.orEmpty().filter { change ->
        change.change != "removed" && key(change.course.code, change.course.name) == key(exam.course.code, exam.course.name) &&
            change.after.orEmpty().any { it.date == exam.date && it.start == exam.start }
    }.sortedBy { it.observed }
    /** A sitting whose time or place the office changed after first publishing it. */
    fun wasChanged(record: ExamRecord?, exam: Exam) = changesOf(record, exam).any { it.change == "changed" }
    /** The day a sheet was published: its file name starts with it. */
    fun publishedOn(file: String) = file.take(10)
    /** A sheet's name as people would say it: no date, no school year, no file type. */
    fun sheetName(file: String) = file.replace(Regex("\\.[a-zA-Z]+$"), "").replace(Regex("^\\d{4}-\\d{2}-\\d{2}-"), "").replace(Regex("\\d{4}-\\d{4}学年第[一二]学期"), "").removeSuffix("-学生用表")
    /** The course behind an exam, as the timetable knows it. */
    fun courseOf(meetings: List<TeachingMeeting>, course: ExamCourse) = meetings.firstOrNull { key(it.course.code, it.course.name) == key(course.code, course.name) }?.course
    /** "1–16 周", "1–17 周（单）", "2、5、9 周". */
    fun weeksText(weeks: List<Int>): String {
        val sorted = weeks.sorted()
        if (sorted.isEmpty()) return ""
        val first = sorted.first(); val last = sorted.last()
        return when {
            sorted.size == 1 -> "第 $first 周"
            last - first + 1 == sorted.size -> "$first–$last 周"
            sorted.zipWithNext().all { (a, b) -> b - a == 2 } -> "$first–$last 周（${if (first % 2 == 1) "单" else "双"}）"
            else -> "${sorted.joinToString("、")} 周"
        }
    }
    /** How many times a lesson still meets from now: the weeks it is on, less public holidays. */
    fun lessonsLeft(term: TeachingTerm, meeting: TeachingMeeting, holidays: Map<LocalDate, String>, now: Moment, end: Int) = meeting.weeks.count { week ->
        val start = term.weeks.firstOrNull { it.week == week }?.start ?: return@count false
        val date = LocalDate.parse(start).plusDays(meeting.weekday - 1L)
        date !in holidays && (date > now.date || (date == now.date && end > now.min))
    }
    private val fields: List<Pair<String, (ExamSlot) -> String?>> = listOf(
        "时间" to { "${it.date} ${it.start}–${it.end}" }, "地点" to { it.location }, "校区" to { it.campus }, "老师" to { it.teacher }, "人数" to { it.students?.toString() },
    )
    private fun slotText(slots: List<ExamSlot>?, read: (ExamSlot) -> String?) = slots.orEmpty().map { read(it)?.takeIf(String::isNotEmpty) ?: "未填写" }.distinct().joinToString("、").ifEmpty { "未填写" }
    /** What one change did, in words. */
    fun changeLines(change: ExamChange): List<String> = when (change.change) {
        "changed" -> fields.mapNotNull { (label, read) -> val before = slotText(change.before, read); val after = slotText(change.after, read); if (before == after) null else "$label：$before → $after" }
        "added" -> listOf("${slotText(change.after, fields[0].second)} · ${slotText(change.after, fields[1].second)}")
        else -> listOf("原定 ${slotText(change.before, fields[0].second)}")
    }
    val changeNames = mapOf("added" to "新增", "changed" to "调整", "removed" to "已移除")
}
