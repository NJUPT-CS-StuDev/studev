package top.hicancan.studev.ai

import android.content.Context
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

/** The campus context, instructions and enabled memory, as in src/campus/world/assistant.mjs. */
data class Situation(val week: Int?, val klass: String?, val campus: String, val memory: String?, val instructions: String? = null) {
    fun toJson() = buildJsonObject {
        put("week", week); put("class", klass); put("campus", campus); put("memory", memory)
        instructions?.let { put("instructions", it) }
    }
}

internal data class FreeService(val providerName: String, val modelName: String, val description: String)

private fun JsonObject.freeService(): FreeService {
    val art = getValue("freeService").jsonObject
    return FreeService(art.getValue("providerName").jsonPrimitive.content,
        art.getValue("modelName").jsonPrimitive.content, art.getValue("description").jsonPrimitive.content)
}

/**
 * The AI's one contract, as src/campus/world/assistant.mjs: what the model is told (assistant.json, filled in with the
 * moment and who is asking) and the tools it may call (tools.json), both read from the assets the build copies from
 * the web's own files.
 */
class Assistant(private val contract: JsonObject, val tools: List<JsonObject>) {
    private val names = tools.map { it.getValue("function").jsonObject.getValue("name").jsonPrimitive.content }.toSet()
    private fun lines(key: String) = contract.getValue(key).jsonArray.map { it.jsonPrimitive.content }
    private fun phrase(group: String, key: String) = contract.getValue(group).jsonObject.getValue(key).jsonPrimitive.content
    private fun fill(text: String, values: Map<String, Any?>) = Regex("\\{(\\w+)\\}").replace(text) { values[it.groupValues[1]].toString() }
    val diagrams = contract.getValue("diagrams").jsonArray.map { it.jsonPrimitive.content }
    internal val freeService get() = contract.freeService()

    /** The reader's campus and class, for example 仙林校区 TEST000001 班的同学. */
    private fun who(s: Situation): String {
        val where = fill(phrase("me", if (s.klass != null) "class" else "noClass"), mapOf("campus" to s.campus, "class" to s.klass))
        return where + phrase("me", "anyone")
    }

    /** What the model is told before the conversation. */
    fun instructions(s: Situation, now: Instant = Instant.now()): String {
        val week = when (s.week) { null -> phrase("week", "unknown"); 0 -> phrase("week", "out"); else -> fill(phrase("week", "in"), mapOf("week" to s.week)) }
        val values = mapOf("now" to nanjingNow(now), "week" to week, "me" to who(s), "diagrams" to diagrams.joinToString("、"))
        return buildList {
            addAll(lines("prompt").map { fill(it, values) })
            val custom = s.instructions?.trim().orEmpty()
            if (custom.isEmpty()) add(contract.getValue("style").jsonPrimitive.content)
            else { add(contract.getValue("instructionIntro").jsonPrimitive.content); add(custom) }
            if (s.memory != null) addAll(lines("memory").map { fill(it, mapOf("memory" to s.memory.trim().ifEmpty { "（还没有）" })) })
        }.joinToString("\n")
    }

    /** The tools offered: all of them, but `remember` only to someone who keeps a memory. */
    fun toolsFor(s: Situation) = if (s.memory == null) tools.filter { it.getValue("function").jsonObject.getValue("name").jsonPrimitive.content != "remember" } else tools

    /** The request a provider is sent, OpenAI's chat completions as every provider speaks it. */
    fun request(model: String, messages: List<JsonObject>, s: Situation, now: Instant = Instant.now(), last: Boolean = false) = buildJsonObject {
        put("model", model); put("stream", true); put("max_tokens", 4096); put("temperature", 0.2)
        if (!last) put("tools", JsonArray(toolsFor(s)))
        put("messages", JsonArray(listOf(buildJsonObject { put("role", "system"); put("content", instructions(s, now) + if (last) "\n${contract.getValue("finish").jsonPrimitive.content}" else "") }) + messages))
    }

    /** A streamed answer read line by line, as Completion in assistant.mjs. */
    inner class Completion {
        private val content = StringBuilder()
        private var finish: String? = null
        private val calls = sortedMapOf<Int, Triple<StringBuilder, StringBuilder, StringBuilder>>()
        private var pending = ""
        private var protocolError = false

        /** One line of the stream; the piece of the answer it adds, or "". */
        fun take(line: String): String {
            if (!line.startsWith("data:")) return ""
            val data = line.removePrefix("data:").trim()
            if (data.isEmpty() || data == "[DONE]") return ""
            val envelope = Json.parseToJsonElement(data).jsonObject
            envelope["error"]?.takeUnless { it is JsonNull }?.let { error ->
                val message = ((error as? JsonObject)?.get("message") as? JsonPrimitive)?.contentOrNull
                    ?: (error as? JsonPrimitive)?.contentOrNull ?: "模型服务未能完成请求。"
                throw IllegalStateException(message)
            }
            val choice = envelope["choices"]?.jsonArray?.firstOrNull()?.jsonObject ?: return ""
            val delta = choice["delta"] as? JsonObject ?: JsonObject(emptyMap())
            delta["tool_calls"]?.jsonArray?.forEach { item ->
                val part = item.jsonObject
                val call = calls.getOrPut(part["index"]?.jsonPrimitive?.intOrNull ?: calls.size) { Triple(StringBuilder(), StringBuilder(), StringBuilder()) }
                part["id"]?.jsonPrimitive?.contentOrNull?.let { call.first.clear(); call.first.append(it) }
                part["function"]?.jsonObject?.let { function ->
                    function["name"]?.jsonPrimitive?.contentOrNull?.let { call.second.append(it) }
                    function["arguments"]?.jsonPrimitive?.contentOrNull?.let { call.third.append(it) }
                }
            }
            choice["finish_reason"]?.jsonPrimitive?.contentOrNull?.let { finish = it }
            if (protocolError) return ""
            pending += (delta["content"] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
            val markers = listOf("<｜DSML｜", "<|DSML|")
            val found = markers.map { pending.indexOf(it) }.filter { it >= 0 }.minOrNull()
            if (found != null) {
                val piece = pending.take(found)
                content.append(piece); pending = ""; protocolError = true
                return piece
            }
            var held = (1..minOf(pending.length, 7)).filter { size -> markers.any { it.startsWith(pending.takeLast(size)) } }.maxOrNull() ?: 0
            if (finish != null) {
                if (held > 1) { protocolError = true; pending = ""; return "" }
                held = 0
            }
            val piece = pending.dropLast(held)
            pending = pending.takeLast(held)
            content.append(piece)
            return piece
        }

        /** The turn, once the stream has ended, or why it is not one. */
        fun result(): Result<JsonObject> {
            if (protocolError) return Result.failure(IllegalStateException("模型未能正确发起查询，请重试。"))
            val made = calls.values.map { (id, name, arguments) -> buildJsonObject { put("id", id.toString()); put("type", "function"); put("function", buildJsonObject { put("name", name.toString()); put("arguments", arguments.toString()) }) } }
            // An answer cut at its length is still an answer, what it got to say; a cut tool call is not.
            val whole = finish in setOf("stop", "tool_calls") || (finish == "length" && made.isEmpty() && content.isNotEmpty())
            if (!whole || made.any { it.getValue("id").jsonPrimitive.content.isEmpty() || it.getValue("function").jsonObject.getValue("name").jsonPrimitive.content !in names })
                return Result.failure(IllegalStateException("AI 回答未完成，请缩短问题后重试。"))
            return Result.success(buildJsonObject {
                put("role", "assistant"); put("content", content.takeIf { it.isNotEmpty() }?.toString()?.let(::JsonPrimitive) ?: JsonNull)
                if (made.isNotEmpty()) put("tool_calls", JsonArray(made))
            })
        }
    }

    /** Asking with one's own key, straight from this device: no sign-in, nothing through the platform. */
    suspend fun askOwn(own: Own, messages: List<JsonObject>, situation: Situation, last: Boolean, onDelta: (String) -> Unit): JsonObject = withContext(Dispatchers.IO) {
        Models.addressError(own.base)?.let { throw IllegalStateException(it) }
        val connection = try { URI(Models.endpoint(own.base)).toURL().openConnection() as HttpURLConnection } catch (e: Exception) { throw IllegalStateException("你填的接口地址无效。") }
        // A separate suspended child reacts while readLine is blocked on the IO thread.
        val cancellation = launch(start = CoroutineStart.UNDISPATCHED) { try { awaitCancellation() } finally { connection.disconnect() } }
        try {
            connection.connectTimeout = 15_000; connection.readTimeout = 90_000
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"; connection.doOutput = true
            connection.setRequestProperty("Accept", "text/event-stream"); connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${own.key}")
            val status = try {
                connection.outputStream.use { it.write(request(own.model, messages, situation, last = last).toString().toByteArray(Charsets.UTF_8)) }
                connection.responseCode
            } catch (e: java.io.IOException) { currentCoroutineContext().ensureActive(); throw IllegalStateException("连不上你填的接口地址，检查一下地址和网络。") }
            if (status !in 200..299) {
                val said = connection.errorStream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
                val providerError = runCatching { Json.parseToJsonElement(said).jsonObject["error"]?.jsonObject }.getOrNull()
                val detail = providerError?.get("message")?.jsonPrimitive?.contentOrNull
                throw IllegalStateException(when (status) {
                    401 -> "API Key 无效或无权限，请在“模型服务”里检查。"; 402 -> "你的 API 余额不足。"
                    404 -> "接口或模型不存在" + (detail?.let { "：$it" } ?: "，检查地址和模型名。"); 429 -> "你的 API 请求太频繁，稍后再试。"
                    else -> "你的 API 没有回答（$status）" + (detail?.let { "：$it" } ?: "")
                })
            }
            val completion = Completion()
            connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                while (true) { currentCoroutineContext().ensureActive(); val line = reader.readLine() ?: break; completion.take(line).takeIf { it.isNotEmpty() }?.let { piece -> withContext(Dispatchers.Main) { onDelta(piece) } } }
            }
            completion.result().getOrThrow()
        } catch (error: java.io.IOException) {
            currentCoroutineContext().ensureActive()
            throw IllegalStateException("与模型服务的连接中断了，请重试。", error)
        } finally { cancellation.cancel(); connection.disconnect() }
    }

    companion object {
        /** How many times the model may look things up for one question, as ROUNDS in assistant.mjs. */
        const val ROUNDS = 8
        val NANJING: ZoneId = ZoneId.of("Asia/Shanghai")
        private val WEEKDAYS = listOf("", "周一", "周二", "周三", "周四", "周五", "周六", "周日")
        /** The moment in Nanjing, as people say it: 2026年11月13日 周五 16:40. */
        fun nanjingNow(now: Instant): String { val at = now.atZone(NANJING); return "%d年%d月%d日 %s %02d:%02d".format(at.year, at.monthValue, at.dayOfMonth, WEEKDAYS[at.dayOfWeek.value], at.hour, at.minute) }
        fun of(contract: JsonObject, tools: JsonArray) = Assistant(contract, tools.map { it.jsonObject })
        private fun loadContract(context: Context) =
            Json.parseToJsonElement(context.assets.open("world/assistant.json").bufferedReader().use { it.readText() }).jsonObject
        internal fun loadFreeService(context: Context) = loadContract(context).freeService()
        fun load(context: Context) = of(
            loadContract(context),
            Json.parseToJsonElement(context.assets.open("world/tools.json").bufferedReader().use { it.readText() }).jsonArray)
    }
}

/** One's own provider, as Own in src/campus/ai/model.ts: where, which model, and the key, which never leaves this device. */
data class Own(val base: String, val model: String, val key: String)

/** Which model answers, as src/campus/ai/model.ts: the free quota, or one's own key. */
object Models {
    fun endpoint(base: String): String { val root = base.trim().trimEnd('/'); return if (root.endsWith("/chat/completions")) root else "$root/chat/completions" }
    fun modelsEndpoints(base: String): List<String> {
        val root = base.trim().trimEnd('/').removeSuffix("/chat/completions").removeSuffix("/models")
        val first = "$root/models"
        return if (Regex("/v\\d+$").containsMatchIn(root)) listOf(first) else listOf(first, "$root/v1/models")
    }
    suspend fun fetchModels(base: String, key: String): List<String> = withContext(Dispatchers.IO) {
        require(addressError(base) == null) { "接口地址格式不对" }
        val trimmed = key.trim()
        require(trimmed.isNotEmpty()) { "请先填写 API Key" }
        for (url in modelsEndpoints(base)) {
            val conn = (URI(url).toURL().openConnection() as HttpURLConnection).apply {
                connectTimeout = 10_000; readTimeout = 15_000
                instanceFollowRedirects = false
                setRequestProperty("Authorization", "Bearer $trimmed")
                setRequestProperty("Accept", "application/json")
            }
            try {
                val status = conn.responseCode
                if (status == 404) continue
                if (status !in 200..299) throw IllegalStateException(if (status == 401) "API Key 无效或无权限" else "请求失败（$status）")
                val text = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val ids = Json.parseToJsonElement(text).jsonObject["data"]?.jsonArray
                    ?.mapNotNull { it.jsonObject["id"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { id -> id.isNotEmpty() } }
                    ?.distinct().orEmpty()
                if (ids.isNotEmpty()) return@withContext ids
            } finally { conn.disconnect() }
        }
        error("接口没有返回模型列表，可直接手动填写模型名")
    }
    fun addressError(base: String): String? {
        val uri = runCatching { URI(base.trim()) }.getOrNull()
        return if (uri?.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null) null
        else "接口地址以 https:// 开头，只写地址本身。"
    }
}
