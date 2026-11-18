package top.hicancan.studev.ai

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class RemoteMcpTest {
    private val server = RemoteServer("4fc3e9fe-e77a-4f55-8a24-b2731b159fd2", "Context7", "https://mcp.context7.com/mcp")
    private val read = Json.parseToJsonElement("""{"name":"doc.query_v2","description":"Search docs","inputSchema":{"type":"object","properties":{"query":{"type":"string"}}},"annotations":{"readOnlyHint":true}}""").jsonObject

    @Test fun onlyValidReadOnlyToolsFromEnabledHttpsServersAreExposed() {
        val tool = RemoteMcp.advertised(server.id, read)!!
        val stored = server.copy(tools = listOf(tool))
        assertEquals(emptyList<RemoteCall>(), RemoteMcp.active(listOf(stored)))
        val enabled = stored.copy(enabled = true)
        val modelTool = RemoteMcp.active(listOf(enabled)).single()
        assertEquals("mcp_4fc3e9fee77a_doc_dquery__v2", toolName(modelTool.definition()))
        assertEquals("Search docs", modelTool.definition().getValue("function").jsonObject.getValue("description").jsonPrimitive.content)
        assertNull(RemoteMcp.advertised(server.id, JsonObject(read - "annotations")))
        assertNull(RemoteMcp.advertised(server.id, JsonObject(read + ("annotations" to buildJsonObject {
            put("readOnlyHint", true); put("destructiveHint", true)
        }))))
        assertNull(RemoteMcp.advertised(server.id, JsonObject(read + ("inputSchema" to buildJsonObject {
            put("type", "object"); put("\$ref", "https://other.example/schema")
        }))))
        assertEquals(emptyList<RemoteCall>(), RemoteMcp.active(listOf(enabled.copy(url = "http://mcp.example/mcp"))))
        assertNull(RemoteMcp.endpoint("https://account@remote.example/mcp"))
        assertNull(RemoteMcp.endpoint("https://remote.example/mcp#fragment"))
    }

    @Test fun removingAConnectionStripsTheCallAndResultButPreservesCampusHistory() {
        val remote = RemoteMcp.alias(server.id, "doc.query_v2")!!
        fun call(id: String, name: String) = buildJsonObject {
            put("id", id)
            put("function", buildJsonObject { put("name", name) })
        }
        fun result(id: String) = buildJsonObject { put("role", "tool"); put("tool_call_id", id); put("content", id) }
        val mixed = buildJsonObject {
            put("role", "assistant"); put("content", JsonNull)
            put("tool_calls", JsonArray(listOf(call("remote", remote), call("campus", "search"))))
        }
        val history = listOf(mixed, result("remote"), result("campus"))
        assertEquals(history, RemoteMcp.history(history, setOf(remote)))
        assertEquals(listOf(JsonObject(mixed + ("tool_calls" to JsonArray(listOf(call("campus", "search"))))), result("campus")),
            RemoteMcp.history(history, emptySet()))
    }
}
