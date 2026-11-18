package top.hicancan.studev.ai

import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

/**
 * The conversations kept on this device, as src/campus/ai/chats.ts: each named by its first question until renamed,
 * the newest first, grouped by when they were last spoken in.
 */
internal data class SavedChat(val id: String, val title: String, val updated: Long, val thread: ChatThread, val selection: ModelSelection? = null, val projectId: String? = null) {
    fun toJson() = buildJsonObject {
        put("id", id); put("title", title); put("updated", updated); put("thread", thread.toJson())
        selection?.let { put("selection", Json.encodeToJsonElement(it)) }
        projectId?.let { put("projectId", it) }
    }
    companion object {
        fun of(json: JsonObject) = SavedChat(json.getValue("id").jsonPrimitive.content, json["title"]?.jsonPrimitive?.contentOrNull.orEmpty(), json.getValue("updated").jsonPrimitive.long,
            ChatThread.of(json.getValue("thread").jsonObject), json["selection"]?.let { runCatching { Json.decodeFromJsonElement<ModelSelection>(it) }.getOrNull() },
            json["projectId"]?.jsonPrimitive?.contentOrNull)
    }
}

@Serializable internal data class ChatProject(val id: String, val name: String, val course: String? = null, val instructions: String = "", val memory: String = "", val version: Int = 1) {
    fun toJson() = buildJsonObject {
        put("version", version); put("id", id); put("name", name)
        course?.let { put("course", it) }
        if (instructions.isNotEmpty()) put("instructions", instructions)
        if (memory.isNotEmpty()) put("memory", memory)
    }
}

internal data class KeptChats(
    val chats: List<SavedChat> = emptyList(), val current: String? = null,
    val projects: List<ChatProject> = emptyList(), val currentProject: String? = null,
) {
    fun toJson() = buildJsonObject {
        put("chats", JsonArray(chats.map(SavedChat::toJson)))
        current?.let { put("current", it) }
        put("projects", JsonArray(projects.map(ChatProject::toJson)))
        currentProject?.let { put("currentProject", it) }
    }

    companion object {
        fun of(json: JsonObject, imported: ModelSelection): KeptChats {
            val projects = json["projects"]?.jsonArray.orEmpty().mapNotNull { item ->
                runCatching { Json.decodeFromJsonElement<ChatProject>(item) }.getOrNull()?.takeIf { it.version == 1 && it.id.isNotBlank() && it.name.isNotBlank() }
            }
            val ids = projects.mapTo(mutableSetOf()) { it.id }
            val chats = json.getValue("chats").jsonArray.map {
                val chat = SavedChat.of(it.jsonObject)
                chat.copy(selection = chat.selection ?: imported, projectId = chat.projectId?.takeIf(ids::contains))
            }
            val current = json["current"]?.jsonPrimitive?.contentOrNull
            val open = chats.firstOrNull { it.id == current }
            val project = if (open != null) open.projectId else json["currentProject"]?.jsonPrimitive?.contentOrNull?.takeIf(ids::contains)
            return KeptChats(chats, current, projects, project)
        }
    }
}

internal object Chats {
    /** What a conversation is called: the name given it, else its first question, cut to a line. */
    fun titleOf(title: String, thread: ChatThread): String {
        if (title.isNotBlank()) return title.trim()
        val first = thread.path().firstOrNull { it.message["role"]?.jsonPrimitive?.content == "user" }?.message?.get("content")?.jsonPrimitive?.contentOrNull.orEmpty()
        val line = first.replace(Regex("\\s+"), " ").trim()
        return if (line.length > 28) line.take(28) + "…" else line.ifEmpty { "新对话" }
    }

    /** The conversations newest first, in groups: 今天, 昨天, 前 7 天, 前 30 天, then by month. */
    fun groups(chats: List<SavedChat>, now: Long, zone: ZoneId = ZoneId.systemDefault()): List<Pair<String, List<SavedChat>>> {
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        return chats.sortedByDescending { it.updated }.groupBy { chat ->
            val day = Instant.ofEpochMilli(chat.updated).atZone(zone).toLocalDate()
            val days = ChronoUnit.DAYS.between(day, today)
            when { days <= 0 -> "今天"; days == 1L -> "昨天"; days <= 7 -> "前 7 天"; days <= 30 -> "前 30 天"; else -> "${day.year}年${day.monthValue}月" }
        }.toList()
    }
}
