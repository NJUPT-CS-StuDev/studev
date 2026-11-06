package top.hicancan.studev.search

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.search.SearchEngine
import kotlin.coroutines.coroutineContext

/** Drives one engine through the bundle protocol, fetching only the blocks it names. */
internal class NativeSearch(
    private val file: suspend (String) -> ByteArray,
    private val range: suspend (String, String?, Long, Int) -> ByteArray,
) : AutoCloseable {
    data class Page(val results: List<JsonObject>, val total: Int, val filters: JsonObject)
    private val mutex = Mutex()
    private var manifest: JsonObject? = null
    private var engine: SearchEngine? = null
    private var loaded = 0L
    @Volatile private var closed = false

    private suspend fun ref(value: JsonObject): ByteArray {
        val number = value.getValue("pack").jsonPrimitive.int
        val pack = manifest!!.getValue("packs").jsonArray[number].jsonPrimitive.content
        val mirror = manifest!!["mirrors"]?.jsonArray?.getOrNull(number)?.jsonPrimitive?.content
        return range(pack, mirror, value.getValue("offset").jsonPrimitive.long, value.getValue("bytes").jsonPrimitive.int)
    }

    /** Blocks accumulate between queries; past the budget, start from the index again. */
    private suspend fun ready(): SearchEngine {
        engine?.takeIf { loaded < BUDGET_BYTES }?.let { return it }
        engine?.close()
        val m = manifest ?: Json.parseToJsonElement(file("manifest.json").decodeToString()).jsonObject.also { manifest = it }
        val index = m.getValue("index").jsonObject
        loaded = 0
        return SearchEngine(ref(index), index.getValue("decoded_bytes").jsonPrimitive.int.toUInt(), m.getValue("profile").toString()).also { engine = it }
    }

    private suspend fun load(json: String, consume: (UInt, ByteArray, UInt) -> Unit) {
        val slots = Semaphore(8)
        val blocks = Json.parseToJsonElement(json).jsonArray.map { it.jsonObject }
        val fetched = coroutineScope { blocks.map { block -> async { slots.withPermit { ref(block) } } }.awaitAll() }
        blocks.forEachIndexed { index, block ->
            coroutineContext.ensureActive()
            val decoded = block.getValue("decoded_bytes").jsonPrimitive.int
            consume(block.getValue("id").jsonPrimitive.int.toUInt(), fetched[index], decoded.toUInt())
            loaded += decoded
        }
    }

    suspend fun page(query: String, limit: Int, sort: String = "relevance", filters: JsonObject = buildJsonObject {}, offset: Int = 0,
                     onRanked: suspend (Page) -> Unit = {}): Page = withContext(Dispatchers.IO) { mutex.withLock {
        coroutineContext.ensureActive()
        check(!closed) { "Search is closed" }
        if (query.trim().length < 2) return@withLock Page(emptyList(), 0, buildJsonObject {})
        val search = ready()
        val request = buildJsonObject {
            put("query", query.trim()); put("offset", offset); put("limit", limit); put("sort", sort); put("filters", filters)
        }
        val options = Json.parseToJsonElement(search.filterOptions()).jsonObject
        fun page(response: String): Page {
            val value = Json.parseToJsonElement(response).jsonObject
            return Page(value.getValue("results").jsonArray.map { it.jsonObject }, value.getValue("totalCandidates").jsonPrimitive.int, options)
        }
        load(search.beginSearch(request.toString()), search::loadLexiconBlock)
        load(search.requiredPostingChunks(), search::loadPostingsChunk)
        load(search.planSearch(), search::loadDocumentBlock)
        coroutineContext.ensureActive()
        onRanked(page(search.rankedResults()))
        search.clearContent()
        val before = loaded
        load(search.requiredContentChunks(), search::loadContentChunk)
        loaded = before
        coroutineContext.ensureActive()
        page(search.hydrateSearch())
    } }

    override fun close() { closed = true; engine?.close(); engine = null }

    private companion object { const val BUDGET_BYTES = 64L * 1024 * 1024 }
}
