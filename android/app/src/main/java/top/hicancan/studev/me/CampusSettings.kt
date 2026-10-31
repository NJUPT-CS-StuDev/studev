package top.hicancan.studev.me

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

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
)
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
    ))
    val state = _state.asStateFlow()
    fun update(change: (PersonalSettings) -> PersonalSettings) {
        val next = change(_state.value)
        store.edit().putString("class", next.klass).putString("campus", next.campus).putString("theme", next.theme)
            .putBoolean("calendar", next.calendar).putBoolean("reminders", next.reminders).putInt("lead", next.leadMinutes).putString("home-dorm", next.homeDorm)
            .putBoolean("navigation-guidance", next.navigationGuidanceShown)
            .putBoolean("navigation-guidance-pending", next.navigationGuidancePending)
            .putBoolean("reminder-guidance", next.reminderGuidanceShown).apply()
        _state.value = next
        top.hicancan.studev.widget.WidgetRefreshWorker.refresh(context)
        // Settings changes are data changes too: rebuild the rolling reminder
        // window through the same worker used by boot/timezone restoration.
        top.hicancan.studev.reminders.CampusRefreshWorker.enqueue(context)
    }
}
