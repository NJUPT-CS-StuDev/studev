package top.hicancan.studev.me

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.decodeFromJsonElement

@Serializable
data class TimetableEdits(
    val hidden: List<String> = emptyList(),
    val added: List<String> = emptyList(),
    /** A name of one's own for a course, by course identity. */
    val names: Map<String, String> = emptyMap(),
    /** Courses of one's own. */
    val custom: List<top.hicancan.studev.timetable.CustomCourse> = emptyList(),
) {
    val isEmpty get() = hidden.isEmpty() && added.isEmpty() && names.isEmpty() && custom.isEmpty()
}

/** Lab sheets left out, lab courses not taken and single sittings missed. */
@Serializable
data class LabChoices(val off: List<String> = emptyList(), val drop: List<String> = emptyList(), val skip: List<String> = emptyList(), val classes: List<String> = emptyList())

data class PersonalSettings(
    val klass: String? = null,
    val campus: String = top.hicancan.studev.BuildConfig.DEFAULT_CAMPUS,
    val theme: String = "system",
    val calendar: Boolean = false,
    val reminders: Boolean = false,
    val leadMinutes: Int = 15,
    val navigationGuidanceShown: Boolean = false,
    val navigationGuidancePending: Boolean = false,
    val reminderGuidanceShown: Boolean = false,
    /** The map ball has turned once and said what it does. */
    val ballHinted: Boolean = false,
    val timetable: Map<String, TimetableEdits> = emptyMap(),
    val examAttendance: Map<String, Map<String, Boolean>> = emptyMap(),
    val calendarExams: Boolean = false,
    val calendarTasks: Boolean = false,
    /** null until someone chooses: 大一大二 see 早锻炼 by default. */
    val runShown: Boolean? = null,
    /** The mornings put down for 早锻炼; gone by counts as run. */
    val runDays: List<String> = emptyList(),
    /** The bonus or penalty entered from the sports office. */
    val runAdjust: Int = 0,
    val calendarRun: Boolean = false,
    /** What the home-screen widget shows: "auto" follows its size. */
    val widgetView: String = "auto",
    /** The latest exam change this person has been shown. */
    val examsSeen: String? = null,
    /** When exams written to the phone's calendar remind, as keys of Exams.REMINDERS. */
    val examReminders: List<String> = top.hicancan.studev.world.Exams.DEFAULT_REMINDERS,
    /** Which kind shows in front when things overlap, front first. */
    val layers: List<String> = top.hicancan.studev.world.CampusLine.LAYER_ORDER,
    val labs: LabChoices = LabChoices(),
    val events: Map<String, top.hicancan.studev.world.EventPreference> = emptyMap(),
    /** When each part that goes with one to one's other devices last changed (CampusSettings.SECTIONS). */
    val modified: Map<String, String> = emptyMap(),
) {
    fun timetableEdits(term: String): TimetableEdits = timetable[term] ?: TimetableEdits()
    fun examChoices(term: String?, klass: String?): Map<String, Boolean> =
        if (term == null || klass == null) emptyMap() else examAttendance[top.hicancan.studev.timetable.ExamAttendance.scope(term, klass)].orEmpty()
}

private val termPattern = Regex("^\\d{4}-\\d{4}-\\d$")
private fun sanitizeIds(ids: List<String>): List<String> =
    ids.map { it.trim() }.filter { it.isNotEmpty() && it.length < 120 }.distinct()

private fun sanitizeTimetable(raw: Map<String, TimetableEdits>): Map<String, TimetableEdits> = buildMap {
    for ((term, edits) in raw) {
        if (!termPattern.matches(term)) continue
        val names = edits.names.filter { (key, name) -> key.length < 200 && name.isNotBlank() }.mapValues { it.value.trim().take(60) }
        val custom = edits.custom.mapNotNull { item ->
            val days = item.days.filter { it in 1..7 }.distinct().sorted()
            val periods = item.periods.takeIf { it.size == 2 && it.all { period -> period in 1..14 } && it[0] <= it[1] }
            val weeks = item.weeks.filter { it in 1..30 }.distinct().sorted()
            if (item.name.isBlank() || days.isEmpty() || periods == null || weeks.isEmpty()) null
            else top.hicancan.studev.timetable.CustomCourse(item.id.take(60), item.name.trim().take(60), days, periods, weeks,
                item.room?.trim()?.takeIf { it.isNotEmpty() }?.take(60), item.teacher?.trim()?.takeIf { it.isNotEmpty() }?.take(40))
        }
        val next = TimetableEdits(sanitizeIds(edits.hidden), sanitizeIds(edits.added), names, custom)
        if (!next.isEmpty) put(term, next)
    }
}

private fun sanitizeAttendance(raw: Map<String, Map<String, Boolean>>) = raw.filterKeys {
    Regex("^\\d{4}-\\d{4}-\\d:[A-Z]\\d{6}(\\([A-Z]{2}\\))?$").matches(it)
}.mapValues { (_, choices) -> choices.filterKeys { it.isNotBlank() && it.length < 200 } }

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
        navigationGuidanceShown = store.getBoolean("navigation-guidance", false),
        navigationGuidancePending = store.getBoolean("navigation-guidance-pending", false),
        reminderGuidanceShown = store.getBoolean("reminder-guidance", false),
        ballHinted = store.getBoolean("ball-hinted", false),
        timetable = store.getString("timetable", null)?.let {
            runCatching { sanitizeTimetable(Json.decodeFromString<Map<String, TimetableEdits>>(it)) }.getOrDefault(emptyMap())
        } ?: emptyMap(),
        examAttendance = store.getString("exam-attendance", null)?.let {
            runCatching { sanitizeAttendance(Json.decodeFromString<Map<String, Map<String, Boolean>>>(it)) }.getOrDefault(emptyMap())
        } ?: emptyMap(),
        calendarExams = store.getBoolean("calendar-exams", false),
        calendarTasks = store.getBoolean("calendar-tasks", false),
        runShown = if (store.contains("run-shown")) store.getBoolean("run-shown", false) else null,
        runDays = store.getString("run-days", null)?.let { raw -> runCatching { Json.decodeFromString<List<String>>(raw) }.getOrNull() } ?: emptyList(),
        runAdjust = store.getInt("run-adjust", 0),
        calendarRun = store.getBoolean("calendar-run", false),
        widgetView = store.getString("widget-view", "auto")!!,
        examsSeen = store.getString("exams-seen", null),
        examReminders = store.getString("exam-reminders", null)?.let { Json.decodeFromString<List<String>>(it) } ?: top.hicancan.studev.world.Exams.DEFAULT_REMINDERS,
        // Only a whole ordering of every kind is kept: a partial one would leave some kind nowhere.
        layers = store.getString("layers", null)?.let { Json.decodeFromString<List<String>>(it) }?.takeIf { it.sorted() == top.hicancan.studev.world.CampusLine.LAYER_ORDER.sorted() } ?: top.hicancan.studev.world.CampusLine.LAYER_ORDER,
        labs = store.getString("labs", null)?.let { Json.decodeFromString<LabChoices>(it) } ?: LabChoices(),
        events = store.getString("events", null)?.let { Json.decodeFromString<Map<String, top.hicancan.studev.world.EventPreference>>(it) } ?: emptyMap(),
        modified = store.getString("modified", null)?.let { runCatching { Json.decodeFromString<Map<String, String>>(it) }.getOrNull() }.orEmpty().filterKeys { it in SECTIONS },
    ).let(::initial))
    val state = _state.asStateFlow()
    init {
        if (_state.value.modified.isNotEmpty()) store.edit().putString("modified", Json.encodeToString(_state.value.modified)).apply()
    }
    /**
     * Settings changed here: each part that changed notes now as when, as writePreferences on the web. [adopt] writes
     * parts taken from another device as they came, their own times kept, so that taking them is not a change made here.
     */
    fun update(adopt: Boolean = false, change: (PersonalSettings) -> PersonalSettings) {
        val before = _state.value
        val raw = change(before)
        var next = raw.copy(timetable = sanitizeTimetable(raw.timetable), examAttendance = sanitizeAttendance(raw.examAttendance))
        if (!adopt) {
            val was = sections(before); val now = sections(next); val at = top.hicancan.studev.world.Tasks.stamp(java.time.Instant.now())
            next = next.copy(modified = next.modified + SECTIONS.filter { was[it] != now[it] }.associateWith { at })
        }
        store.edit().putString("class", next.klass).putString("campus", next.campus).putString("theme", next.theme)
            .putBoolean("calendar", next.calendar).putBoolean("reminders", next.reminders).putInt("lead", next.leadMinutes)
            .putBoolean("navigation-guidance", next.navigationGuidanceShown)
            .putBoolean("navigation-guidance-pending", next.navigationGuidancePending)
            .putBoolean("reminder-guidance", next.reminderGuidanceShown)
            .putBoolean("ball-hinted", next.ballHinted)
            .putString("timetable", if (next.timetable.isEmpty()) null else Json.encodeToString(next.timetable))
            .putString("exam-attendance", if (next.examAttendance.isEmpty()) null else Json.encodeToString(next.examAttendance))
            .putBoolean("calendar-exams", next.calendarExams).putBoolean("calendar-tasks", next.calendarTasks).putString("events", Json.encodeToString(next.events))
            .putString("run-days", Json.encodeToString(next.runDays)).putInt("run-adjust", next.runAdjust).putBoolean("calendar-run", next.calendarRun).putString("widget-view", next.widgetView).putString("exams-seen", next.examsSeen).putString("exam-reminders", Json.encodeToString(next.examReminders)).putString("layers", Json.encodeToString(next.layers)).putString("labs", Json.encodeToString(next.labs)).putString("modified", Json.encodeToString(next.modified))
            .apply { if (next.runShown == null) remove("run-shown") else putBoolean("run-shown", next.runShown) }.apply()
        _state.value = next
        top.hicancan.studev.widget.WidgetRefreshWorker.refresh(context)
        // Settings changes are data changes too: rebuild the rolling reminder
        // window through the same worker used by boot/timezone restoration.
        top.hicancan.studev.device.DeviceRefreshWorker.enqueue(context)
    }
    fun update(change: (PersonalSettings) -> PersonalSettings) = update(false, change)

    companion object {
        /** The parts of one's settings that go with one, as SECTIONS in src/campus/world/merge.mjs. */
        val SECTIONS = listOf("class", "campus", "timetable", "examAttendance", "examReminders", "labs", "layers", "events", "run")
        private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

        /** Choices made before sync existed travel too, without replacing a later explicit choice on another device. */
        fun initial(s: PersonalSettings): PersonalSettings {
            val defaults = sections(PersonalSettings()); val kept = sections(s)
            return s.copy(modified = s.modified + SECTIONS.filter { it !in s.modified && kept[it] != defaults[it] }.associateWith { "1970-01-01T00:00:00.000Z" })
        }

        /** Each part as the web keeps it in its preferences, so that either can take what the other wrote. */
        fun sections(s: PersonalSettings): Map<String, kotlinx.serialization.json.JsonElement> = mapOf(
            "class" to (s.klass?.let(::JsonPrimitive) ?: kotlinx.serialization.json.JsonNull),
            "campus" to JsonPrimitive(s.campus),
            "timetable" to json.encodeToJsonElement(s.timetable),
            "examAttendance" to json.encodeToJsonElement(s.examAttendance),
            "examReminders" to json.encodeToJsonElement(s.examReminders),
            "labs" to json.encodeToJsonElement(s.labs),
            "layers" to json.encodeToJsonElement(s.layers),
            "events" to json.encodeToJsonElement(s.events),
            "run" to kotlinx.serialization.json.buildJsonObject { s.runShown?.let { put("on", JsonPrimitive(it)) }; put("days", json.encodeToJsonElement(s.runDays)); put("adjust", JsonPrimitive(s.runAdjust)) },
        )

        /** A part taken from another device into these settings; a part cleared there goes back to how it starts. */
        fun take(s: PersonalSettings, section: String, value: kotlinx.serialization.json.JsonElement): PersonalSettings {
            val none = value is kotlinx.serialization.json.JsonNull
            return when (section) {
                "class" -> s.copy(klass = if (none) null else (value as JsonPrimitive).content)
                "campus" -> s.copy(campus = if (none) top.hicancan.studev.BuildConfig.DEFAULT_CAMPUS else (value as JsonPrimitive).content)
                "timetable" -> s.copy(timetable = if (none) emptyMap() else json.decodeFromJsonElement(value))
                "examAttendance" -> s.copy(examAttendance = if (none) emptyMap() else json.decodeFromJsonElement(value))
                "examReminders" -> s.copy(examReminders = if (none) top.hicancan.studev.world.Exams.DEFAULT_REMINDERS else json.decodeFromJsonElement(value))
                "labs" -> s.copy(labs = if (none) LabChoices() else json.decodeFromJsonElement(value))
                "layers" -> s.copy(layers = if (none) top.hicancan.studev.world.CampusLine.LAYER_ORDER else json.decodeFromJsonElement<List<String>>(value).takeIf { it.sorted() == top.hicancan.studev.world.CampusLine.LAYER_ORDER.sorted() } ?: top.hicancan.studev.world.CampusLine.LAYER_ORDER)
                "events" -> s.copy(events = if (none) emptyMap() else json.decodeFromJsonElement(value))
                "run" -> if (none) s.copy(runShown = null, runDays = emptyList(), runAdjust = 0) else (value as kotlinx.serialization.json.JsonObject).let { run ->
                    s.copy(runShown = (run["on"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull(), runDays = run["days"]?.let { json.decodeFromJsonElement<List<String>>(it) }.orEmpty(), runAdjust = (run["adjust"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0)
                }
                else -> s
            }
        }
    }

    fun updateTimetable(term: String, change: (TimetableEdits) -> TimetableEdits) {
        update { current ->
            val updated = change(current.timetableEdits(term))
            current.copy(timetable = current.timetable + (term to updated))
        }
    }
    fun updateExamAttendance(term: String, klass: String, choices: Map<String, Boolean>) {
        update { current ->
            val scope = top.hicancan.studev.timetable.ExamAttendance.scope(term, klass)
            current.copy(examAttendance = current.examAttendance + (scope to (current.examAttendance[scope].orEmpty() + choices)))
        }
    }
}
