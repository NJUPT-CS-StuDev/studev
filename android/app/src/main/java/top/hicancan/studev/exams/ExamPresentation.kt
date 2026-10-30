package top.hicancan.studev.exams

import kotlinx.serialization.Serializable
import top.hicancan.studev.data.Exam
import top.hicancan.studev.timetable.CampusDay
import java.time.*
import java.time.temporal.ChronoUnit

@Serializable data class ExamCell(val id: String, val course: String, val date: String, val start: String, val end: String,
    val room: String, val state: String, val days: Long, val countdown: String, val duration: Long, val note: String)

fun examPresentation(exam: Exam, now: Instant = Instant.now()): ExamCell {
    val start = runCatching { LocalDate.parse(exam.date).atTime(LocalTime.parse(exam.start)).atZone(CampusDay.zone).toInstant() }.getOrNull()
    val end = runCatching { LocalDate.parse(exam.date).atTime(LocalTime.parse(exam.end)).atZone(CampusDay.zone).toInstant() }.getOrNull()
    val days = runCatching { ChronoUnit.DAYS.between(now.atZone(CampusDay.zone).toLocalDate(), LocalDate.parse(exam.date)) }.getOrDefault(0)
    val state = when { start == null || end == null -> "unknown"; now >= end -> "ended"; now >= start -> "ongoing"; else -> "upcoming" }
    val countdown = when (state) { "unknown" -> "时间待定"; "ended" -> "已结束"; "ongoing" -> "正在考试"; else -> when (days) { 0L -> "今天"; 1L -> "明天"; else -> "还有 $days 天" } }
    return ExamCell(exam.id, exam.course.name, exam.date, exam.start, exam.end, exam.location?.takeIf { it.isNotEmpty() } ?: exam.room?.takeIf { it.isNotEmpty() } ?: "待定",
        state, days, countdown, runCatching { ChronoUnit.MINUTES.between(LocalTime.parse(exam.start), LocalTime.parse(exam.end)) }.getOrDefault(0), exam.note.orEmpty())
}
