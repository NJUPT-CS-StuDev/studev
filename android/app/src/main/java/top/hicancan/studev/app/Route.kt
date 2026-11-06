package top.hicancan.studev.app

import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.time.LocalDate

/** Uri.parse reads anything before the first colon as a scheme, so a site path must gain its origin first. */
fun absolute(link: String, origin: String) = if (link.startsWith("/")) origin + link else link

/** What is on screen. It has the same shape as the website's address, so a link opens the same thing on either. */
class Route {
    var tab by mutableStateOf("timetable")
    var whoType by mutableStateOf("me")
    var whoId by mutableStateOf("")
    var scale by mutableStateOf("day")
    /** The term view shows courses, or the mornings of 早锻炼. */
    var running by mutableStateOf(false)
    var day by mutableStateOf<LocalDate?>(null)
    var preview by mutableStateOf<String?>(null)
    var place by mutableStateOf<String?>(null)
    var floor by mutableStateOf<Int?>(null)
    var nav by mutableStateOf<String?>(null)
    var moment by mutableStateOf<Pair<LocalDate, Int>?>(null)
    var query by mutableStateOf("")
    var scope by mutableStateOf("all")
    /** Search only inside this entity. */
    var within by mutableStateOf<String?>(null)
    /** Opens a site link, relative or absolute. Anything this app has no screen for returns false. */
    fun open(link: String, origin: String): Boolean {
        val uri = Uri.parse(absolute(link, origin))
        if (uri.host != Uri.parse(origin).host) return false
        val path = uri.path.orEmpty().trimEnd('/')
        fun param(name: String) = uri.getQueryParameter(name)
        when (path) {
            "" -> {
                val who = param("who")
                whoType = who?.substringBefore(':', "me") ?: "me"
                whoId = who?.substringAfter(':', "").orEmpty()
                param("scale")?.let { scale = it }
                running = param("mode") == "run"
                day = param("t")?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
                preview = param("preview")
                tab = "timetable"
            }
            "/map" -> {
                place = param("place"); nav = param("nav"); floor = param("f")?.toIntOrNull()
                moment = param("t")?.let { text -> runCatching { LocalDate.parse(text.take(10)) to (text.drop(11).take(2).toInt() * 60 + text.drop(14).take(2).toInt()) }.getOrNull() }
                tab = "map"
            }
            "/search" -> { query = param("q").orEmpty(); scope = param("scope") ?: "all"; within = param("within"); tab = "search" }
            else -> return false
        }
        return true
    }
    fun timetable(type: String, id: String, newScale: String = "week", at: LocalDate? = null) { whoType = type; whoId = id; scale = newScale; day = at; preview = null; tab = "timetable" }
    fun map(place: String? = null, at: Pair<LocalDate, Int>? = null, nav: String? = null) { this.place = place; this.moment = at; this.nav = nav; floor = null; tab = "map" }
}
