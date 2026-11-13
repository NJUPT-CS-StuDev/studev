package top.hicancan.studev.ai

import java.time.LocalDate
import kotlin.math.roundToLong
import kotlinx.serialization.json.*
import top.hicancan.studev.world.dateLabel
import top.hicancan.studev.world.hm

/**
 * What the AI looked up, as src/campus/ai/steps.ts says it: one line for the whole (搜索资料 ×2 · 读原文 · 规划路线), and
 * each step with what it asked and what came back. The same call made twice is one step.
 */
object Steps {
    data class Step(val name: String, val label: String, val detail: String, val failed: Boolean, val pending: Boolean)
    data class Call(val id: String, val name: String, val arguments: String)

    private val LABELS = mapOf("search" to "搜索资料", "read" to "读原文", "find_place" to "找地点", "nearby" to "找附近", "route" to "规划路线", "timeline" to "查看安排", "exams" to "查考试", "list_tasks" to "读取任务",
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
            "read" -> text(field(result, "title")).let { if (done && it.isNotEmpty()) "《$it》" else "" }
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

    /** The steps of one answer, in the order they were taken, the same call made again taken once. */
    fun of(calls: List<Call>, results: Map<String, JsonElement>): List<Step> {
        val steps = LinkedHashMap<String, Step>()
        for (call in calls) {
            val args = runCatching { Json.parseToJsonElement(call.arguments).jsonObject }.getOrDefault(JsonObject(emptyMap()))
            val done = call.id in results; val result = results[call.id]
            val error = text(field(result, "error"))
            val key = "${call.name} ${canonical(args)}"
            steps[key] = Step(call.name, LABELS[call.name] ?: call.name, if (error.isNotEmpty()) "${detail(call.name, args, null, false)}：$error".removePrefix("：") else detail(call.name, args, result, done), error.isNotEmpty(), !done)
        }
        return steps.values.toList()
    }

    /** The arguments as one text, so that the same call is known again whatever its spacing. */
    private fun canonical(args: JsonObject) = args.toString()

    /** The steps in one line: what was done, each kind once, with how many times. */
    fun line(steps: List<Step>): String {
        val counts = LinkedHashMap<String, Int>(); steps.forEach { counts[it.label] = (counts[it.label] ?: 0) + 1 }
        return (if (steps.any { it.pending }) "正在" else "已") + counts.entries.joinToString(" · ") { (label, n) -> if (n > 1) "$label ×$n" else label }
    }
}
