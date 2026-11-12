package top.hicancan.studev.me

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import top.hicancan.studev.account.AccountClient
import top.hicancan.studev.world.Task
import top.hicancan.studev.world.Tasks

/**
 * One's tasks kept in step with one's other devices while signed in, as startTaskSync in src/campus/world/sync.ts:
 * on opening, on signing in, and shortly after any change here. Signed out, the tasks stay on this device.
 */
@OptIn(FlowPreview::class)
class TaskSync(private val store: TaskStore, private val client: AccountClient, scope: CoroutineScope) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    /** The list last taken from a sync: writing it is not a change made here, and is not sent back. */
    private var adopted: List<Task>? = null
    init {
        scope.launch {
            client.current()
            combine(store.all, client.user) { tasks, user -> tasks to user }.debounce(1500).collect { (tasks, user) ->
                if (user != null && tasks !== adopted) run()
            }
        }
    }
    private suspend fun run() {
        try {
            val sent = store.all.value
            val result = client.request("/sync", buildJsonObject { put("tasks", json.encodeToJsonElement(sent)) }, authenticated = true)
            val theirs = json.decodeFromJsonElement<List<Task>>(result.getValue("tasks")).map(Tasks::sanitize)
            val now = store.all.value
            val merged = Tasks.merge(now, theirs)
            if (merged.size != now.size || merged.any { task -> now.none { it.id == task.id && it.modified == task.modified } }) { adopted = merged; store.adopt(merged); adopted = store.all.value }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { /* Offline or signed out: the tasks stay here and go next time. */ }
    }
}
