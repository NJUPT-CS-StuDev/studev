package top.hicancan.studev.timetable

import top.hicancan.studev.data.CoursePlan
import top.hicancan.studev.data.Lab
import top.hicancan.studev.data.TeachingMeeting
import top.hicancan.studev.me.TimetableEdits
import top.hicancan.studev.world.Names
import java.text.Collator
import java.text.Normalizer
import java.util.Locale

data class CatalogCourse(val meetings: List<TeachingMeeting>)

data class TimetableCourse(
    val meetings: List<TeachingMeeting>,
    val source: String,
    val hidden: Boolean,
) {
    val id: String get() = meetings.first().teaching_class.id
}

object CourseCatalog {
    private val zhCollator: Collator get() = Collator.getInstance(Locale.CHINA)
    private val dashRegex = Regex("[－—–]")
    private val spaceRegex = Regex("\\s+")

    fun catalogId(course: CatalogCourse): String = course.meetings.first().teaching_class.id

    fun groupCatalog(meetings: List<TeachingMeeting>, plans: List<CoursePlan> = emptyList()): List<CatalogCourse> {
        val groups = LinkedHashMap<String, MutableList<TeachingMeeting>>()
        val used = HashSet<String>()
        val byCode = HashMap<String, MutableList<TeachingMeeting>>()
        for (meeting in meetings) {
            val code = meeting.course.code
            if (!code.isNullOrEmpty()) byCode.getOrPut(code) { mutableListOf() }.add(meeting)
        }
        for (plan in plans) {
            val code = if (plan.id.startsWith("information/course-plan/")) plan.id.removePrefix("information/course-plan/") else ""
            val courseMeetings = if (code.isNotEmpty()) byCode[code].orEmpty() else meetings.filter { it.course.name in plan.names }
            for (id in plan.teaching_class_ids) {
                val rows = courseMeetings.filter { it.teaching_class.id == id }
                if (rows.isEmpty()) continue
                groups[id] = rows.toMutableList()
                rows.forEach { used.add(it.id) }
            }
        }
        for (meeting in meetings) {
            if (meeting.id in used) continue
            val id = meeting.teaching_class.id
            groups.getOrPut(id) { mutableListOf() }.add(meeting)
        }
        return groups.values.map { CatalogCourse(it) }
    }

    internal fun normalize(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .lowercase(Locale.ROOT)
        .replace(dashRegex, "-")
        .replace('（', '(')
        .replace('）', ')')
        .replace(spaceRegex, " ")
        .trim()

    private fun catalogText(course: CatalogCourse): String = normalize(
        course.meetings.flatMap { m ->
            listOf(m.course.name, m.course.code.orEmpty()) + m.teachers.map { it.name } + listOf(m.room.orEmpty()) + m.classes
        }.joinToString(" ")
    )

    fun searchCatalog(courses: List<CatalogCourse>, query: String, limit: Int = 60): List<CatalogCourse> {
        val words = normalize(query).split(' ').filter { it.isNotEmpty() }
        if (words.isEmpty()) return emptyList()
        val collator = zhCollator
        data class Scored(val course: CatalogCourse, val score: Int)
        val scored = mutableListOf<Scored>()
        for (course in courses) {
            val text = catalogText(course)
            if (!words.all { text.contains(it) }) continue
            val first = course.meetings.first()
            val name = normalize(first.course.name)
            val teacherNames = course.meetings.flatMap { m -> m.teachers.map { normalize(it.name) } }
            val code = first.course.code?.let(::normalize)
            val score = words.sumOf { word ->
                (if (name.startsWith(word)) 6 else if (name.contains(word)) 4 else 0) +
                    (if (teacherNames.any { it == word }) 3 else 0) +
                    (if (code != null && code == word) 5 else 0)
            }
            scored.add(Scored(course, score))
        }
        return scored.sortedWith { left, right ->
            val byScore = right.score.compareTo(left.score)
            if (byScore != 0) return@sortedWith byScore
            val byName = collator.compare(left.course.meetings.first().course.name, right.course.meetings.first().course.name)
            if (byName != 0) return@sortedWith byName
            val leftTeacher = left.course.meetings.firstOrNull { it.teachers.isNotEmpty() }?.teachers?.firstOrNull()?.name.orEmpty()
            val rightTeacher = right.course.meetings.firstOrNull { it.teachers.isNotEmpty() }?.teachers?.firstOrNull()?.name.orEmpty()
            collator.compare(leftTeacher, rightTeacher)
        }.take(limit).map { it.course }
    }

    fun formatWeekNumbers(weeks: List<Int>): String {
        if (weeks.isEmpty()) return "未注明"
        val sorted = weeks.distinct().sorted()
        val first = sorted.first()
        val parity = if (sorted.size >= 2 && sorted.all { it % 2 == first % 2 }) {
            if (first % 2 == 1) "单周" else "双周"
        } else null
        if (parity != null) return "第${first}–${sorted.last()}周（${parity}）"
        val ranges = mutableListOf<String>()
        var start = first
        var end = first
        for (week in sorted.drop(1)) {
            if (week == end + 1) end = week
            else {
                ranges.add(if (start == end) "$start" else "${start}–${end}")
                start = week
                end = week
            }
        }
        ranges.add(if (start == end) "$start" else "${start}–${end}")
        return "第${ranges.joinToString("、")}周"
    }

    fun meetingLine(meeting: TeachingMeeting): String {
        val dayName = "一二三四五六日".getOrNull(meeting.weekday - 1)?.let { "周$it" } ?: "周${meeting.weekday}"
        val room = meeting.room?.let(Names::room)?.replace('－', '-') ?: "地点未定"
        return "$dayName ${meeting.periods.first()}–${meeting.periods.last()}节 · $room · ${formatWeekNumbers(meeting.weeks)}"
    }

    fun effectiveMeetings(ownMeetings: List<TeachingMeeting>, catalog: List<CatalogCourse>, edits: TimetableEdits): List<TeachingMeeting> {
        val hidden = edits.hidden.toSet()
        val own = ownMeetings.filter { it.teaching_class.id !in hidden }
        val wanted = edits.added.toSet()
        val addedMeetings = catalog.filter { catalogId(it) in wanted }.flatMap { it.meetings }
        val ownIds = own.mapTo(HashSet()) { it.id }
        // One's own courses join as meetings; their names are a matter of display, given on the timeline.
        return own + addedMeetings.filter { it.id !in ownIds } + edits.custom.flatMap(Courses::meetings)
    }

    /**
     * A person's lab sources, as in src/campus/timetable/model/labs.ts: their own class plus
     * explicitly selected extra classes. Lecture attendance never changes these sources.
     */
    fun effectiveLabs(classLabs: List<Lab>, extraClasses: List<String>, allLabs: List<Lab>): List<Lab> {
        val brought = allLabs.filter { lab -> lab.classes.any { it in extraClasses } }
        return (classLabs + brought).distinctBy { it.id }.sortedWith(compareBy({ it.date }, { it.start }, { it.id }))
    }
    /** A lab sheet's name across its versions: the file name without the date it was sent. */
    fun labSheet(lab: Lab) = top.hicancan.studev.world.Exams.sheetName(lab.source)
    fun labCourseKey(lab: Lab) = labSheet(lab) + ":" + Normalizer.normalize(lab.course.name, Normalizer.Form.NFKC).trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")
    fun migrateLabChoices(labs: List<Lab>, choices: top.hicancan.studev.me.LabChoices): top.hicancan.studev.me.LabChoices {
        val drop = choices.drop.map { key -> labs.firstOrNull { TimetablePresentation.identity(it) == key }?.let(::labCourseKey) ?: key }.distinct()
        return if (drop == choices.drop) choices else choices.copy(drop = drop)
    }
    /**
     * What a person chose about labs, the same as src/campus/timetable/model/labs.ts: a lab sheet comes from outside the
     * teaching office, so each is theirs to take or leave whole; then a lab course or a single sitting.
     */
    fun attendingLabs(labs: List<Lab>, choices: top.hicancan.studev.me.LabChoices) =
        labs.filter { labSheet(it) !in choices.off && labCourseKey(it) !in choices.drop && it.id !in choices.skip }

    private fun groupCourses(meetings: List<TeachingMeeting>, source: String, hidden: Set<String>): List<TimetableCourse> {
        val groups = LinkedHashMap<String, MutableList<TeachingMeeting>>()
        for (meeting in meetings) {
            groups.getOrPut(meeting.teaching_class.id) { mutableListOf() }.add(meeting)
        }
        val collator = zhCollator
        return groups.map { (id, list) ->
            TimetableCourse(
                meetings = list.sortedWith(compareBy<TeachingMeeting> { it.weekday }.thenBy { it.periods.first() }),
                source = source,
                hidden = id in hidden,
            )
        }.sortedWith { a, b -> collator.compare(a.meetings.first().course.name, b.meetings.first().course.name) }
    }

    fun managedCourses(ownMeetings: List<TeachingMeeting>, catalog: List<CatalogCourse>, edits: TimetableEdits): List<TimetableCourse> {
        val hidden = edits.hidden.toSet()
        val ownIds = ownMeetings.mapTo(HashSet()) { it.id }
        val wanted = edits.added.toSet()
        val addedMeetings = if (wanted.isEmpty()) emptyList() else catalog.filter { catalogId(it) in wanted }.flatMap { it.meetings }.filter { it.id !in ownIds }
        return groupCourses(ownMeetings, "class", hidden) + groupCourses(addedMeetings, "added", emptySet())
    }
}
