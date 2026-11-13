package top.hicancan.studev.me

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import top.hicancan.studev.account.AccountClient
import top.hicancan.studev.world.Task
import top.hicancan.studev.world.Tasks

/**
 * One's tasks and timetable settings kept in step with one's other devices while signed in, as startSync in
 * src/campus/world/sync.ts: on opening, on signing in, and shortly after any change here, merged by the same rules
 * (merge.mjs; Sync.mergeSettings here). Signed out, they stay on this device; AI conversations never leave it.
 */
@OptIn(FlowPreview::class)
class Sync(private val store: TaskStore, private val settings: CampusSettings, private val client: AccountClient, scope: CoroutineScope, private val onSettingsTaken: () -> Unit = {}) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    /** What was last taken from a sync: writing it is not a change made here, and is not sent back. */
    private var adopted: List<Task>? = null
    private var adoptedSettings: PersonalSettings? = null
    private val resumed = MutableStateFlow(0L)
    private var syncedResume = -1L
    private var syncedUser: String? = null
    fun resume() { resumed.value++ }
    init {
        scope.launch {
            runCatching { client.current() }.onFailure { if (it is CancellationException) throw it }
            combine(store.all, settings.state, client.user, resumed) { tasks, mine, user, resume -> Triple(tasks, mine, user) to resume }.debounce(1500).collect { (state, resume) ->
                val (tasks, mine, user) = state
                if (user != null && (resume != syncedResume || user.id != syncedUser || tasks !== adopted || mine !== adoptedSettings)) run(user.id, resume)
            }
        }
    }
    private suspend fun run(user: String, resume: Long) {
        try {
            val sent = store.all.value
            val mine = settings.state.value
            val result = client.request("/sync", buildJsonObject { put("tasks", json.encodeToJsonElement(sent)); put("settings", partsOf(mine)) }, authenticated = true)
            if (client.user.value?.id != user) return
            val theirs = json.decodeFromJsonElement<List<Task>>(result.getValue("tasks")).map(Tasks::sanitize)
            val now = store.all.value
            val merged = Tasks.merge(now, theirs)
            if (merged.size != now.size || merged.any { task -> now.none { it.id == task.id && it.modified == task.modified } }) store.adopt(merged)
            // A local edit made while the request was away still needs its own send, even if it survived the merge.
            adopted = if (now === sent) store.all.value else null
            val current = settings.state.value
            val taken = taken(current, result["settings"] as? JsonObject ?: JsonObject(emptyMap()))
            if (taken != null) { settings.update(adopt = true) { taken }; onSettingsTaken() }
            adoptedSettings = if (current === mine) settings.state.value else null
            syncedResume = resume
            syncedUser = user
        } catch (e: CancellationException) { throw e } catch (_: Exception) { /* Offline or signed out: they stay here and go next time. */ }
    }

    companion object {
        /** The parts of one's settings that have changed at some time, as they go to the platform, as settingsOf on the web. */
        fun partsOf(s: PersonalSettings): JsonObject {
            val sections = CampusSettings.sections(s)
            return JsonObject(CampusSettings.SECTIONS.filter { it in s.modified }.associateWith { section -> buildJsonObject { put("value", sections.getValue(section)); put("modified", s.modified.getValue(section)) } })
        }
        /** Settings with the parts that changed later elsewhere taken in, or null when none did, as settingsTaken on the web. */
        fun taken(s: PersonalSettings, merged: JsonObject): PersonalSettings? {
            var next: PersonalSettings? = null
            for (section in CampusSettings.SECTIONS) {
                val part = merged[section] as? JsonObject ?: continue
                val at = part["modified"]?.jsonPrimitive?.contentOrNull ?: continue
                if (at < (s.modified[section] ?: "")) continue
                if (at == s.modified[section] && part["value"] == CampusSettings.sections(s)[section]) continue
                val base = next ?: s
                next = CampusSettings.take(base, section, part["value"] ?: JsonNull).let { it.copy(modified = it.modified + (section to at)) }
            }
            return next
        }
        /** Settings, part by part, as mergeSettings in merge.mjs: the later change of each part wins. */
        fun mergeSettings(mine: JsonObject, theirs: JsonObject): JsonObject = JsonObject(CampusSettings.SECTIONS.mapNotNull { section ->
            val left = mine[section] as? JsonObject; val right = theirs[section] as? JsonObject
            val kept = when { left == null -> right; right == null -> left; right.getValue("modified").jsonPrimitive.content > left.getValue("modified").jsonPrimitive.content -> right; else -> left }
            kept?.let { section to it }
        }.toMap())
    }
}
