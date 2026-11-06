package top.hicancan.studev.search

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.search.SearchEngine
import kotlin.coroutines.coroutineContext

/** The v2 bundle protocol used by both native search entry points.
 * Each query owns its engine so cancellation, disposal and long sessions
 * cannot retain native postings indefinitely or close another query's handle. */
internal class NativeSearch(private val read: suspend (String) -> ByteArray) : AutoCloseable {
    data class Page(val results: List<JsonObject>, val total: Int, val filters: JsonObject)
    private val mutex = Mutex()
    private var manifest: JsonObject? = null
    private var documents: ByteArray? = null
    private var lexicon: ByteArray? = null
    @Volatile private var closed = false
    private suspend fun bytes(ref: JsonObject) = read(ref.getValue("path").jsonPrimitive.content)
    private fun size(ref: JsonObject) = ref.getValue("decoded_bytes").jsonPrimitive.int.toUInt()
        suspend fun page(query: String, limit: Int, sort: String = "relevance", filters: JsonObject = buildJsonObject {}, offset: Int = 0,
                     onRanked: suspend (Page) -> Unit = {}): Page = withContext(Dispatchers.IO) { mutex.withLock {
        coroutineContext.ensureActive()
        check(!closed) { "Search is closed" }
        if (query.trim().length < 2) return@withLock Page(emptyList(), 0, buildJsonObject {})
        val m = manifest ?: Json.parseToJsonElement(read("manifest.json").decodeToString()).jsonObject.also { manifest = it }
        val documentIndex = m.getValue("documents").jsonObject.getValue("index").jsonObject
        val lexiconIndex = m.getValue("lexicon").jsonObject.getValue("index").jsonObject
        val docs = documents ?: bytes(documentIndex).also { documents = it }
        val lex = lexicon ?: bytes(lexiconIndex).also { lexicon = it }
        SearchEngine(docs, size(documentIndex), lex, size(lexiconIndex), m.getValue("profile").toString()).use { engine ->
            val request = buildJsonObject {
                put("query", query.trim()); put("offset", offset); put("limit", limit); put("sort", sort); put("filters", filters)
            }
            suspend fun load(indices: String, refs: JsonArray, consume: (UInt, ByteArray, UInt) -> Unit) {
                val slots = Semaphore(4)
                val loaded = coroutineScope {
                    Json.parseToJsonElement(indices).jsonArray.map { item -> async {
                        slots.withPermit {
                            val index = item.jsonPrimitive.int
                            val ref = refs[index].jsonObject
                            Triple(index.toUInt(), bytes(ref), size(ref))
                        }
                    } }.awaitAll()
                }
                for ((index, data, decoded) in loaded) {
                    coroutineContext.ensureActive()
                    consume(index, data, decoded)
                }
            }
            val options = Json.parseToJsonElement(engine.filterOptions()).jsonObject
            fun page(response: String): Page {
                val value = Json.parseToJsonElement(response).jsonObject
                return Page(value.getValue("results").jsonArray.map { it.jsonObject }, value.getValue("totalCandidates").jsonPrimitive.int, options)
            }
            load(engine.beginSearch(request.toString()), m.getValue("lexicon").jsonObject.getValue("blocks").jsonArray, engine::loadLexiconBlock)
            load(engine.requiredPostingChunks(), m.getValue("postings").jsonArray, engine::loadPostingsChunk)
            load(engine.requiredDocumentBlocks(), m.getValue("documents").jsonObject.getValue("blocks").jsonArray, engine::loadDocumentBlock)
            coroutineContext.ensureActive()
            onRanked(page(engine.prepareSearch()))
            coroutineContext.ensureActive()
            load(engine.requiredContentChunks(offset.toUInt(), limit.toUInt()), m.getValue("content").jsonArray, engine::loadContentChunk)
            coroutineContext.ensureActive()
            page(engine.hydrateSearch(offset.toUInt(), limit.toUInt()))
        }
    } }
    override fun close() { closed = true }
}
