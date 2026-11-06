package top.hicancan.studev.world

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import top.hicancan.studev.data.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

@Serializable data class DaySpan(val name: String, val start: String, val end: String)
@Serializable data class CalendarTerm(val number: Int, val start: String, val end: String, val weeks: Int, @SerialName("break") val pause: DaySpan? = null,
    val holidays: List<DaySpan> = emptyList(), val events: List<DaySpan> = emptyList())
@Serializable data class CalendarFile(val terms: List<CalendarTerm>)
@Serializable data class RunPlace(val route: List<String>, val metres: Int, val male_minutes: Int, val female_minutes: Int, val start_scan_end: String? = null, val end_scan_end: String? = null)
@Serializable data class RunMakeup(val start: String? = null, val end: String? = null, val weeks: List<Int>? = null, val time: List<String>, val source: String)
@Serializable data class MorningRun(val required: Int, val start: String, val end: String, val time: List<String>, val bonus: List<List<Int>> = emptyList(),
    val fail_score: Int? = null, val source: String, val xianlin: RunPlace? = null, val makeup: RunMakeup? = null)

/** A moment on campus: a date and the minute of that day. */
data class Moment(val date: LocalDate, val min: Int) {
    companion object { fun of(at: ZonedDateTime) = Moment(at.toLocalDate(), at.hour * 60 + at.minute) }
}
fun clock(value: String) = value.substring(0, 2).toInt() * 60 + value.substring(3, 5).toInt()
fun hm(minutes: Int) = "%02d:%02d".format(minutes / 60, minutes % 60)
fun dateLabel(date: LocalDate) = "${date.monthValue}月${date.dayOfMonth}日"
val WEEKDAYS = listOf("", "周一", "周二", "周三", "周四", "周五", "周六", "周日")
fun durationText(minutes: Int) = if (minutes >= 60) "${minutes / 60} 小时" + (if (minutes % 60 != 0) " ${minutes % 60} 分" else "") else "$minutes 分钟"

/** How names are shortened; same table and results as the web (src/campus/world/names.ts). */
object Names {
    private val short = mapOf("习近平新时代中国特色社会主义思想概论" to "习概", "毛泽东思想和中国特色社会主义理论体系概论" to "毛概",
        "马克思主义基本原理" to "马原", "思想道德与法治" to "思修", "中国近现代史纲要" to "近代史", "形势与政策" to "形策",
        "计算机通信与网络" to "计网", "计算机组成原理" to "组成原理", "操作系统基础" to "操作系统", "计算机图形学" to "图形学",
        "信息安全技术" to "信息安全", "单片机原理及系统设计" to "单片机", "嵌入式手机终端开发技术" to "嵌入式开发")
    private val brackets = Regex("[（(].*?[)）]")
    fun course(name: String) = brackets.replace(name, "").trim().ifEmpty { name.trim() }
    fun courseShort(name: String) = short[course(name)] ?: course(name)
    fun room(room: String?) = room.orEmpty().replaceFirst(Regex("^[^/]*/"), "").replace("/", " ")
    fun roomShort(room: String?) = room(room).removePrefix("教")
    fun placed(room: String?) = !room.isNullOrEmpty() && room.contains('/')
    /** The building of a room id, or the id itself when it is not a room. */
    fun building(id: String): String {
        val slash = id.indexOf('/')
        if (slash < 0) return id
        val rest = id.substring(slash + 1)
        val cut = rest.indexOfFirst { it == '-' || it == '/' }
        return if (cut < 0) id else id.substring(0, slash + 1 + cut)
    }
}

data class LineEvent(val kind: String, val id: String, val date: LocalDate, val name: String, val short: String, val start: Int, val end: Int,
                     val room: String?, val teachers: List<String>, val meeting: TeachingMeeting? = null, val exam: Exam? = null, val runMark: String? = null)
val LineEvent.startsAt: Instant get() = date.atStartOfDay(CampusDay.zone).plusMinutes(start.toLong()).toInstant()
val LineEvent.endsAt: Instant get() = date.atStartOfDay(CampusDay.zone).plusMinutes(end.toLong()).toInstant()
/** Which mornings are run ("done") or planned ("plan"), and the bonus or penalty the sports office recorded. */
data class RunPlan(val rule: MorningRun, val days: Map<String, String>, val adjust: Int)
data class RunTally(val done: Int, val planned: Int, val count: Int, val need: Int, val nextBonus: List<Int>?)

/** A person or room along time: lessons, exams, the school calendar and 早锻炼 on one line. */
class CampusLine(val term: TeachingTerm, val periods: List<TeachingPeriod>, val meetings: List<TeachingMeeting>, val exams: List<Exam>,
                 val holidays: Map<LocalDate, String>, val run: RunPlan?) {
    private val byPeriod = periods.associateBy { it.period }
    fun weekOf(date: LocalDate) = term.weeks.find { date.toString() >= it.start && date.toString() <= it.end }?.week
    fun on(date: LocalDate): List<LineEvent> = buildList {
        val week = weekOf(date)
        val weekday = date.dayOfWeek.value
        // The school calendar decides: nobody has lessons on a public holiday.
        if (week != null && date !in holidays) for (meeting in meetings) {
            if (meeting.weekday != weekday || week !in meeting.weeks) continue
            val first = byPeriod[meeting.periods.first()] ?: continue
            val last = byPeriod[meeting.periods.last()] ?: continue
            add(LineEvent("class", "${meeting.id}@$date", date, Names.course(meeting.course.name), Names.courseShort(meeting.course.name),
                clock(first.start), clock(last.end), meeting.room, meeting.teachers.map { it.name }, meeting = meeting))
        }
        for (exam in exams) if (exam.date == date.toString()) add(LineEvent("exam", exam.id, date, Names.course(exam.course.name), Names.courseShort(exam.course.name),
            clock(exam.start), clock(exam.end), exam.room ?: exam.location, listOfNotNull(exam.teacher), exam = exam))
        val plan = run
        plan?.days?.get(date.toString())?.let { mark -> add(LineEvent("run", "run@$date", date, "早锻炼", "早锻炼", clock(plan.rule.time[0]), clock(plan.rule.time[1]), null, emptyList(), runMark = mark)) }
    }.sortedBy { it.start }
    /** Every lesson and exam in order, for what lives outside the app: the calendar and reminders. */
    fun lessonsAndExams(): List<LineEvent> {
        val first = LocalDate.parse(term.weeks.first().start)
        val last = LocalDate.parse(term.weeks.last().end)
        val days = generateSequence(first) { it.plusDays(1) }.takeWhile { it <= last }.toSet() + exams.map { LocalDate.parse(it.date) }
        return days.sorted().flatMap(::on).filter { it.kind != "run" }
    }
    /** What comes next, not counting 早锻炼: it is optional on any given morning. */
    fun next(now: Moment, horizon: Int = 40): LineEvent? {
        for (offset in 0 until horizon) for (event in on(now.date.plusDays(offset.toLong()))) if (event.kind != "run" && (offset > 0 || event.end > now.min)) return event
        return null
    }
    fun upcomingExams(today: LocalDate) = exams.filter { it.date >= today.toString() }.sortedWith(compareBy({ it.date }, { it.start }))
    companion object {
        fun holidays(terms: List<CalendarTerm>): Map<LocalDate, String> = buildMap {
            for (term in terms) for (item in term.holidays) {
                var date = LocalDate.parse(item.start)
                while (date <= LocalDate.parse(item.end)) { put(date, get(date)?.let { "$it、${item.name}" } ?: item.name); date = date.plusDays(1) }
            }
        }
        fun isRunDay(rule: MorningRun, holidays: Map<LocalDate, String>, date: LocalDate) =
            date.toString() >= rule.start && date.toString() <= rule.end && date.dayOfWeek.value <= 5 && date !in holidays
        fun tally(plan: RunPlan): RunTally {
            val done = plan.days.values.count { it == "done" }
            val planned = plan.days.size - done
            val count = done + plan.adjust
            return RunTally(done, planned, count, maxOf(0, plan.rule.required - count - planned), plan.rule.bonus.firstOrNull { it[0] > count + planned })
        }
        /** Every morning in the term one can run, in order. */
        fun runDates(rule: MorningRun, holidays: Map<LocalDate, String>) =
            generateSequence(LocalDate.parse(rule.start)) { it.plusDays(1) }.takeWhile { it.toString() <= rule.end }.filter { isRunDay(rule, holidays, it) }.toList()
        /** Lays out what is still needed: evenly over the mornings left, and within each stretch on a day
         *  with an early class. Done mornings stay; earlier plans for mornings still ahead are replaced. */
        fun planRuns(plan: RunPlan, line: CampusLine, now: Moment): Map<String, String> {
            val from = if (now.min < clock(plan.rule.time[0])) now.date else now.date.plusDays(1)
            val days = plan.days.filter { (date, mark) -> mark == "done" || date < from.toString() }.toMutableMap()
            val open = runDates(plan.rule, line.holidays).filter { it >= from && it.toString() !in days }
            val need = minOf(open.size, tally(plan.copy(days = days)).need)
            var last: LocalDate? = null
            for (part in 0 until need) {
                val stretch = open.subList(part * open.size / need, (part + 1) * open.size / need)
                val middle = (stretch.size - 1) / 2.0
                fun score(date: LocalDate, position: Int) = (if (line.on(date).any { it.kind == "class" && it.start <= 8 * 60 }) 4.0 else 0.0) +
                    (if (last != null && daysBetween(last!!, date) < 2) -3.0 else 0.0) - Math.abs(position - middle) / maxOf(1, stretch.size)
                var best = 0
                stretch.forEachIndexed { position, date -> if (score(date, position) > score(stretch[best], best)) best = position }
                last = stretch[best]
                days[stretch[best].toString()] = "plan"
            }
            return days
        }
        fun grade(classGrade: String?, term: TeachingTerm) = classGrade?.toIntOrNull()?.let { term.year - it + 1 }
        fun daysBetween(from: LocalDate, to: LocalDate) = ChronoUnit.DAYS.between(from, to).toInt()
    }
}

/** A room at a moment: free or not, and for how long. Same results as src/campus/world/rooms.ts. */
data class TimedOccupant(val occupant: RoomOccupant, val start: Int, val end: Int)
data class RoomState(val tier: String, val busy: Boolean, val until: Int, val minutes: Int, val occupants: List<TimedOccupant>, val current: TimedOccupant?)
class RoomReader(periods: List<TeachingPeriod>) {
    private val sorted = periods.sortedBy { it.period }
    private val span = sorted.associate { it.period to (clock(it.start) to clock(it.end)) }
    private val dayEnd = span.values.maxOf { it.second }
    private fun free(day: RoomDay, id: String, period: Int) = day.free?.let { id in it[period.toString()].orEmpty() }
        ?: day.occupied[id].orEmpty().none { period in it.periods.first()..it.periods.last() }
    fun at(day: RoomDay?, id: String, min: Int): RoomState {
        val occupants = day?.occupied?.get(id).orEmpty().map { TimedOccupant(it, span.getValue(it.periods.first()).first, span.getValue(it.periods.last()).second) }.sortedBy { it.start }
        if (day == null) return RoomState("other", false, min, 0, occupants, null)
        val current = occupants.firstOrNull { it.start <= min && min < it.end }
        val running = sorted.firstOrNull { span.getValue(it.period).first <= min && min < span.getValue(it.period).second }
        if (current != null || (running != null && !free(day, id, running.period))) {
            var until = current?.end ?: span.getValue(running!!.period).second
            for (period in sorted) {
                val (start, end) = span.getValue(period.period)
                if (start >= until && start - until <= 25 && !free(day, id, period.period)) until = end
            }
            return RoomState("busy", true, until, 0, occupants, current)
        }
        if (min >= dayEnd) return RoomState("short", false, dayEnd, 0, occupants, null)
        val next = sorted.firstOrNull { span.getValue(it.period).first >= min && !free(day, id, it.period) }
        val until = next?.let { span.getValue(it.period).first } ?: dayEnd
        val minutes = until - min
        return RoomState(if (minutes >= 180) "long" else if (minutes >= 60) "mid" else "short", false, until, minutes, occupants, null)
    }
    companion object {
        private val kinds = listOf("多媒体", "非多媒体", "翻转课堂")
        fun classroom(room: Room) = room.listed && room.kinds.any { kind -> kinds.any(kind::contains) }
    }
}
