package top.hicancan.studev.world

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

/**
 * What students have shared for a course, as src/campus/world/materials.ts: a course on the timetable finds its
 * materials by its name, written the same way (高等数学A(上) is 高等数学A（上）); a course whose name matches none has none.
 */
@Serializable data class Material(val title: String, val url: String, val kind: String, val term: String? = null, val ext: String? = null)
@Serializable data class MaterialNote(val title: String, val url: String)
@Serializable data class CourseMaterials(val course: String, val source: String, val note: MaterialNote? = null, val items: List<Material>)

object Materials {
    /** The kinds, in the order they are shown. */
    val KINDS = listOf("试卷", "答案", "复习", "习题", "课件", "实验", "资料")

    /** A course name as compared: brackets one width, no spaces, letters small. */
    fun key(name: String) = name.replace('（', '(').replace('）', ')').replace(Regex("[ \t　]"), "").lowercase()

    fun of(all: List<CourseMaterials>, course: String): CourseMaterials? = key(course).let { k -> all.firstOrNull { key(it.course) == k } }

    /** How many of each kind, in the order shown. */
    fun counts(items: List<Material>) = KINDS.map { kind -> kind to items.count { it.kind == kind } }.filter { it.second > 0 }

    /** A course's materials as the AI is told them, as materialsSaid in materials.ts. */
    fun said(all: List<CourseMaterials>, course: String): JsonObject {
        of(all, course)?.let { found ->
            return buildJsonObject {
                put("course", found.course)
                put("kinds", buildJsonObject {
                    for (kind in KINDS) {
                        val items = found.items.filter { it.kind == kind }.take(12)
                        if (items.isNotEmpty()) put(kind, JsonArray(items.map { item -> buildJsonObject { put("title", item.title); put("url", item.url); item.term?.let { put("term", it) } } }))
                    }
                })
            }
        }
        val stem = Regex("[a-z]$|\\(.\\)$")
        val k = key(course).replace(stem, "")
        val like = all.filter { k.length >= 2 && (key(it.course).contains(k) || k.contains(key(it.course).replace(stem, ""))) }.map { it.course }
        return buildJsonObject { put("course", course); put("found", false); if (like.isNotEmpty()) put("courses", JsonArray(like.map(::JsonPrimitive))) }
    }
}
