package top.hicancan.studev.me

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import top.hicancan.studev.world.Task
import java.time.Instant
import java.util.UUID

/** One's own tasks, kept on this device, deleted ones marked rather than lost: a later sync needs to know of them. */
class TaskStore(context: Context) {
    private val context = context.applicationContext
    private val store = this.context.getSharedPreferences("tasks", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private fun load() = store.getString("tasks", null)?.let { runCatching { json.decodeFromString<List<Task>>(it) }.getOrNull() }.orEmpty().map(top.hicancan.studev.world.Tasks::sanitize)
    private val _all = MutableStateFlow(load())
    /** A task ticked off on the home screen is written by another store; every store reads it back at once. */
    private val reread = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, key -> if (key == "tasks") _all.value = load() }
    init { store.registerOnSharedPreferenceChangeListener(reread) }
    /** Every task kept here, deleted ones included. */
    val all = _all.asStateFlow()
    /** A change reaches the home-screen widget and the phone's reminders as a settings change does. */
    private fun write(next: List<Task>) {
        store.edit().putString("tasks", json.encodeToString(next)).apply()
        _all.value = next
        top.hicancan.studev.widget.WidgetRefreshWorker.refresh(context)
        top.hicancan.studev.device.DeviceRefreshWorker.enqueue(context)
    }
    private fun stamp() = top.hicancan.studev.world.Tasks.stamp(Instant.now())
    fun newId() = UUID.randomUUID().toString()
    /** Adds a task, or changes one: the change is stamped so that the newer side wins a merge. */
    fun save(task: Task) {
        require(task.date == null || task.start != null) { "执行安排需要开始时间；截止日期请填写在截止时间中。" }
        write(_all.value.filter { it.id != task.id } + task.copy(modified = stamp()))
    }
    /** What a sync brought back, taken as it is: those changes were stamped where they were made. */
    fun adopt(merged: List<Task>) = write(merged)
    /** Several tasks changed at once, as one write. */
    fun saveAll(changed: List<Task>) {
        val ids = changed.mapTo(HashSet()) { it.id }
        write(_all.value.filter { it.id !in ids } + changed.map { it.copy(modified = stamp()) })
    }
    /** Deleting keeps a mark, and takes its steps with it. */
    fun delete(id: String) = write(_all.value.map { if (it.id == id || it.parent == id) Task(it.id, it.title, modified = stamp(), deleted = true) else it })
    fun toggleDone(task: Task) = save(task.copy(done = if (task.done != null) null else stamp()))
    companion object {
        /** The tasks that count: not deleted. */
        fun live(tasks: List<Task>) = tasks.filter { it.deleted != true }
    }
}
