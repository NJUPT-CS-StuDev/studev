package top.hicancan.studev.app

import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.time.LocalDate

/** What is on screen. It has the same shape as the website's address, so a link opens the same thing on either. */
class Route {
    var tab by mutableStateOf("timetable")
    var whoType by mutableStateOf("me")
    var whoId by mutableStateOf("")
    var scale by mutableStateOf("day")
    var day by mutableStateOf<LocalDate?>(null)
    var preview by mutableStateOf<String?>(null)
    var place by mutableStateOf<String?>(null)
    var floor by mutableStateOf<Int?>(null)
    var nav by mutableStateOf<String?>(null)
    var moment by mutableStateOf<Pair<LocalDate, Int>?>(null)
    var query by mutableStateOf("")
    var scope by mutableStateOf("all")
    /** Opens a site link, relative or absolute. External links return false. */
    fun open(link: String, host: String): Boolean {
        val uri = Uri.parse(link)
        if (uri.isAbsolute && uri.host != host) return false
        val path = uri.path.orEmpty().trimEnd('/')
        fun param(name: String) = uri.getQueryParameter(name)
        when (path) {
            "" -> {
                val who = param("who")
                whoType = who?.substringBefore(':', "me") ?: "me"
                whoId = who?.substringAfter(':', "").orEmpty()
                param("scale")?.let { scale = it }
                day = param("t")?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
                preview = param("preview")
                tab = "timetable"
            }
            "/map" -> {
                place = param("place"); nav = param("nav"); floor = param("f")?.toIntOrNull()
                moment = param("t")?.let { text -> runCatching { LocalDate.parse(text.take(10)) to (text.drop(11).take(2).toInt() * 60 + text.drop(14).take(2).toInt()) }.getOrNull() }
                tab = "map"
            }
            "/search" -> { query = param("q").orEmpty(); scope = param("scope") ?: "all"; tab = "search" }
            else -> return false
        }
        return true
    }
    fun timetable(type: String, id: String, newScale: String = "week", at: LocalDate? = null) { whoType = type; whoId = id; scale = newScale; day = at; preview = null; tab = "timetable" }
    fun map(place: String? = null, at: Pair<LocalDate, Int>? = null, nav: String? = null) { this.place = place; this.moment = at; this.nav = nav; floor = null; tab = "map" }
}
