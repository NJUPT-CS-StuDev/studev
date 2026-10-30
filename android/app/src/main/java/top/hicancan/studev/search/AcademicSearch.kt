package top.hicancan.studev.search

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.search.SearchEngine
import top.hicancan.studev.data.AcademicRepository
import kotlin.coroutines.coroutineContext

data class AcademicResult(val id: String, val title: String, val url: String, val source: String, val snippet: String)
/** Same posting/content hydration protocol and native relevance order as the web bundle. */
class AcademicSearch(repository: AcademicRepository) : AutoCloseable {
    private val repo = repository
    private val mutex = Mutex()
    private var manifest: JsonObject? = null
    private var engine: SearchEngine? = null
    private val loaded = mutableSetOf<Int>()
    private suspend fun bytes(ref: JsonObject) = repo.bytes("search/" + ref.getValue("path").jsonPrimitive.content)
    private fun size(ref: JsonObject) = ref.getValue("decoded_bytes").jsonPrimitive.int.toUInt()
    suspend fun search(query: String): List<AcademicResult> = withContext(Dispatchers.IO) { mutex.withLock {
        if (query.trim().length < 2) return@withLock emptyList()
        val m = manifest ?: Json.parseToJsonElement(repo.bytes("search/manifest.json").decodeToString()).jsonObject.also { manifest = it }
        val e = engine ?: run {
            val docs = m.getValue("documents").jsonObject; val lex = m.getValue("lexicon").jsonObject
            SearchEngine(bytes(docs), size(docs), bytes(lex), size(lex), m.getValue("profile").toString()).also { engine = it }
        }
        val request = buildJsonObject { put("query", query.trim()); put("limit", 30); put("sort", "relevance"); put("filters", buildJsonObject {}) }
        Json.parseToJsonElement(e.beginSearch(request.toString())).jsonArray.forEach { item ->
            val chunk = item.jsonPrimitive.int
            if (chunk !in loaded) { val ref = m.getValue("postings").jsonArray[chunk].jsonObject; e.loadPostingsChunk(chunk.toUInt(), bytes(ref), size(ref)); loaded += chunk }
        }
        coroutineContext.ensureActive(); e.prepareSearch(); e.clearContent()
        try {
            Json.parseToJsonElement(e.requiredContentChunks(0u, 30u)).jsonArray.forEach { item ->
                val chunk = item.jsonPrimitive.int; val ref = m.getValue("content").jsonArray[chunk].jsonObject
                e.loadContentChunk(chunk.toUInt(), bytes(ref), size(ref))
            }
            coroutineContext.ensureActive()
            Json.parseToJsonElement(e.hydrateSearch(0u, 30u)).jsonObject.getValue("results").jsonArray.map {
                val result = it.jsonObject
                fun text(key: String) = result[key]?.jsonPrimitive?.contentOrNull.orEmpty()
                AcademicResult(text("id"), text("title"), text("url"), text("sourceName"), text("snippet"))
            }
        } finally { e.clearContent() }
    } }
    // Search and close can overlap when a screen leaves during shard hydration.
    override fun close() { CoroutineScope(Dispatchers.IO).launch { mutex.withLock { engine?.close(); engine = null } } }
}
