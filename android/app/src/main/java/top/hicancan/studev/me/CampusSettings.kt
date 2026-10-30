package top.hicancan.studev.me

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class PersonalSettings(val klass: String? = null, val campus: String = "仙林", val theme: String = "system", val calendar: Boolean = false, val reminders: Boolean = false, val leadMinutes: Int = 15)
class CampusSettings(context: Context) {
    private val store = context.applicationContext.getSharedPreferences("campus-settings", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(PersonalSettings(store.getString("class", null), store.getString("campus", "仙林")!!,
        store.getString("theme", "system")!!, store.getBoolean("calendar", false), store.getBoolean("reminders", false), store.getInt("lead", 15)))
    val state = _state.asStateFlow()
    fun update(change: (PersonalSettings) -> PersonalSettings) {
        val next = change(_state.value)
        store.edit().putString("class", next.klass).putString("campus", next.campus).putString("theme", next.theme)
            .putBoolean("calendar", next.calendar).putBoolean("reminders", next.reminders).putInt("lead", next.leadMinutes).apply()
        _state.value = next
    }
}
