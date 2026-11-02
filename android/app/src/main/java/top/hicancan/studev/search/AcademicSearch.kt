package top.hicancan.studev.search

import kotlinx.serialization.json.*
import top.hicancan.studev.data.AcademicRepository

data class AcademicAttachment(val name: String, val url: String)
data class AcademicResult(val id: String, val title: String, val url: String, val source: String, val snippet: String,
                          val sourceId: String, val section: String, val date: String, val category: String,
                          val matchedTerms: List<String>, val attachments: List<AcademicAttachment>)
data class AcademicPage(val results: List<AcademicResult>, val total: Int, val sources: List<Pair<String, String>>)
val searchCategoryLabels = linkedMapOf("notice_article" to "通知", "policy" to "政策制度", "workflow" to "办事流程", "download" to "下载资源", "exam" to "考试信息", "news" to "新闻动态", "external" to "站外链接")
val repositorySourceIds = listOf("njupt-survival-guide", "njupt-general-free-exams")
class AcademicSearch(repository: AcademicRepository) : AutoCloseable {
    private val runtime = NativeSearch { path -> repository.bytes("search/$path") }
    suspend fun search(query: String): List<AcademicResult> = page(query).results
    suspend fun page(query: String, scope: String = "web", sort: String = "relevance", years: Int = 0,
                     category: String? = null, source: String? = null, limit: Int = 30,
                     onRanked: suspend (AcademicPage) -> Unit = {}): AcademicPage {
        val filters = buildJsonObject {
            when (scope) {
                "community" -> put("sourceId", repositorySourceIds[0])
                "materials" -> put("sourceId", repositorySourceIds[1])
                else -> { put("excludedSourceIds", JsonArray(repositorySourceIds.map(::JsonPrimitive))); source?.let { put("sourceId", it) } }
            }
            category?.let { put("category", it) }
            if (scope == "web" && years > 0) {
                val today = java.time.LocalDate.now(java.time.Clock.systemUTC())
                put("publishedFrom", today.minusYears(years.toLong()).toString()); put("publishedTo", today.toString()); put("includeUndated", false)
            }
        }
        return convert(runtime.page(query, limit.coerceIn(1, 200), sort, filters) { onRanked(convert(it)) })
    }
    private fun convert(page: NativeSearch.Page): AcademicPage {
        val results = page.results.map { result ->
            fun text(key: String) = result[key]?.jsonPrimitive?.contentOrNull.orEmpty()
            AcademicResult(text("id"), text("title"), text("url"), text("sourceName"), text("snippet"), text("source"), text("section"),
                text("updatedAt").ifBlank { text("publishedAt") }.take(10), text("category"),
                result["matchedTerms"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty(),
                result["attachments"]?.jsonArray?.map { val item = it.jsonObject; AcademicAttachment(item["name"]?.jsonPrimitive?.content.orEmpty(), item["url"]?.jsonPrimitive?.content.orEmpty()) }.orEmpty())
        }
        val sources = page.filters["sources"]?.jsonArray?.map { val item = it.jsonObject; item.getValue("id").jsonPrimitive.content to item.getValue("label").jsonPrimitive.content }.orEmpty()
        return AcademicPage(results, page.total, sources)
    }
    override fun close() = runtime.close()
}
