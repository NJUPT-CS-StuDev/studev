package top.hicancan.studev.ai

import android.content.Context
import android.content.SharedPreferences
import java.io.BufferedReader
import java.io.IOException
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable internal data class RemoteServer(
    val id: String,
    val name: String = "",
    val url: String = "",
    val key: String = "",
    val enabled: Boolean = false,
    val tools: List<RemoteTool> = emptyList(),
)

@Serializable internal data class RemoteTool(val name: String, val label: String, val description: String, val schema: JsonObject)

internal data class RemoteCall(val id: String, val server: RemoteServer, val tool: RemoteTool) {
    val label: String get() = "${server.name} · ${tool.label}"
    fun definition() = buildJsonObject {
        put("type", "function")
        put("function", buildJsonObject { put("name", id); put("description", tool.description); put("parameters", tool.schema) })
    }
}

internal object RemoteMcpPreferences {
    private val json = Json { ignoreUnknownKeys = true }
    fun store(context: Context): SharedPreferences = context.getSharedPreferences("ai_remote_tools", Context.MODE_PRIVATE)
    fun read(store: SharedPreferences): List<RemoteServer> = runCatching {
        json.decodeFromString<List<RemoteServer>>(store.getString("servers", "[]").orEmpty())
    }.getOrDefault(emptyList())
    fun save(store: SharedPreferences, servers: List<RemoteServer>) { store.edit().putString("servers", json.encodeToString(servers)).apply() }
}

internal object RemoteMcp {
    private const val VERSION = "2025-11-25"
    private val versions = setOf(VERSION, "2025-06-18", "2025-03-26")
    private const val MAX_ACTIVE = 16
    private const val MAX_RESPONSE = 256_000
    private const val MAX_RESULT = 24_000
    private const val MAX_SCHEMA = 8_192
    private const val MAX_SCHEMA_TOTAL = 32_768
    private val namePattern = Regex("^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$")
    private val idPattern = Regex("^[a-f0-9]{12}$")
    private val spacing = Regex("[\\p{Cc}\\p{Cf}\\s]+")
    private val referenceKeys = setOf("\$id", "\$ref", "\$dynamicRef", "\$recursiveRef")

    fun endpoint(value: String): URI? = runCatching { URI(value.trim()) }.getOrNull()?.takeIf {
        it.scheme.equals("https", ignoreCase = true) && !it.host.isNullOrBlank() && it.userInfo == null && it.rawFragment == null
    }

    fun alias(serverId: String, name: String): String? {
        val prefix = serverId.replace("-", "").take(12).lowercase()
        if (!idPattern.matches(prefix) || !namePattern.matches(name)) return null
        return ("mcp_${prefix}_${name.replace("_", "__").replace(".", "_d")}").takeIf { it.length <= 64 }
    }

    fun known(servers: List<RemoteServer>): List<RemoteCall> = servers.flatMap { server ->
        server.tools.mapNotNull { tool -> alias(server.id, tool.name)?.let { RemoteCall(it, server, tool) } }
    }.distinctBy { it.id }

    fun active(servers: List<RemoteServer>): List<RemoteCall> = buildList {
        var bytes = 0
        for (call in known(servers.filter { it.enabled && endpoint(it.url) != null })) {
            val next = call.tool.schema.toString().toByteArray(Charsets.UTF_8).size
            if (bytes + next > MAX_SCHEMA_TOTAL) continue
            add(call)
            bytes += next
            if (size == MAX_ACTIVE) break
        }
    }

    fun advertised(serverId: String, item: JsonObject): RemoteTool? {
        val annotations = item["annotations"] as? JsonObject ?: return null
        if (annotations["readOnlyHint"] != JsonPrimitive(true) || annotations["destructiveHint"] == JsonPrimitive(true)) return null
        val name = (item["name"] as? JsonPrimitive)?.contentOrNull ?: return null
        if (alias(serverId, name) == null) return null
        val schema = sanitizeSchema(item["inputSchema"] as? JsonObject ?: return null) ?: return null
        val label = ((item["title"] as? JsonPrimitive)?.contentOrNull ?: name).trim().take(80).ifBlank { name }
        val description = shortDescription((item["description"] as? JsonPrimitive)?.contentOrNull.orEmpty()).ifBlank { label }
        return RemoteTool(name, label, description, schema)
    }

    private fun shortDescription(text: String) = text.replace(spacing, " ").trim().take(600)

    private fun sanitizeSchema(schema: JsonObject): JsonObject? {
        if (schema["type"] != JsonPrimitive("object")) return null
        var nodes = 0
        fun clean(value: JsonElement, depth: Int): JsonElement {
            require(depth <= 12 && ++nodes <= 512)
            return when (value) {
                is JsonObject -> JsonObject(value.mapValues { (key, child) ->
                    if (key in referenceKeys && child is JsonPrimitive && child.isString) require(child.content.startsWith('#'))
                    if (key == "description" && child is JsonPrimitive && child.isString) JsonPrimitive(shortDescription(child.content))
                    else clean(child, depth + 1)
                })
                is JsonArray -> JsonArray(value.map { clean(it, depth + 1) })
                else -> value
            }
        }
        return (runCatching { clean(JsonObject(schema - "\$schema"), 0) as JsonObject }.getOrNull())
            ?.takeIf { it.toString().toByteArray(Charsets.UTF_8).size <= MAX_SCHEMA }
    }

    suspend fun discover(server: RemoteServer): List<RemoteTool> = connected(server) { session ->
        val tools = linkedMapOf<String, RemoteTool>()
        val cursors = mutableSetOf<String>()
        var cursor: String? = null
        repeat(8) {
            val next = session.send("tools/list", buildJsonObject { cursor?.let { put("cursor", it) } })
            val offered = next["tools"] as? JsonArray ?: error("MCP 没有返回有效的工具列表。")
            for (item in offered) {
                val tool = (item as? JsonObject)?.let { advertised(server.id, it) } ?: continue
                tools.putIfAbsent(tool.name, tool)
                if (tools.size >= MAX_ACTIVE) return@connected tools.values.toList()
            }
            cursor = (next["nextCursor"] as? JsonPrimitive)?.contentOrNull
            if (cursor.isNullOrEmpty() || !cursors.add(cursor.orEmpty())) return@connected tools.values.toList()
        }
        tools.values.toList()
    }

    suspend fun call(call: RemoteCall, input: JsonObject): JsonObject = connected(call.server) { session ->
        check(input.toString().length <= 4_096) { "远程工具的参数太长。" }
        val result = session.send("tools/call", buildJsonObject { put("name", call.tool.name); put("arguments", input) })
        check(result.toString().length <= MAX_RESULT) { "远程工具返回的内容太长。" }
        if (result["isError"] == JsonPrimitive(true)) JsonObject(result + ("error" to JsonPrimitive("远程工具未能完成请求。"))) else result
    }

    private suspend fun <T> connected(server: RemoteServer, action: suspend (Session) -> T): T {
        val endpoint = endpoint(server.url) ?: error("请输入 HTTPS 地址。")
        val key = server.key.takeIf { it.isNotEmpty() }
        check(key == null || key.none { it == '\r' || it == '\n' }) { "访问密钥格式无效。" }
        return withTimeoutOrNull(15_000L) {
            val session = Session(endpoint, key)
            try {
                session.initialize()
                action(session)
            } catch (error: CancellationException) {
                throw error
            } catch (error: IOException) {
                currentCoroutineContext().ensureActive()
                throw IllegalStateException("暂时连不上这个 MCP 服务，请检查地址和网络。")
            } finally {
                withTimeoutOrNull(1_200L) { session.close() }
            }
        } ?: error("连接 MCP 服务超时，请重试。")
    }

    private class Session(private val endpoint: URI, private val key: String?) {
        private var version: String? = null
        private var sessionId: String? = null
        private var sequence = 0

        suspend fun initialize() {
            val result = send("initialize", buildJsonObject {
                put("protocolVersion", VERSION)
                put("capabilities", buildJsonObject {})
                put("clientInfo", buildJsonObject { put("name", "StuDev"); put("version", top.hicancan.studev.BuildConfig.VERSION_NAME) })
            })
            val offered = (result["protocolVersion"] as? JsonPrimitive)?.contentOrNull
            check(offered in versions) { "这个 MCP 服务的协议版本暂不支持。" }
            version = offered
            exchange("POST", "notifications/initialized", null, null)
        }

        suspend fun close() {
            if (sessionId == null) return
            try { exchange("DELETE", null, null, null) }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { /* A server can decline client-initiated cleanup. */ }
        }

        suspend fun send(method: String, params: JsonObject): JsonObject {
            val response = exchange("POST", method, params, ++sequence) ?: error("MCP 没有返回结果。")
            check(response["error"] == null) { "MCP 服务未能完成请求。" }
            return response["result"] as? JsonObject ?: error("MCP 返回了无效结果。")
        }

        private suspend fun exchange(verb: String, method: String?, params: JsonObject?, id: Int?): JsonObject? = withContext(Dispatchers.IO) {
            val connection = endpoint.toURL().openConnection() as HttpsURLConnection
            val cancellation = launch(start = CoroutineStart.UNDISPATCHED) { try { awaitCancellation() } finally { connection.disconnect() } }
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15_000
                connection.readTimeout = 15_000
                connection.requestMethod = verb
                connection.setRequestProperty("Accept", "application/json, text/event-stream")
                connection.setRequestProperty("Content-Type", "application/json")
                key?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
                version?.let { connection.setRequestProperty("MCP-Protocol-Version", it) }
                sessionId?.let { connection.setRequestProperty("Mcp-Session-Id", it) }
                if (method != null) {
                    val body = buildJsonObject { put("jsonrpc", "2.0"); put("method", method); id?.let { put("id", it) }; params?.let { put("params", it) } }
                    connection.doOutput = true
                    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                val status = connection.responseCode
                check(status in 200..299) { when (status) {
                    401, 403 -> "MCP 未授权，请检查访问密钥。"
                    in 300..399 -> "MCP 地址发生跳转，请填写实际地址。"
                    else -> "MCP 服务未能完成请求（$status）。"
                } }
                if (version == null) sessionId = connection.getHeaderField("Mcp-Session-Id")?.takeIf { it.length <= 256 && it.all { c -> c in '!'..'~' } }
                if (id == null) return@withContext null
                connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                    val kind = connection.contentType?.substringBefore(';')?.trim()?.lowercase()
                    when (kind) {
                        "application/json" -> envelope(readText(reader), id) ?: error("MCP 返回了无效的请求编号。")
                        "text/event-stream" -> readEvents(reader, id) ?: error("MCP 的响应已中断。")
                        else -> error("MCP 返回了不支持的响应格式。")
                    }
                }
            } finally {
                cancellation.cancel()
                connection.disconnect()
            }
        }
    }

    private fun envelope(source: String, id: Int): JsonObject? = runCatching { Json.parseToJsonElement(source) as? JsonObject }.getOrNull()
        ?.takeIf { it["jsonrpc"] == JsonPrimitive("2.0") && it["id"] == JsonPrimitive(id) }

    private fun readText(reader: BufferedReader): String {
        val buffer = CharArray(4096)
        val text = StringBuilder()
        while (true) {
            val read = reader.read(buffer)
            if (read < 0) return text.toString()
            check(text.length + read <= MAX_RESPONSE) { "MCP 响应内容太长。" }
            text.append(buffer, 0, read)
        }
    }

    private fun readEvents(reader: BufferedReader, id: Int): JsonObject? {
        var count = 0
        val data = StringBuilder()
        val pending = StringBuilder()
        fun finishLine(): JsonObject? {
            val line = pending.toString().removeSuffix("\r")
            pending.clear()
            if (line.startsWith("data:")) data.appendLine(line.removePrefix("data:").removePrefix(" "))
            if (line.isEmpty() && data.isNotEmpty()) {
                envelope(data.toString().trimEnd(), id)?.let { return it }
                data.clear()
            }
            return null
        }
        while (true) {
            val char = reader.read()
            if (char < 0) { finishLine()?.let { return it }; return envelope(data.toString().trimEnd(), id) }
            check(++count <= MAX_RESPONSE) { "MCP 响应内容太长。" }
            if (char == '\n'.code) finishLine()?.let { return it }
            else pending.append(char.toChar())
        }
    }

    fun history(messages: List<JsonObject>, active: Set<String>): List<JsonObject> {
        val dropped = mutableSetOf<JsonElement>()
        val completed = messages.filter { it["role"] == JsonPrimitive("tool") }.mapNotNull { it["tool_call_id"] }.toSet()
        return messages.mapNotNull { message ->
            if (message["role"] == JsonPrimitive("tool") && message["tool_call_id"] in dropped) return@mapNotNull null
            val calls = message["tool_calls"] as? JsonArray ?: return@mapNotNull message
            val kept = calls.filter { value ->
                val call = value.jsonObject
                val name = call["function"]?.jsonObject?.get("name")?.jsonPrimitive?.contentOrNull.orEmpty()
                val allowed = call["id"] in completed && (!name.startsWith("mcp_") || name in active)
                if (!allowed) call["id"]?.let(dropped::add)
                allowed
            }
            when {
                kept.size == calls.size -> message
                kept.isNotEmpty() -> JsonObject(message + ("tool_calls" to JsonArray(kept)))
                (message["content"] as? JsonPrimitive)?.contentOrNull?.isNotBlank() == true -> JsonObject(message - "tool_calls")
                else -> null
            }
        }
    }
}
