package top.hicancan.studev.world

import kotlinx.serialization.Serializable
import java.time.LocalDate

/**
 * One's own task, the same as src/campus/world/tasks.ts. Planned execution occupies time; its deadline is independent.
 */
@Serializable data class TaskDeadline(val date: String, val time: Int? = null, val remind: List<Int>? = null)

@Serializable data class Task(
    val id: String,
    val title: String,
    val note: String? = null,
    /** The day planned for execution. */
    val date: String? = null,
    /** Planned start and end, in minutes into the day. */
    val start: Int? = null,
    val end: Int? = null,
    val due: TaskDeadline? = null,
    /** Minutes before execution; deadline reminders belong to due. */
    val remind: List<Int>? = null,
    /** 0 none, 1 low, 2 medium, 3 high. */
    val priority: Int? = null,
    /** The task it is a step of. */
    val parent: String? = null,
    /** The course it belongs to, by course identity. */
    val course: String? = null,
    /** Where the person put it among the tasks of its group, by dragging it there; those never moved follow, by time. */
    val order: Double? = null,
    /** When it was done. */
    val done: String? = null,
    /** When it last changed, and whether it was deleted: what a later sync merges by. */
    val modified: String,
    val deleted: Boolean? = null,
)

object Tasks {
    /** A task given a time but no end takes this long on the line. */
    const val MINUTES = 30
    val GROUPS = listOf("overdue" to "待补做", "today" to "今天", "tomorrow" to "明天", "week" to "未来 7 天", "later" to "更晚", "someday" to "还没排日期")
    val TIMED_REMINDERS = listOf(0 to "准时", 15 to "提前 15 分钟", 60 to "提前 1 小时", 1440 to "提前 1 天")
    val DAY_REMINDERS = listOf(8 * 60 to "当天 8:00", 12 * 60 to "当天 12:00", 20 * 60 to "当天 20:00")

    /** Where a task stands for a list; one done or a step is not asked. */
    fun group(task: Task, now: Moment): String {
        val at = at(task) ?: return "someday"
        val date = LocalDate.parse(at.first)
        val days = CampusLine.daysBetween(now.date, date)
        if (days < 0 || (days == 0 && at.second <= now.min)) return "overdue"
        return when { days == 0 -> "today"; days == 1 -> "tomorrow"; days <= 7 -> "week"; else -> "later" }
    }
    /** In a group: the earliest first, then the most important, then the oldest. */
    fun at(task: Task): Pair<String, Int>? = listOfNotNull(task.date?.let { it to (task.end ?: task.start ?: 1440) }, task.due?.let { it.date to (it.time ?: 1440) })
        .sortedWith(compareBy<Pair<String, Int>> { it.first }.thenBy { it.second }).firstOrNull()
    val order: Comparator<Task> = compareBy<Task, Double?>(nullsLast()) { it.order }.thenBy { at(it)?.first ?: "9999" }.thenBy { at(it)?.second ?: 1440 }.thenByDescending { it.priority ?: 0 }.thenBy { it.id }
    /** The groups a task can be dragged into, as DROP_GROUPS in tasks.ts. */
    val DROP_GROUPS = listOf("today", "tomorrow", "someday")
    /** A task dragged to `index` among the tasks shown in `group`: what changes, as moveTask in tasks.ts. */
    fun move(task: Task, group: String, index: Int, shown: List<Task>, now: Moment): List<Task> {
        var moved = task
        if (group != group(task, now)) {
            if (group !in DROP_GROUPS) return emptyList()
            moved = if (group == "someday") task.copy(date = null, start = null, end = null, remind = null, due = null)
            else {
                val day = now.date.plusDays(if (group == "today") 0 else 1).toString()
                // What gives it its place in the list moves: its plan, or its deadline when that comes first.
                val planFirst = task.date != null && (task.due == null || task.date + (task.end ?: task.start ?: 1440).toString().padStart(4, '0') <= task.due.date + (task.due.time ?: 1440).toString().padStart(4, '0'))
                if (planFirst) task.copy(date = day) else task.copy(due = (task.due ?: TaskDeadline(day)).copy(date = day))
            }
        }
        val list = shown.filter { it.id != task.id }.toMutableList()
        list.add(index.coerceIn(0, list.size), moved)
        return list.mapIndexedNotNull { at, item -> if (item === moved || item.order != at.toDouble()) item.copy(order = at.toDouble()) else null }
    }
    /** A plan is a day and a start; a day alone is not one (that is a deadline, kept in `due`), as sanitizeTask in tasks.ts. */
    fun sanitize(task: Task): Task = if (task.date != null && task.start == null) task.copy(date = null, end = null) else task
    /** When a reminder goes off, as a date and minutes into it. */
    fun reminderAt(task: Task, remind: Int, anchor: String = "plan"): Pair<LocalDate, Int>? {
        var date = (if (anchor == "due") task.due?.date else task.date)?.let(LocalDate::parse) ?: return null
        val start = (if (anchor == "due") task.due?.time else task.start) ?: return date to remind
        var min = start - remind
        while (min < 0) { min += 1440; date = date.minusDays(1) }
        return date to min
    }

    private const val CN_DIGITS = "零一二三四五六七八九"
    /** "3", "十二", "两", "二十五": a number written either way; null when it is not one, as chineseNumber in tasks.ts. */
    fun chineseNumber(text: String): Int? {
        if (text.isNotEmpty() && text.all { it in '0'..'9' }) return text.toIntOrNull()
        val value = text.replace('两', '二')
        if (value.isEmpty() || !value.all { it in "零一二三四五六七八九十" }) return null
        val ten = value.indexOf('十')
        if (ten < 0) return if (value.length == 1) CN_DIGITS.indexOf(value) else null
        val tens = if (ten == 0) 1 else CN_DIGITS.indexOf(value.substring(0, ten))
        val ones = if (ten == value.length - 1) 0 else CN_DIGITS.indexOf(value.substring(ten + 1))
        return if (value.length > 3 || tens < 1 || ones < 0) null else tens * 10 + ones
    }
    private const val NUM = "(\\d{1,2}|[一二两三四五六七八九十]{1,3})"
    private const val PART = "(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)"
    private const val CLOCK = "(?:(\\d{1,2})[:：](\\d{2})|${NUM}点(?:(半)|(一刻)|(三刻)|(\\d{1,2})分?)?|(\\d{1,2})\\s*(am|pm|AM|PM))"
    private fun clockOf(g: List<String>, at: Int, part: String?): Int? {
        var hour: Int
        var min = 0
        if (g[at].isNotEmpty()) { hour = g[at].toInt(); min = g[at + 1].toInt() }
        else if (g[at + 2].isNotEmpty()) {
            // 一点 alone is as often "a little" as one o'clock: it is a time only with a part of the day or minutes.
            if (g[at + 2] == "一" && part == null && (3..6).all { g[at + it].isEmpty() }) return null
            hour = chineseNumber(g[at + 2]) ?: return null
            min = when { g[at + 3].isNotEmpty() -> 30; g[at + 4].isNotEmpty() -> 15; g[at + 5].isNotEmpty() -> 45; g[at + 6].isNotEmpty() -> g[at + 6].toInt(); else -> 0 }
        } else {
            hour = g[at + 7].toInt()
            val meridiem = g[at + 8].lowercase()
            if (meridiem == "pm" && hour < 12) hour += 12
            if (meridiem == "am" && hour == 12) hour = 0
        }
        if (hour > 24 || min > 59) return null
        if (part != null && Regex("下午|傍晚|晚上").containsMatchIn(part) && hour < 12) hour += 12
        else if (part == "中午" && hour < 6) hour += 12
        else if (part == null && g[at + 2].isNotEmpty() && hour in 1..5) hour += 12
        return if (hour == 24) null else hour * 60 + min
    }
    private fun validDate(year: Int, month: Int, day: Int): LocalDate? = runCatching { LocalDate.of(year, month, day) }.getOrNull()

    /** What one line typed for a task was read as, the same as parseQuickTask in tasks.ts. */
    data class Quick(val title: String, val date: String? = null, val start: Int? = null, val end: Int? = null, val due: TaskDeadline? = null,
                     val priority: Int? = null, val course: String? = null, val marks: List<Pair<Int, Int>> = emptyList())
    data class QuickCourse(val identity: String, val names: List<String>)
    fun parse(input: String, now: Moment, courses: List<QuickCourse> = emptyList()): Quick {
        val line = input.trim()
        val used = mutableListOf<Pair<Int, Int>>()
        fun free(from: Int, to: Int) = used.all { (left, right) -> to <= left || right <= from }
        fun take(pattern: Regex, read: (List<String>) -> Boolean): Pair<Int, Int>? {
            var from = 0
            while (from <= line.length) {
                val match = pattern.find(line, from) ?: return null
                val span = match.range.first to match.range.last + 1
                if (match.value.isEmpty() || !free(span.first, span.second) || !read(match.groupValues)) { from = match.range.first + 1; continue }
                used += span
                return span
            }
            return null
        }
        var date: LocalDate? = null
        var start: Int? = null
        var end: Int? = null
        var part: String? = null
        var deadline = false
        var priority: Int? = null
        var course: String? = null
        val today = now.date
        val daySpan = take(Regex("(大后天|明天早上|明天晚上|后天|明天|今天|今晚|今早|明晚|明早)")) { g ->
            val word = g[1]
            date = today.plusDays(if (word.startsWith("大后")) 3 else if (word.startsWith("后")) 2 else if (word.startsWith("明")) 1 else 0)
            if ("晚" in word) part = "晚上" else if ("早" in word) part = "早上"
            true
        } ?: take(Regex("$NUM\\s*(天|周|个星期|星期|个月)(?:后|以后|之后)")) { g ->
            val count = chineseNumber(g[1])
            if (count == null || count < 1 || count > 99) return@take false
            date = when (g[2]) { "天" -> today.plusDays(count.toLong()); "个月" -> today.plusMonths(count.toLong()); else -> today.plusDays(7L * count) }
            true
        } ?: take(Regex("(下下|下|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天末])")) { g ->
            val weekday = if (g[2] == "末") 6 else "一二三四五六日天".indexOf(g[2]) % 7 + 1
            val todayIndex = today.dayOfWeek.value
            val ahead = when (g[1]) { "下下" -> 14; "下" -> 7; else -> 0 }
            date = if (ahead > 0) today.plusDays((ahead - todayIndex + weekday).toLong()) else today.plusDays(((weekday - todayIndex + 7) % 7).toLong())
            true
        } ?: take(Regex("(?<![第\\d])(?:(\\d{4})\\s*[年\\-/.])?(\\d{1,2})\\s*[月\\-/.]\\s*(\\d{1,2})(?![\\d节周页章题])(?:\\s*[日号])?")) { g ->
            val wanted = g[2].toInt()
            val day = g[3].toInt()
            var found = validDate(if (g[1].isNotEmpty()) g[1].toInt() else today.year, wanted, day)
            if (found != null && g[1].isEmpty() && found < today && wanted < today.monthValue) found = validDate(today.year + 1, wanted, day)
            date = found ?: return@take false
            true
        } ?: take(Regex("$NUM\\s*[日号]")) { g ->
            val day = chineseNumber(g[1]) ?: return@take false
            var found = validDate(today.year, today.monthValue, day)
            if (found != null && found < today) found = if (today.monthValue == 12) validDate(today.year + 1, 1, day) else validDate(today.year, today.monthValue + 1, day)
            date = found ?: return@take false
            true
        } ?: take(Regex("月底")) { date = today.withDayOfMonth(today.lengthOfMonth()); true }
        val timeSpan = take(Regex("$PART?\\s*$CLOCK\\s*(?:-|~|–|—|到|至)\\s*$PART?\\s*$CLOCK")) { g ->
            val from = clockOf(g, 2, g[1].ifEmpty { null } ?: part) ?: return@take false
            val to = clockOf(g, 12, g[11].ifEmpty { null } ?: g[1].ifEmpty { null } ?: part) ?: return@take false
            val finish = if (to > from) to else if (to + 720 > from && to + 720 < 1440) to + 720 else return@take false
            start = from; end = finish
            true
        } ?: take(Regex("$PART?\\s*$CLOCK")) { g -> start = clockOf(g, 2, g[1].ifEmpty { null } ?: part) ?: return@take false; true }
        take(Regex("(截止|之前|以前|ddl|DDL)")) { deadline = true; true }
        val after = maxOf(daySpan?.second ?: -1, timeSpan?.second ?: -1)
        if (after >= 0 && after < line.length && line[after] == '前' && free(after, after + 1)) { used += after to after + 1; deadline = true }
        take(Regex("[!！](高|中|低)|[!！]{1,3}")) { g -> priority = if (g[1].isNotEmpty()) mapOf("高" to 3, "中" to 2, "低" to 1).getValue(g[1]) else g[0].length; true }
        take(Regex("[#＃](\\S+)")) { g ->
            val word = g[1].lowercase()
            val found = courses.firstOrNull { item -> item.names.any { it.lowercase() == word } } ?: courses.firstOrNull { item -> item.names.any { word in it.lowercase() } }
            course = found?.identity ?: return@take false
            true
        }
        used.sortBy { it.first }
        val title = buildString {
            var at = 0
            for ((from, to) in used) { append(line, at, from); append(' '); at = to }
            append(line, at, line.length)
        }.replace(Regex("\\s+"), " ").replace(Regex("^[，,、\\s]+|[，,、\\s]+$"), "").trim().ifEmpty { line }
        if (start != null && date == null) date = today
        val day = date?.toString()
        if (day != null && (start == null || deadline)) return Quick(title, due = TaskDeadline(day, start), priority = priority, course = course, marks = used.toList())
        return Quick(title, day, start, end, priority = priority, course = course, marks = used.toList())
    }
}
