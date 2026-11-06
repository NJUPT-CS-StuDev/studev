package top.hicancan.studev.reminders

import android.content.Context
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import top.hicancan.studev.calendar.PhoneFacts
import top.hicancan.studev.calendar.TimetableCalendar
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.timetable.CampusEvent

/** The foreground and maintenance worker share one mutation queue. Read opt-ins after
 * acquiring it, so a stale worker cannot recreate a calendar after the user opts out. */
object DeviceSchedule {
    private val mutations = Mutex()
    suspend fun update(context: Context, events: List<CampusEvent>, expectedClass: String?, expectedSettings: PersonalSettings? = null, facts: PhoneFacts = PhoneFacts()): Int? = mutations.withLock {
        val settings = CampusSettings(context).state.value
        if (settings.klass != expectedClass) return@withLock null
        if (expectedSettings != null && (settings.timetable != expectedSettings.timetable || settings.examAttendance != expectedSettings.examAttendance)) return@withLock null
        LessonReminders.sync(context, events, settings.reminders, settings.leadMinutes)
        RunAlarm.schedule(context, facts.run, facts.holidays, settings)
        if (TimetableCalendar.permitted(context)) TimetableCalendar.sync(context, events, facts, settings) else null
    }
}
