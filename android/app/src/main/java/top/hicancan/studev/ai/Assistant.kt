package top.hicancan.studev.ai

import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

/**
 * The AI's one contract, as src/campus/world/assistant.mjs: what the model is told (assistant.json, today's date filled
 * in) and the tools it may call (tools.json), both read from the assets the build copies from the web's own files.
 */
class Assistant(val prompt: List<String>, val tools: List<JsonObject>) {
    private val names = tools.map { it.getValue("function").jsonObject.getValue("name").jsonPrimitive.content }.toSet()

    /** What the model is told before the conversation. */
    fun instructions(now: Instant = Instant.now()) = prompt.joinToString("\n").replace("{date}", now.atZone(NANJING).toLocalDate().toString())

    /** The request a provider is sent, OpenAI's chat completions as every provider speaks it. */
    fun request(model: String, messages: List<JsonObject>, now: Instant = Instant.now()) = buildJsonObject {
        put("model", model); put("stream", true); put("max_tokens", 2048); put("temperature", 0.2)
        put("tools", JsonArray(tools))
        put("messages", JsonArray(listOf(buildJsonObject { put("role", "system"); put("content", instructions(now)) }) + messages))
    }

    /** A streamed answer read line by line, as Completion in assistant.mjs. */
    inner class Completion {
        private val content = StringBuilder()
        private var finish: String? = null
        private val calls = sortedMapOf<Int, Triple<StringBuilder, StringBuilder, StringBuilder>>()

        /** One line of the stream; the piece of the answer it adds, or "". */
        fun take(line: String): String {
            if (!line.startsWith("data:")) return ""
            val data = line.removePrefix("data:").trim()
            if (data.isEmpty() || data == "[DONE]") return ""
            val choice = Json.parseToJsonElement(data).jsonObject["choices"]?.jsonArray?.firstOrNull()?.jsonObject ?: return ""
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
            val piece = (delta["content"] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
            content.append(piece)
            return piece
        }

        /** The turn, once the stream has ended, or why it is not one. */
        fun result(): Result<JsonObject> {
            val made = calls.values.map { (id, name, arguments) -> buildJsonObject { put("id", id.toString()); put("type", "function"); put("function", buildJsonObject { put("name", name.toString()); put("arguments", arguments.toString()) }) } }
            if (finish !in setOf("stop", "tool_calls") || made.any { it.getValue("id").jsonPrimitive.content.isEmpty() || it.getValue("function").jsonObject.getValue("name").jsonPrimitive.content !in names })
                return Result.failure(IllegalStateException("AI 回答未完成，请缩短问题后重试。"))
            return Result.success(buildJsonObject {
                put("role", "assistant"); put("content", content.takeIf { it.isNotEmpty() }?.toString()?.let(::JsonPrimitive) ?: JsonNull)
                if (made.isNotEmpty()) put("tool_calls", JsonArray(made))
            })
        }
    }

    /** Asking with one's own key, straight from this device: no sign-in, nothing through the platform. */
    suspend fun askOwn(own: Own, messages: List<JsonObject>, onDelta: (String) -> Unit): JsonObject = withContext(Dispatchers.IO) {
        Models.addressError(own.base)?.let { throw IllegalStateException(it) }
        val connection = try { URI(Models.endpoint(own.base)).toURL().openConnection() as HttpURLConnection } catch (e: Exception) { throw IllegalStateException("你填的接口地址无效。") }
        try {
            connection.connectTimeout = 15_000; connection.readTimeout = 90_000
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"; connection.doOutput = true
            connection.setRequestProperty("Accept", "text/event-stream"); connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${own.key}")
            val status = try {
                connection.outputStream.use { it.write(request(own.model, messages).toString().toByteArray(Charsets.UTF_8)) }
                connection.responseCode
            } catch (e: java.io.IOException) { throw IllegalStateException("连不上你填的接口地址，检查一下地址和网络。") }
            if (status !in 200..299) {
                val said = connection.errorStream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
                val detail = runCatching { Json.parseToJsonElement(said).jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.contentOrNull }.getOrNull()
                throw IllegalStateException(when (status) {
                    401 -> "你的 API Key 无效，在模型里改一下。"; 402 -> "你的 API 余额不足。"
                    404 -> "接口或模型不存在" + (detail?.let { "：$it" } ?: "，检查地址和模型名。"); 429 -> "你的 API 请求太频繁，稍后再试。"
                    else -> "你的 API 没有回答（$status）" + (detail?.let { "：$it" } ?: "")
                })
            }
            val completion = Completion()
            connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                while (true) { val line = reader.readLine() ?: break; completion.take(line).takeIf { it.isNotEmpty() }?.let { piece -> withContext(Dispatchers.Main) { onDelta(piece) } } }
            }
            completion.result().getOrThrow()
        } finally { connection.disconnect() }
    }

    companion object {
        val NANJING: ZoneId = ZoneId.of("Asia/Shanghai")
        fun of(prompt: JsonObject, tools: JsonArray) = Assistant(prompt.getValue("prompt").jsonArray.map { it.jsonPrimitive.content }, tools.map { it.jsonObject })
        fun load(context: android.content.Context) = of(
            Json.parseToJsonElement(context.assets.open("assistant/assistant.json").bufferedReader().use { it.readText() }).jsonObject,
            Json.parseToJsonElement(context.assets.open("assistant/tools.json").bufferedReader().use { it.readText() }).jsonArray)
    }
}

/** One's own provider, as Own in src/campus/ai/model.ts: where, which model, and the key, which never leaves this device. */
data class Own(val base: String, val model: String, val key: String)

/** Which model answers, as src/campus/ai/model.ts: the free quota, or one's own key. */
object Models {
    val STARTING = Own("https://api.deepseek.com", "deepseek-flash", "")
    fun endpoint(base: String): String { val root = base.trim().trimEnd('/'); return if (root.endsWith("/chat/completions")) root else "$root/chat/completions" }
    fun addressError(base: String): String? = runCatching {
        val uri = URI(base.trim())
        if (uri.scheme == "https" && !uri.host.isNullOrEmpty() && uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null) null
        else "请填写完整的 HTTPS 接口地址，不带账号、查询参数或片段。"
    }.getOrElse { "请填写完整的 HTTPS 接口地址，不带账号、查询参数或片段。" }
    fun name(own: Own) = own.model.ifBlank { "我的 API" }
    fun read(prefs: android.content.SharedPreferences): Pair<Boolean, Own> {
        val own = Own(prefs.getString("base", null) ?: STARTING.base, prefs.getString("model", null) ?: STARTING.model, prefs.getString("key", null).orEmpty())
        return (prefs.getString("use", "free") == "own" && own.key.isNotBlank()) to own
    }
    fun write(prefs: android.content.SharedPreferences, useOwn: Boolean, own: Own) =
        prefs.edit().putString("use", if (useOwn && own.key.isNotBlank()) "own" else "free").putString("base", own.base).putString("model", own.model).putString("key", own.key).apply()
}
