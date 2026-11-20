package top.hicancan.studev.search

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.search.SearchEngine
import kotlin.coroutines.coroutineContext

/** Drives one engine through the bundle protocol, fetching only the blocks it names: a query's postings, then the
 * pages of the results it shows. `blocks` reads several byte ranges of one pack file at once. */
internal class NativeSearch(
    private val file: suspend (String) -> ByteArray,
    private val blocks: suspend (String, List<Pair<Long, Int>>) -> List<ByteArray>,
) : AutoCloseable {
    data class Page(val results: List<JsonObject>, val total: Int, val filters: JsonObject)
    private val mutex = Mutex()
    private var manifest: JsonObject? = null
    private var engine: SearchEngine? = null
    private var loaded = 0L
    @Volatile private var closed = false

    private fun pack(value: JsonObject) = manifest!!.getValue("packs").jsonArray[value.getValue("pack").jsonPrimitive.int].jsonPrimitive.content
    private fun span(value: JsonObject) = value.getValue("offset").jsonPrimitive.long to value.getValue("bytes").jsonPrimitive.int

    /** Blocks accumulate between queries; past the budget, start from the index again. */
    private suspend fun ready(): SearchEngine {
        engine?.takeIf { loaded < BUDGET_BYTES }?.let { return it }
        closeEngine()
        val m = manifest ?: Json.parseToJsonElement(file("manifest.json").decodeToString()).jsonObject.also { manifest = it }
        val index = m.getValue("index").jsonObject
        loaded = 0
        return SearchEngine(blocks(pack(index), listOf(span(index))).single(), index.getValue("decoded_bytes").jsonPrimitive.int.toUInt(), m.getValue("profile").toString()).also { engine = it }
    }

    private suspend fun load(json: String, consume: (UInt, ByteArray, UInt) -> Unit) {
        val named = Json.parseToJsonElement(json).jsonArray.map { it.jsonObject }
        val byPack = named.groupBy(::pack).toList()
        val fetched = coroutineScope { byPack.map { (pack, group) -> async { group.zip(blocks(pack, group.map(::span))) } }.awaitAll() }.flatten()
        for ((block, bytes) in fetched) {
            coroutineContext.ensureActive()
            val decoded = block.getValue("decoded_bytes").jsonPrimitive.int
            consume(block.getValue("id").jsonPrimitive.int.toUInt(), bytes, decoded.toUInt())
            loaded += decoded
        }
    }

    suspend fun page(query: String, limit: Int, sort: String = "relevance", filters: JsonObject = buildJsonObject {}, offset: Int = 0): Page = withContext(Dispatchers.IO) {
        try { mutex.withLock {
            coroutineContext.ensureActive()
            check(!closed) { "Search is closed" }
            if (query.trim().length == 1) return@withLock Page(emptyList(), 0, buildJsonObject {})
            val search = ready()
            val request = buildJsonObject {
                put("query", query.trim()); put("offset", offset); put("limit", limit); put("sort", sort); put("filters", filters)
            }
            val options = Json.parseToJsonElement(search.filterOptions()).jsonObject
            load(search.beginSearch(request.toString()), search::loadPostingsChunk)
            load(search.planSearch(), search::loadPage)
            coroutineContext.ensureActive()
            val value = Json.parseToJsonElement(search.hydrateSearch()).jsonObject
            Page(value.getValue("results").jsonArray.map { it.jsonObject }, value.getValue("totalCandidates").jsonPrimitive.int, options)
        } } finally { if (closed) close() }
    }

    private fun closeEngine() { engine?.close(); engine = null }
    override fun close() {
        closed = true
        if (!mutex.tryLock()) return
        try { closeEngine() } finally { mutex.unlock() }
    }

    private companion object { const val BUDGET_BYTES = 64L * 1024 * 1024 }
}
