package top.hicancan.studev.me

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class TimetableEdits(
    val hidden: List<String> = emptyList(),
    val added: List<String> = emptyList(),
)

data class PersonalSettings(
    val klass: String? = null,
    val campus: String = top.hicancan.studev.BuildConfig.DEFAULT_CAMPUS,
    val theme: String = "system",
    val calendar: Boolean = false,
    val reminders: Boolean = false,
    val leadMinutes: Int = 15,
    val homeDorm: String? = null,
    val navigationGuidanceShown: Boolean = false,
    val navigationGuidancePending: Boolean = false,
    val reminderGuidanceShown: Boolean = false,
    val timetable: Map<String, TimetableEdits> = emptyMap(),
) {
    fun timetableEdits(term: String): TimetableEdits = timetable[term] ?: TimetableEdits()
}

private val termPattern = Regex("^\\d{4}-\\d{4}-\\d$")
private fun sanitizeIds(ids: List<String>): List<String> =
    ids.map { it.trim() }.filter { it.isNotEmpty() && it.length < 120 }.distinct()

private fun sanitizeTimetable(raw: Map<String, TimetableEdits>): Map<String, TimetableEdits> = buildMap {
    for ((term, edits) in raw) {
        if (!termPattern.matches(term)) continue
        val hidden = sanitizeIds(edits.hidden)
        val added = sanitizeIds(edits.added)
        if (hidden.isNotEmpty() || added.isNotEmpty()) put(term, TimetableEdits(hidden, added))
    }
}

class CampusSettings(context: Context) {
    private val context = context.applicationContext
    private val store = context.applicationContext.getSharedPreferences("campus-settings", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(PersonalSettings(
        klass = store.getString("class", null),
        campus = store.getString("campus", "仙林")!!,
        theme = store.getString("theme", "system")!!,
        calendar = store.getBoolean("calendar", false),
        reminders = store.getBoolean("reminders", false),
        leadMinutes = store.getInt("lead", 15),
        homeDorm = store.getString("home-dorm", null),
        navigationGuidanceShown = store.getBoolean("navigation-guidance", false),
        navigationGuidancePending = store.getBoolean("navigation-guidance-pending", false),
        reminderGuidanceShown = store.getBoolean("reminder-guidance", false),
        timetable = store.getString("timetable", null)?.let {
            runCatching { sanitizeTimetable(Json.decodeFromString<Map<String, TimetableEdits>>(it)) }.getOrDefault(emptyMap())
        } ?: emptyMap(),
    ))
    val state = _state.asStateFlow()
    fun update(change: (PersonalSettings) -> PersonalSettings) {
        val raw = change(_state.value)
        val next = raw.copy(timetable = sanitizeTimetable(raw.timetable))
        store.edit().putString("class", next.klass).putString("campus", next.campus).putString("theme", next.theme)
            .putBoolean("calendar", next.calendar).putBoolean("reminders", next.reminders).putInt("lead", next.leadMinutes).putString("home-dorm", next.homeDorm)
            .putBoolean("navigation-guidance", next.navigationGuidanceShown)
            .putBoolean("navigation-guidance-pending", next.navigationGuidancePending)
            .putBoolean("reminder-guidance", next.reminderGuidanceShown)
            .putString("timetable", if (next.timetable.isEmpty()) null else Json.encodeToString(next.timetable)).apply()
        _state.value = next
        top.hicancan.studev.widget.WidgetRefreshWorker.refresh(context)
        // Settings changes are data changes too: rebuild the rolling reminder
        // window through the same worker used by boot/timezone restoration.
        top.hicancan.studev.reminders.CampusRefreshWorker.enqueue(context)
    }
    fun updateTimetable(term: String, change: (TimetableEdits) -> TimetableEdits) {
        update { current ->
            val updated = change(current.timetableEdits(term))
            current.copy(timetable = current.timetable + (term to updated))
        }
    }
}
