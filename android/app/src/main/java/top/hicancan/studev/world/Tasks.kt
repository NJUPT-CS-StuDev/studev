package top.hicancan.studev.world

import kotlinx.serialization.Serializable
import java.time.LocalDate

/**
 * One's own task, the same as src/campus/world/tasks.ts. With a date and a time it sits on that day like a lesson and
 * may share the time with one; with only a date it is due that day; with neither it waits to be given one.
 */
@Serializable data class Task(
    val id: String,
    val title: String,
    val note: String? = null,
    /** The day it is on or due; absent while it waits for one. */
    val date: String? = null,
    /** Minutes into the day; absent for a task due by the end of its day. */
    val start: Int? = null,
    val end: Int? = null,
    /** When it reminds: minutes before it starts, or for one due by the end of a day, minutes into the day before which. */
    val remind: List<Int>? = null,
    /** 0 none, 1 low, 2 medium, 3 high. */
    val priority: Int? = null,
    /** The task it is a step of. */
    val parent: String? = null,
    /** The course it belongs to, by course identity. */
    val course: String? = null,
    /** When it was done. */
    val done: String? = null,
    /** When it last changed, and whether it was deleted: what a later sync merges by. */
    val modified: String,
    val deleted: Boolean? = null,
)

object Tasks {
    /** A task given a time but no end takes this long on the line. */
    const val MINUTES = 30
    val GROUPS = listOf("overdue" to "已过期", "today" to "今天", "tomorrow" to "明天", "week" to "未来 7 天", "later" to "更晚", "someday" to "还没排日期")
    val TIMED_REMINDERS = listOf(0 to "准时", 15 to "提前 15 分钟", 60 to "提前 1 小时", 1440 to "提前 1 天")
    val DAY_REMINDERS = listOf(8 * 60 to "当天 8:00", 12 * 60 to "当天 12:00", 20 * 60 to "当天 20:00")

    /** Where a task stands for a list; one done or a step is not asked. */
    fun group(task: Task, now: Moment): String {
        val date = task.date?.let(LocalDate::parse) ?: return "someday"
        val days = CampusLine.daysBetween(now.date, date)
        if (days < 0 || (days == 0 && task.start != null && (task.end ?: task.start) <= now.min)) return "overdue"
        return when { days == 0 -> "today"; days == 1 -> "tomorrow"; days <= 7 -> "week"; else -> "later" }
    }
    /** In a group: the earliest first, then the most important, then the oldest. */
    val order: Comparator<Task> = compareBy<Task> { it.date ?: "9999" }.thenBy { it.start ?: 1440 }.thenByDescending { it.priority ?: 0 }.thenBy { it.id }
    /** When a reminder goes off, as a date and minutes into it. */
    fun reminderAt(task: Task, remind: Int): Pair<LocalDate, Int>? {
        var date = task.date?.let(LocalDate::parse) ?: return null
        val start = task.start ?: return date to remind
        var min = start - remind
        while (min < 0) { min += 1440; date = date.minusDays(1) }
        return date to min
    }

    private const val WEEKDAY_WORDS = "一二三四五六日天"
    /**
     * What a task typed in one line says of its day and time: 今天、明天、后天, 周三 (the next one, today included), 下周三,
     * and a clock such as 14:30 or 下午3点. The words are taken out of the title; anything else stays in it.
     */
    data class Quick(val title: String, val date: String? = null, val start: Int? = null)
    fun parse(input: String, now: Moment): Quick {
        var title = input.trim()
        var date: LocalDate? = null
        var start: Int? = null
        fun take(pattern: Regex, read: (MatchResult) -> Unit) {
            val match = pattern.find(title) ?: return
            read(match)
            title = (title.substring(0, match.range.first) + title.substring(match.range.last + 1)).replace(Regex("\\s+"), " ").trim()
        }
        take(Regex("(今天|明天|后天)")) { date = now.date.plusDays(listOf("今天", "明天", "后天").indexOf(it.groupValues[1]).toLong()) }
        if (date == null) take(Regex("(下)?(?:周|星期|礼拜)([一二三四五六日天])")) {
            val weekday = WEEKDAY_WORDS.indexOf(it.groupValues[2]) % 7 + 1
            val today = now.date.dayOfWeek.value
            date = if (it.groupValues[1].isNotEmpty()) now.date.plusDays((7 - today + weekday).toLong()) else now.date.plusDays(((weekday - today + 7) % 7).toLong())
        }
        take(Regex("(\\d{1,2})[:：](\\d{2})")) { val hour = it.groupValues[1].toInt(); val min = it.groupValues[2].toInt(); if (hour < 24 && min < 60) start = hour * 60 + min }
        if (start == null) take(Regex("(上午|中午|下午|晚上)?(\\d{1,2})点(半)?")) {
            var hour = it.groupValues[2].toInt()
            if ((it.groupValues[1] == "下午" || it.groupValues[1] == "晚上") && hour < 12) hour += 12
            if (it.groupValues[1] == "中午" && hour < 6) hour += 12
            if (hour < 24) start = hour * 60 + if (it.groupValues[3].isNotEmpty()) 30 else 0
        }
        if (start != null && date == null) date = now.date
        return Quick(title.ifEmpty { input.trim() }, date?.toString(), start)
    }
}
