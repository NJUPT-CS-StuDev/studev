package top.hicancan.studev.world

import kotlinx.serialization.Serializable
import java.util.Locale

@Serializable data class EventPreference(val avoid: String? = null, val layer: Long? = null)

/** Planning attitude and display order are independent; neither changes attendance or reminders. */
object Schedule {
    val AVOIDANCE = listOf("must" to "必须避开", "prefer" to "尽量避开", "allow" to "允许重叠")
    fun key(event: LineEvent, term: String, series: Boolean = false): String {
        if (event.task != null) return "task:${event.id}"
        var id = event.id
        if (series) {
            val code = event.meeting?.course?.code ?: event.lab?.course?.code ?: event.exam?.course?.code
            val name = event.meeting?.course?.name ?: event.lab?.course?.name ?: event.exam?.course?.name
            id = event.lab?.let(top.hicancan.studev.timetable.CourseCatalog::labCourseKey) ?: code?.trim()?.uppercase(Locale.ROOT)?.takeIf { it.isNotEmpty() } ?: event.meeting?.teaching_class?.id ?: name?.trim() ?: event.kind
        }
        return "$term:${event.kind}:${if (series) "course:" else ""}$id"
    }
    fun defaultAvoid(event: LineEvent) = if (event.task?.done != null) "allow" else if (event.kind == "exam" || event.kind == "task") "must" else "prefer"
    fun preference(event: LineEvent, term: String, preferences: Map<String, EventPreference>): EventPreference {
        val course = preferences[key(event, term, true)]
        val sitting = preferences[key(event, term)]
        return EventPreference(sitting?.avoid ?: course?.avoid ?: defaultAvoid(event), sitting?.layer ?: course?.layer ?: 0L)
    }
}
