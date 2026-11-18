package top.hicancan.studev.ai

import java.time.LocalDate
import kotlin.math.roundToLong
import kotlinx.serialization.json.*
import top.hicancan.studev.world.dateLabel
import top.hicancan.studev.world.hm

/**
 * What the AI looked up, as src/campus/ai/steps.ts says it: one line for the whole (搜索资料 ×2 · 读原文 · 规划路线), and
 * each call with what it asked and what came back, including failed attempts and retries.
 */
object Steps {
    data class Step(val name: String, val label: String, val detail: String, val failed: Boolean, val pending: Boolean)
    data class Call(val id: String, val name: String, val arguments: String)

    private val LABELS = mapOf("search" to "搜索资料", "read" to "读原文", "course" to "看课程", "schedule" to "查上课安排", "curriculum" to "查培养方案", "find_place" to "找地点", "nearby" to "找附近", "route" to "规划路线", "timeline" to "查看安排", "exams" to "查考试", "list_tasks" to "读取任务",
        "suggest_slots" to "找空闲时间", "free_rooms" to "查空教室", "propose_task" to "起草任务", "remember" to "记住")
    private fun text(value: JsonElement?) = (value as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
    private fun count(value: JsonElement?) = (value as? JsonArray)?.size ?: 0
    private fun field(value: JsonElement?, key: String) = (value as? JsonObject)?.get(key)
    private fun day(date: String) = runCatching { dateLabel(LocalDate.parse(date)) }.getOrDefault("")
    private fun days(from: String, to: String) = if (from == to) day(from) else "${day(from)}–${day(to)}"
    private fun number(value: JsonElement?) = (value as? JsonPrimitive)?.takeIf { !it.isString }?.content

    private fun detail(name: String, args: JsonObject, result: JsonElement?, done: Boolean): String {
        fun quoted(key: String) = "“${text(args[key])}”"
        return when (name) {
            "search" -> quoted("query") + (args["in"]?.let { if (text(it) != "全部") " · ${text(it)}" else "" } ?: "") + if (done) " · ${count(result)} 条" else ""
            "course" -> (text(field(result, "course")).let { if (it.isNotEmpty()) "《$it》" else quoted("course") }) + if (done) { (field(result, "chapters") as? JsonArray)?.let { " · ${it.size} 章" } ?: " · 没找到" } else ""
            "schedule" -> quoted("of") + if (done) { (field(result, "count") as? JsonPrimitive)?.intOrNull?.takeIf { it > 0 }?.let { " · $it 次课" } ?: " · 没有" } else ""
            "curriculum" -> (text(field(result, "major")).ifEmpty { text(args["major"]) }) + (if (text(args["grade"]).isNotEmpty()) " ${text(args["grade"])} 级" else "") + if (done) { (field(result, "terms") as? JsonArray)?.let { " · ${it.size} 个学期" } ?: " · 没找到" } else ""
            "read" -> text(field(result, "title")).let { if (done && it.isNotEmpty()) "《$it》" else quoted("id") }
            "find_place" -> { val first = (result as? JsonArray)?.firstOrNull()?.let { text(field(it, "name")) }.orEmpty(); quoted("query") + if (done) { if (first.isNotEmpty()) " → $first" else " · 没找到" } else "" }
            "nearby" -> "${text(field(result, "near")).ifEmpty { text(args["near"]) }}附近的${text(args["what"])}" + ((field(result, "places") as? JsonArray)?.let { if (done) " · ${it.size} 处" else "" } ?: "")
            "route" -> "${text(field(result, "from")).ifEmpty { text(args["from"]) }} → ${text(field(result, "to")).ifEmpty { text(args["to"]) }}" + ((field(result, "distance_m") as? JsonPrimitive)?.doubleOrNull?.let { " · ${it.roundToLong()} 米" } ?: "")
            "timeline" -> days(text(args["from"]), text(args["to"]))
            "exams" -> (field(result, "exams") as? JsonArray)?.let { if (done) "${it.size} 场" else "" } ?: ""
            "list_tasks" -> if (done) "${count(result)} 个" else ""
            "suggest_slots" -> "${days(text(args["from"]), text(args["to"]))} · ${number(args["minutes"])} 分钟" + if (done) " · ${count(result)} 个空档" else ""
            "free_rooms" -> "${day(text(args["date"]))} ${(args["minute"] as? JsonPrimitive)?.intOrNull?.let(::hm).orEmpty()}" + (args["building"]?.let { if (text(it).isNotEmpty()) " · ${text(it)}" else "" } ?: "") + if (done) " · ${count(field(result, "rooms"))} 间" else ""
            "propose_task" -> quoted("title")
            "remember" -> quoted("fact")
            else -> ""
        }
    }

    /** Every call in order; a retry never overwrites an earlier attempt. */
    fun of(calls: List<Call>, results: Map<String, JsonElement>, remoteLabels: Map<String, String> = emptyMap()): List<Step> {
        val steps = mutableListOf<Step>()
        for (call in calls) {
            val args = runCatching { Json.parseToJsonElement(call.arguments).jsonObject }.getOrDefault(JsonObject(emptyMap()))
            val done = call.id in results; val result = results[call.id]
            val error = text(field(result, "error"))
            val label = LABELS[call.name] ?: remoteLabels[call.name] ?: if (call.name.startsWith("mcp_")) "远程工具" else call.name
            steps += Step(call.name, label, if (error.isNotEmpty()) "${detail(call.name, args, null, false)}：$error".removePrefix("：") else detail(call.name, args, result, done), error.isNotEmpty(), !done)
        }
        return steps
    }

    /** The steps in one line: what was done, each kind once, with how many times. */
    fun line(steps: List<Step>): String {
        return steps.groupBy { it.label }.entries.joinToString(" · ") { (label, group) ->
            val failed = group.count { it.failed }; val pending = group.count { it.pending }
            label + (if (group.size > 1) " ×${group.size}" else "") + (if (failed > 0) "（失败 $failed）" else "") + (if (pending > 0) "（进行中 $pending）" else "")
        }
    }
}
