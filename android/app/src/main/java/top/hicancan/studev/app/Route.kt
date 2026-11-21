package top.hicancan.studev.app

import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.time.LocalDate

/** Uri.parse reads anything before the first colon as a scheme, so a site path must gain its origin first. */
fun absolute(link: String, origin: String) = if (link.startsWith("//")) origin.substringBefore("://") + ":" + link else if (link.startsWith("/")) origin + link else link

/** What is on screen. It has the same shape as the website's address, so a link opens the same thing on either. */
class Route {
    var tab by mutableStateOf("timetable")
    var whoType by mutableStateOf("me")
    var whoId by mutableStateOf("")
    var scale by mutableStateOf("day")
    /** The term grid, the other term of the academic year, or morning-run planning. */
    var termMode by mutableStateOf("course")
    var day by mutableStateOf<LocalDate?>(null)
    var preview by mutableStateOf<String?>(null)
    var place by mutableStateOf<String?>(null)
    var floor by mutableStateOf<Int?>(null)
    var nav by mutableStateOf<String?>(null)
    var from by mutableStateOf<String?>(null)
    var navMode by mutableStateOf("walk")
    /** A campus activity a shared map link carries, shown until it is kept or dismissed. */
    var event by mutableStateOf<top.hicancan.studev.map.CampusEvent?>(null)
    var moment by mutableStateOf<Pair<LocalDate, Int>?>(null)
    var query by mutableStateOf("")
    var scope by mutableStateOf("all")
    var searchFocus by mutableStateOf(false)
    var searchSource by mutableStateOf<String?>(null)
    var searchSince by mutableStateOf("")
    var searchType by mutableStateOf<String?>(null)
    var searchByDate by mutableStateOf(false)
    var searchPage by mutableStateOf(1)
    /** Search only inside this entity. */
    var within by mutableStateOf<String?>(null)
    var knowledgeCourse by mutableStateOf<String?>(null)
    var knowledgeTopic by mutableStateOf<String?>(null)
    var knowledgeMaterial by mutableStateOf<String?>(null)
    var knowledgeAnchor by mutableStateOf<String?>(null)
    var knowledgeFilters by mutableStateOf<Map<String, String>>(emptyMap())
    /** Opens a site link, relative or absolute. Anything this app has no screen for returns false. */
    fun open(link: String, origin: String): Boolean {
        val uri = Uri.parse(absolute(link, origin))
        val site = Uri.parse(origin)
        if (uri.scheme != site.scheme || uri.host != site.host || uri.port != site.port) return false
        val path = uri.path.orEmpty().trimEnd('/')
        fun param(name: String) = uri.getQueryParameter(name)
        when (path) {
            "" -> {
                val who = param("who")
                whoType = who?.substringBefore(':', "me") ?: "me"
                whoId = who?.substringAfter(':', "").orEmpty()
                scale = when (val view = param("scale")) {
                    "day", "week", "term", "exam" -> view
                    "list" -> if (whoType == "me") view else "day"
                    else -> "day"
                }
                termMode = if (scale == "term") when (val mode = param("mode")) {
                    "other", "run" -> mode
                    else -> "course"
                } else "course"
                day = param("t")?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
                preview = param("preview")
                tab = "timetable"
            }
            "/map" -> {
                place = param("place"); nav = param("nav"); from = param("from"); floor = param("f")?.toIntOrNull()
                navMode = param("mode")?.takeIf { it == "bike" } ?: "walk"
                event = top.hicancan.studev.map.CampusEvents.parse(param("event"), param("ll"), param("near"), param("at"), param("note"))
                moment = param("t")?.let { text -> runCatching { LocalDate.parse(text.take(10)) to (text.drop(11).take(2).toInt() * 60 + text.drop(14).take(2).toInt()) }.getOrNull() }
                tab = "map"
            }
            "/knowledge" -> {
                knowledgeCourse = param("course")
                knowledgeTopic = param("topic")
                knowledgeMaterial = param("material")
                knowledgeAnchor = uri.fragment?.takeIf { it.isNotEmpty() }
                knowledgeFilters = listOf("cohort", "major", "grade", "category", "nature", "view", "focus", "q").mapNotNull { key -> param(key)?.let { key to it } }.toMap()
                tab = "knowledge"
            }
            "/search" -> {
                search(scope = param("scope") ?: "all", query = param("q").orEmpty(), within = param("within"))
                searchSource = param("source")
                searchSince = param("since")?.takeIf { it in listOf("3", "7", "30", "365") }.orEmpty()
                searchType = param("type")
                searchByDate = param("sort") == "date"
                searchPage = param("page")?.toIntOrNull()?.takeIf { it in 1..10000 } ?: 1
            }
            "/ai" -> tab = "ai"
            else -> return false
        }
        return true
    }
    fun knowledge(course: String? = null, topic: String? = null, material: String? = null, anchor: String? = null) {
        knowledgeCourse = course; knowledgeTopic = topic; knowledgeMaterial = material; knowledgeAnchor = anchor; tab = "knowledge"
    }
    fun timetable(type: String, id: String, newScale: String = "week", at: LocalDate? = null) { whoType = type; whoId = id; scale = newScale; day = at; preview = null; tab = "timetable" }
    fun map(place: String? = null, at: Pair<LocalDate, Int>? = null, nav: String? = null, from: String? = null, mode: String = "walk") { this.place = place; this.moment = at; this.nav = nav; this.from = from; navMode = mode.takeIf { it == "bike" } ?: "walk"; floor = null; tab = "map" }
    fun search(scope: String = "all", query: String = "", within: String? = null, source: String? = null, focus: Boolean = false) {
        this.scope = scope; this.query = query; this.within = within; searchFocus = focus
        searchSource = source; searchType = null; searchSince = ""; searchByDate = false; searchPage = 1
        tab = "search"
    }
    /** Free rooms are the rooms dimension of search, at a moment. */
    fun rooms(at: Pair<LocalDate, Int>) { moment = at; search(scope = "room") }
}
