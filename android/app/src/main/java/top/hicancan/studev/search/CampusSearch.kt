package top.hicancan.studev.search

import android.content.res.AssetManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.search.SearchEngine
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.Place
import kotlin.coroutines.coroutineContext

/** Serialized native session; mirrors wasm-search/js/src/runtime.ts, with no client ranking. */
class CampusSearch(private val assets: AssetManager) : AutoCloseable {
    private val mutex = Mutex()
    private val base = "${CampusPackage.BASE}/search"
    private val loadedPostings = mutableSetOf<Int>()
    private var manifest: JsonObject? = null
    private var engine: SearchEngine? = null
    private fun bytes(ref: JsonObject) = assets.open("$base/${ref.getValue("path").jsonPrimitive.content}").use { it.readBytes() }
    private fun decoded(ref: JsonObject) = ref.getValue("decoded_bytes").jsonPrimitive.int.toUInt()
    private fun init(): SearchEngine {
        engine?.let { return it }
        val m = Json.parseToJsonElement(assets.open("$base/manifest.json").bufferedReader().use { it.readText() }).jsonObject
        manifest = m
        val documents = m.getValue("documents").jsonObject
        val lexicon = m.getValue("lexicon").jsonObject
        return SearchEngine(bytes(documents), decoded(documents), bytes(lexicon), decoded(lexicon),
            m.getValue("profile").toString()).also { engine = it }
    }
    suspend fun search(query: String, campus: CampusPackage): List<Place> = withContext(Dispatchers.IO) {
        mutex.withLock {
            coroutineContext.ensureActive()
            if (query.trim().length < 2) return@withLock emptyList()
            val e = init()
            val m = checkNotNull(manifest)
            val request = buildJsonObject {
                put("query", query.trim()); put("limit", 60); put("sort", "relevance")
                put("filters", buildJsonObject {})
            }
            Json.parseToJsonElement(e.beginSearch(request.toString())).jsonArray.forEach {
                val chunk = it.jsonPrimitive.int
                if (chunk !in loadedPostings) {
                    val ref = m.getValue("postings").jsonArray[chunk].jsonObject
                    e.loadPostingsChunk(chunk.toUInt(), bytes(ref), decoded(ref)); loadedPostings += chunk
                }
            }
            coroutineContext.ensureActive()
            e.prepareSearch()
            val content = Json.parseToJsonElement(e.requiredContentChunks(0u, 60u)).jsonArray
            e.clearContent()
            try {
                content.forEach {
                    val chunk = it.jsonPrimitive.int
                    val ref = m.getValue("content").jsonArray[chunk].jsonObject
                    e.loadContentChunk(chunk.toUInt(), bytes(ref), decoded(ref))
                }
                coroutineContext.ensureActive()
                Json.parseToJsonElement(e.hydrateSearch(0u, 60u)).jsonObject.getValue("results").jsonArray.mapNotNull {
                    campus.byId[it.jsonObject.getValue("id").jsonPrimitive.content]
                }
            } finally { e.clearContent() }
        }
    }
    override fun close() { engine?.close(); engine = null }
}
