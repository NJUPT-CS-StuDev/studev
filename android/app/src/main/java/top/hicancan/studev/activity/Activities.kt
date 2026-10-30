package top.hicancan.studev.activity

import android.content.Context
import android.content.Intent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import top.hicancan.studev.account.AccountClient
import top.hicancan.studev.account.PLATFORM_ORIGIN
import java.net.URI
import java.net.URLDecoder
import java.time.Instant

internal val activityJson = Json { ignoreUnknownKeys = true; encodeDefaults = true; classDiscriminator = "kind" }
@Serializable sealed interface ActivityPlace {
    @Serializable @SerialName("campus") data class Campus(val id: String) : ActivityPlace
    @Serializable @SerialName("point") data class Point(val name: String, val position: List<Double>) : ActivityPlace
}
val ActivityPlace.label get() = when (this) { is ActivityPlace.Campus -> id; is ActivityPlace.Point -> name }
@Serializable data class Organiser(val id: String, val name: String)
@Serializable data class CampusActivity(
    val id: String, val title: String, val startsAt: String, val endsAt: String,
    val place: ActivityPlace, val description: String, val organiser: Organiser,
    val visibility: String, val revision: Int, val createdAt: String, val updatedAt: String,
)
@Serializable data class ActivityDraft(val title: String, val startsAt: String, val endsAt: String, val place: ActivityPlace, val description: String = "", val visibility: String = "public")
@Serializable data class ActivityPage(val items: List<CampusActivity>, val next: String? = null)

class Activities(private val client: AccountClient) {
    suspend fun upcoming(mine: Boolean = false, after: String? = null): ActivityPage {
        val cursor = after?.let { "?after=$it" } ?: ""
        return activityJson.decodeFromJsonElement(client.request((if (mine) "/me/activities" else "/activities") + cursor, authenticated = mine))
    }
    suspend fun get(id: String): CampusActivity {
        require(ActivityLinks.validId(id))
        return activityJson.decodeFromJsonElement(client.request("/activities/$id").getValue("activity"))
    }
    suspend fun save(draft: ActivityDraft, existing: CampusActivity? = null): CampusActivity {
        validateDraft(draft)
        val fields = activityJson.encodeToJsonElement(draft).jsonObject.toMutableMap()
        existing?.let { fields["revision"] = JsonPrimitive(it.revision) }
        return activityJson.decodeFromJsonElement(client.request(existing?.let { "/activities/${it.id}" } ?: "/activities", JsonObject(fields), authenticated = true).getValue("activity"))
    }
    suspend fun delete(activity: CampusActivity) { client.request("/activities/${activity.id}/delete", buildJsonObject { put("revision", activity.revision) }, authenticated = true) }
}
// This validates user input only; campus facts and route answers remain in the
// shared package/kernels. The server remains authoritative for all writes.
fun validateDraft(draft: ActivityDraft) {
    require(draft.title.trim().isNotEmpty() && draft.title.length <= 80) { "请填写 1–80 字的活动标题。" }
    require(draft.description.length <= 2000) { "活动介绍最多 2000 字。" }
    val start = runCatching { Instant.parse(draft.startsAt) }.getOrElse { throw IllegalArgumentException("请选择开始时间。") }
    val end = runCatching { Instant.parse(draft.endsAt) }.getOrElse { throw IllegalArgumentException("请选择结束时间。") }
    require(end > start && end.epochSecond - start.epochSecond <= 31 * 86400) { "结束须晚于开始，活动最长 31 天。" }
    require(draft.visibility in setOf("public", "unlisted"))
    when (val p = draft.place) {
        is ActivityPlace.Campus -> require(p.id.isNotBlank() && p.id.length <= 160) { "请选择活动地点。" }
        is ActivityPlace.Point -> require(p.name.isNotBlank() && p.name.length <= 80 && p.position.size == 2 && p.position.all { it.isFinite() } && p.position[0] in -180.0..180.0 && p.position[1] in -85.0..85.0) { "集合点信息无效。" }
    }
}
object ActivityLinks {
    fun validId(id: String) = id.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))
    fun url(id: String): String { require(validId(id)); return "$PLATFORM_ORIGIN/map/?activity=$id" }
    fun parse(raw: String?): String? = runCatching {
        val uri = URI(raw ?: return null)
        if (uri.scheme != "https" || uri.host != "studev.hicancan.top" || uri.userInfo != null || uri.port !in listOf(-1, 443) || uri.path.trimEnd('/') != "/map") return null
        val values = uri.rawQuery?.split('&')?.map { it.split('=', limit = 2) }?.filter { URLDecoder.decode(it[0], "UTF-8") == "activity" }
        if (values?.size != 1) return null
        values.single().getOrNull(1)?.let { URLDecoder.decode(it, "UTF-8") }?.takeIf(::validId)
    }.getOrNull()
    fun share(context: Context, activity: CampusActivity) {
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "${activity.title}\n${url(activity.id)}") }, "分享活动"))
    }
}

/** Place-sheet integration: call createAt(place.id). No map module dependency. */
object ActivityEntryPoints {
    internal val pendingPlace = MutableStateFlow<ActivityPlace?>(null)
    fun createAt(placeId: String) { pendingPlace.value = ActivityPlace.Campus(placeId) }
    fun createAt(name: String, longitude: Double, latitude: Double) { pendingPlace.value = ActivityPlace.Point(name, listOf(longitude, latitude)) }
}
