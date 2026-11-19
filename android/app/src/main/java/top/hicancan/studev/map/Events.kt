package top.hicancan.studev.map

import android.content.Context
import android.net.Uri
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import top.hicancan.studev.data.Place
import java.time.LocalDate
import java.time.LocalDateTime
import kotlin.math.cos
import kotlin.math.hypot

/**
 * A campus activity someone marks where it happens: a talk in a lecture hall, a club fair on a lawn, a match on a court.
 * It is a point on the map with a name, a time and a word or two, kept on the phone and passed on as an ordinary map
 * link, so a friend's phone opens the same point and anyone without the app still reads what, when and where.
 */
@Serializable
data class CampusEvent(
    val id: String,
    val title: String,
    val lng: Double,
    val lat: Double,
    /** The named place it is in or nearest to, the way there and the word people use for it. */
    val near: String? = null,
    /** When it starts, local time, as 2026-11-20T19:00. */
    val at: String? = null,
    val note: String = "",
) {
    val time: LocalDateTime? get() = at?.let { runCatching { LocalDateTime.parse(it) }.getOrNull() }
    /** Over once the day after it started has begun; one without a time stays until it is removed. */
    fun over(today: LocalDate) = time?.toLocalDate()?.let { it.plusDays(1) <= today } ?: false
}

object CampusEvents {
    private const val KEY = "events"
    private val json = Json { ignoreUnknownKeys = true }

    private fun store(context: Context) = context.getSharedPreferences("campus_events", Context.MODE_PRIVATE)

    fun load(context: Context): List<CampusEvent> =
        store(context).getString(KEY, null)?.let { runCatching { json.decodeFromString(ListSerializer(CampusEvent.serializer()), it) }.getOrNull() }.orEmpty()

    fun save(context: Context, events: List<CampusEvent>) {
        store(context).edit().putString(KEY, json.encodeToString(ListSerializer(CampusEvent.serializer()), events)).apply()
    }

    /** The map link that opens this activity on another phone, or on the site. */
    fun link(origin: String, event: CampusEvent): String = Uri.parse("$origin/map").buildUpon()
        .appendQueryParameter("event", event.title)
        .appendQueryParameter("ll", "%.6f,%.6f".format(java.util.Locale.ROOT, event.lng, event.lat))
        .apply { event.near?.let { appendQueryParameter("near", it) } }
        .apply { event.at?.let { appendQueryParameter("at", it) } }
        .apply { if (event.note.isNotBlank()) appendQueryParameter("note", event.note) }
        .build().toString()

    /** The activity a map link carries, or null when it carries none. */
    fun parse(title: String?, ll: String?, near: String?, at: String?, note: String?): CampusEvent? {
        val name = title?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val (lng, lat) = ll?.split(',')?.mapNotNull { it.trim().toDoubleOrNull() }?.takeIf { it.size == 2 } ?: return null
        val time = at?.takeIf { runCatching { LocalDateTime.parse(it) }.isSuccess }
        return CampusEvent("$lng,$lat,$name,${time.orEmpty()}", name.take(40), lng, lat, near, time, note.orEmpty().take(200))
    }

    /** What a message says, for whoever reads it without the app: what, when, where, then the link. */
    fun message(origin: String, event: CampusEvent, nearName: String?): String = buildString {
        append("【校园活动】").append(event.title)
        event.time?.let { append("\n时间：").append("%d月%d日 %02d:%02d".format(it.monthValue, it.dayOfMonth, it.hour, it.minute)) }
        nearName?.let { append("\n地点：").append(it).append(" 附近") }
        if (event.note.isNotBlank()) append("\n说明：").append(event.note)
        append("\n在 StuDev 地图上查看并导航：").append(link(origin, event))
    }

    /** The named place nearest a point: a building whose outline holds it if any, otherwise the closest place with a centre. */
    fun nearest(places: Collection<Place>, lng: Double, lat: Double): Place? {
        val k = cos(Math.toRadians(lat))
        return places.asSequence()
            .filter { (it.kind == "building" || it.kind == "place") && it.centre != null && it.names.isNotEmpty() }
            .minByOrNull { val c = it.centre!!; hypot((c[0] - lng) * k, c[1] - lat) }
    }
}
