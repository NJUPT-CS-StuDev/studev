package top.hicancan.studev.world

import kotlinx.serialization.json.*
import top.hicancan.studev.data.TeachingMeeting
import top.hicancan.studev.knowledge.CurriculumCourse
import top.hicancan.studev.knowledge.KnowledgeIndex

class UnknownReference : IllegalArgumentException("未知资料引用。请重新查询，并原样使用结果中的原文标识。")

/** What the AI is told when it asks about a course, a schedule or a training plan: src/campus/world/answers.ts. */
object Answers {
    private val WEEKDAY = listOf("", "周一", "周二", "周三", "周四", "周五", "周六", "周日")
    private const val SHOWN = 24

    /** Where a result's text is kept, as the data build writes it: an article by its own id, anything else by the first
     * 16 hex digits of the SHA-256 of its search id. */
    fun textKey(id: String): String = if (Regex("[0-9a-f]{16}").matches(id)) id
        else java.security.MessageDigest.getInstance("SHA-256").digest(id.toByteArray()).take(8).joinToString("") { "%02x".format(it) }

    /** Teaching weeks as read aloud: [1,2,3,5,7,8] → 1–3、5、7–8 周. */
    fun weeksText(weeks: List<Int>): String {
        val sorted = weeks.distinct().sorted(); val runs = mutableListOf<String>(); var start = 0
        sorted.forEachIndexed { i, week ->
            if (sorted.getOrNull(i + 1) == week + 1) return@forEachIndexed
            runs += if (start == i) "$week" else "${sorted[start]}–$week"
            start = i + 1
        }
        return if (runs.isEmpty()) "" else "${runs.joinToString("、")} 周"
    }

    /** encodeURIComponent: what the web writes into a link. */
    private fun component(value: String) = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        .replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")").replace("%7E", "~")
    private fun plainKey(name: String) = Materials.key(Regex("[（(].*?[)）]").replace(name, "").ifEmpty { name })
    /** A whole number as the web writes it (42, not 42.0). */
    private fun number(value: Double): JsonPrimitive = if (value % 1.0 == 0.0) JsonPrimitive(value.toLong()) else JsonPrimitive(value)

    fun course(index: KnowledgeIndex, shared: List<CourseMaterials>, asked: String): JsonObject {
        val key = Materials.key(asked); val code = asked.trim().uppercase()
        val course = index.courses.firstOrNull { Materials.key(it.name) == key || code in it.codes || code in it.former }
            ?: index.courses.filter { Materials.key(it.name).contains(key) }.singleOrNull()
        if (course == null) {
            val near = index.courses.filter { Materials.key(it.name).contains(key) || key.contains(plainKey(it.name)) }.take(8).map { JsonPrimitive(it.name) }
            val sharedOnly = Materials.said(shared, asked)
            return buildJsonObject { put("found", false); put("courses", JsonArray(near)); if ("kinds" in sharedOnly) put("shared", sharedOnly) }
        }
        val topics = index.topics.associateBy { it.id }
        val materials = linkedMapOf<String, MutableList<JsonObject>>()
        index.materials.filter { it.course == course.id }.forEach { material ->
            val list = materials.getOrPut(material.kind) { mutableListOf() }
            if (list.size < 12) list += buildJsonObject { put("title", material.title); put("id", textKey("sections/${material.path}")); put("path", material.path); put("url", "/knowledge/?material=${component(material.path)}") }
        }
        val sharedLinks = Materials.said(shared, course.name)
        return buildJsonObject {
            put("found", true); put("course", course.name); put("codes", JsonArray(course.codes.map(::JsonPrimitive))); put("url", "/knowledge/?course=${component(course.id)}")
            put("chapters", JsonArray(course.chapters.map { chapter -> buildJsonObject {
                put("title", chapter.title)
                put("topics", JsonArray(chapter.topics.map { id -> buildJsonObject { put("id", textKey("topics/$id")); put("title", topics[id]?.title ?: id); put("path", topics[id]?.path ?: "topics/$id.md"); put("url", "/knowledge/?topic=${component(id)}") } }))
            } }))
            put("materials", JsonObject(materials.mapValues { JsonArray(it.value) }))
            sharedLinks["kinds"]?.let { put("shared", it) }
        }
    }

    fun schedule(meetings: List<TeachingMeeting>, asked: String): JsonObject {
        val key = Materials.key(asked); val code = asked.trim().uppercase()
        fun room(meeting: TeachingMeeting) = (meeting.room ?: "").replace(Regex("^[^/:]*[/:]"), "").ifEmpty { meeting.location ?: "" }
        val found = meetings.filter { meeting ->
            meeting.course.code == code || plainKey(meeting.course.name) == plainKey(asked) || Materials.key(meeting.course.name) == key ||
                meeting.teachers.any { it.name == asked.trim() } || meeting.classes.any { it.uppercase() == code } ||
                (key.length >= 3 && Materials.key(room(meeting)) == key)
        }.sortedWith(compareBy<TeachingMeeting> { it.weekday }.thenBy { it.periods[0] }.thenBy { it.course.name })
        return buildJsonObject {
            put("asked", asked); put("count", found.size); if (found.size > SHOWN) put("cut", true)
            put("meetings", JsonArray(found.take(SHOWN).map { meeting -> buildJsonObject {
                put("course", meeting.course.name); put("teachers", JsonArray(meeting.teachers.map { JsonPrimitive(it.name) }))
                put("when", "${WEEKDAY[meeting.weekday]} ${meeting.periods[0]}–${meeting.periods[1]} 节")
                put("weeks", weeksText(meeting.weeks)); put("where", room(meeting)); put("campus", meeting.campus?.let(::JsonPrimitive) ?: JsonNull); put("classes", meeting.classes.size)
            } }))
        }
    }

    fun curriculum(courses: List<CurriculumCourse>, major: String, grade: String?): JsonObject {
        val all = courses.flatMap { it.plans.map { plan -> plan.major } }.distinct(); val asked = major.trim()
        val meant = if (all.any { it == asked }) listOf(asked) else all.filter { it.contains(asked) }
        val only = meant.singleOrNull() ?: return buildJsonObject { put("found", false); put("majors", JsonArray((meant.ifEmpty { all }).take(20).map(::JsonPrimitive))) }
        val grades = courses.flatMap { it.plans.filter { plan -> plan.major == only }.map { plan -> plan.grade } }.distinct().sorted()
        val selected = grade ?: grades.singleOrNull()
        if (selected == null || selected !in grades) return buildJsonObject { put("found", false); put("major", only); put("grades", JsonArray(grades.map(::JsonPrimitive))) }
        val chosen = courses.flatMap { course -> course.plans.filter { it.major == only && it.grade == selected }.map { course to it } }
        val terms = chosen.map { it.second.term }.distinct().sortedBy { it ?: 99 }
        val names = courses.associate { it.code to it.name }
        return buildJsonObject {
            put("found", true); put("major", only); put("grade", selected)
            put("terms", JsonArray(terms.map { term ->
                val list = chosen.filter { it.second.term == term }
                buildJsonObject {
                    put("term", term?.let(::JsonPrimitive) ?: JsonNull)
                    put("credits", if (list.all { it.second.credits != null }) number(list.sumOf { it.second.credits!! }) else JsonNull)
                    put("courses", JsonArray(list.map { (course, plan) -> buildJsonObject {
                        put("name", course.name); put("code", course.code); put("credits", plan.credits?.let(::number) ?: JsonNull); put("nature", plan.nature); put("category", plan.category)
                        if (course.requires.isNotEmpty()) put("requires", JsonArray(course.requires.map { JsonPrimitive(names[it] ?: it) }))
                    } }))
                }
            }))
        }
    }
}
