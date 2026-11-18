package top.hicancan.studev.ai

import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlinx.serialization.json.*

/**
 * The conversations kept on this device, as src/campus/ai/chats.ts: each named by its first question until renamed,
 * the newest first, grouped by when they were last spoken in.
 */
data class SavedChat(val id: String, val title: String, val updated: Long, val thread: ChatThread) {
    fun toJson() = buildJsonObject { put("id", id); put("title", title); put("updated", updated); put("thread", thread.toJson()) }
    companion object {
        fun of(json: JsonObject) = SavedChat(json.getValue("id").jsonPrimitive.content, json["title"]?.jsonPrimitive?.contentOrNull.orEmpty(), json.getValue("updated").jsonPrimitive.long, ChatThread.of(json.getValue("thread").jsonObject))
    }
}

object Chats {
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
