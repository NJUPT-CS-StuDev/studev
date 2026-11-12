package top.hicancan.studev.device

import android.Manifest
import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.app.Tokens
import top.hicancan.studev.world.*
import java.time.LocalDate
import java.time.ZoneOffset

/** School facts that reach the phone beyond lessons and exams: the calendar's days without lessons, and 早锻炼. */
class PhoneFacts(val terms: List<CalendarTerm> = emptyList(), val run: MorningRun? = null)

private class Entry(val id: String, val title: String, val start: Long, val end: Long, val room: String, val description: String, val allDay: Boolean, val reminders: List<Int>, val transparent: Boolean = false)

/** Each kind of thing has its own local calendar, so each can be switched off in the system calendar too. */
object TimetableCalendar {
    private const val ACCOUNT = "studev"
    private data class Book(val name: String, val title: String)
    private val lessons = Book("studev", "studev 课程")
    private val exams = Book("studev-exams", "studev 考试")
    private val runs = Book("studev-run", "studev 早锻炼")
    private val tasks = Book("studev-tasks", "studev 任务")
    private fun adapter(uri: android.net.Uri) = uri.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT)
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL).build()
    fun permitted(context: Context) = listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR).all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }
    private fun find(context: Context, book: Book): Long? = context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI,
        arrayOf(CalendarContract.Calendars._ID), "account_name=? AND account_type=? AND name=?",
        arrayOf(ACCOUNT, CalendarContract.ACCOUNT_TYPE_LOCAL, book.name), null)?.use { if (it.moveToFirst()) it.getLong(0) else null }
    private fun remove(context: Context, book: Book) {
        find(context, book)?.let { context.contentResolver.delete(adapter(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, it)), null, null) }
    }
    /** The phone holds only the calendars studev writes now; any other calendar of its account goes. */
    private fun prune(context: Context) {
        val kept = setOf(lessons, exams, runs, tasks).map { it.name }
        context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.NAME),
            "account_name=? AND account_type=?", arrayOf(ACCOUNT, CalendarContract.ACCOUNT_TYPE_LOCAL), null)?.use { cursor ->
            while (cursor.moveToNext()) if (cursor.getString(1) !in kept)
                context.contentResolver.delete(adapter(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, cursor.getLong(0))), null, null)
        }
    }
    private fun write(context: Context, book: Book, entries: List<Entry>) {
        val resolver = context.contentResolver
        val id = find(context, book)?.also { found ->
            resolver.update(adapter(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, found)), ContentValues().apply { put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, book.title) }, null, null)
        } ?: resolver.insert(adapter(CalendarContract.Calendars.CONTENT_URI), ContentValues().apply {
            put(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT); put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            put(CalendarContract.Calendars.NAME, book.name); put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, book.title)
            put(CalendarContract.Calendars.CALENDAR_COLOR, Tokens.Color.Light.brand.toArgb())
            put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER)
            put(CalendarContract.Calendars.OWNER_ACCOUNT, ACCOUNT); put(CalendarContract.Calendars.VISIBLE, 1)
            put(CalendarContract.Calendars.SYNC_EVENTS, 1); put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, CampusDay.zone.id)
        })?.let(ContentUris::parseId) ?: error("设备未提供本地日历")
        val existing = mutableMapOf<String, Long>()
        resolver.query(CalendarContract.Events.CONTENT_URI, arrayOf(CalendarContract.Events._ID, CalendarContract.Events._SYNC_ID), "calendar_id=?", arrayOf(id.toString()), null)
            ?.use { cursor -> while (cursor.moveToNext()) existing[cursor.getString(1).orEmpty()] = cursor.getLong(0) }
        // A batch is at most 100 operations, and a reminder refers to its event by position within the batch.
        var batch = arrayListOf<ContentProviderOperation>()
        fun flush() { if (batch.isNotEmpty()) resolver.applyBatch(CalendarContract.AUTHORITY, batch); batch = arrayListOf() }
        for (entry in entries) {
            val values = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, id); put(CalendarContract.Events._SYNC_ID, entry.id)
                put(CalendarContract.Events.TITLE, entry.title)
                put(CalendarContract.Events.DTSTART, entry.start); put(CalendarContract.Events.DTEND, entry.end)
                put(CalendarContract.Events.ALL_DAY, if (entry.allDay) 1 else 0)
                put(CalendarContract.Events.AVAILABILITY, if (entry.transparent) CalendarContract.Events.AVAILABILITY_FREE else CalendarContract.Events.AVAILABILITY_BUSY)
                put(CalendarContract.Events.EVENT_TIMEZONE, if (entry.allDay) "UTC" else CampusDay.zone.id)
                put(CalendarContract.Events.EVENT_LOCATION, entry.room); put(CalendarContract.Events.DESCRIPTION, entry.description)
                put(CalendarContract.Events.HAS_ALARM, if (entry.reminders.isEmpty()) 0 else 1)
            }
            if (batch.size + 2 + entry.reminders.size > 100) flush()
            val old = existing.remove(entry.id)
            if (old != null) {
                // Reminders follow the current choice too: the old ones go and the chosen ones are written again.
                batch += ContentProviderOperation.newUpdate(adapter(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, old))).withValues(values).build()
                batch += ContentProviderOperation.newDelete(adapter(CalendarContract.Reminders.CONTENT_URI)).withSelection("${CalendarContract.Reminders.EVENT_ID}=?", arrayOf(old.toString())).build()
                for (minutes in entry.reminders) batch += ContentProviderOperation.newInsert(adapter(CalendarContract.Reminders.CONTENT_URI))
                    .withValue(CalendarContract.Reminders.EVENT_ID, old)
                    .withValue(CalendarContract.Reminders.MINUTES, minutes).withValue(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT).build()
                continue
            }
            val at = batch.size
            batch += ContentProviderOperation.newInsert(adapter(CalendarContract.Events.CONTENT_URI)).withValues(values).build()
            for (minutes in entry.reminders) batch += ContentProviderOperation.newInsert(adapter(CalendarContract.Reminders.CONTENT_URI))
                .withValueBackReference(CalendarContract.Reminders.EVENT_ID, at)
                .withValue(CalendarContract.Reminders.MINUTES, minutes).withValue(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT).build()
        }
        for (old in existing.values) {
            if (batch.size >= 100) flush()
            batch += ContentProviderOperation.newDelete(adapter(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, old))).build()
        }
        flush()
    }
    private fun day(date: LocalDate) = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    suspend fun sync(context: Context, events: List<LineEvent>, facts: PhoneFacts, settings: PersonalSettings, ownTasks: List<Task> = emptyList()): Int = withContext(Dispatchers.IO) {
        fun entry(event: LineEvent, title: String, reminders: List<Int>) = Entry(event.id, title, event.startsAt.toEpochMilli(), event.endsAt.toEpochMilli(),
            Names.room(event.room), (listOfNotNull(event.lab?.project) + event.teachers + listOfNotNull(event.exam?.note)).joinToString(" · "), false, reminders)
        prune(context)
        // A gap among the lessons says why it is there: the term's days without lessons, whole-day. The break is left out.
        val daysOff = facts.terms.flatMap { term -> (term.holidays + term.events).filter { it.start >= term.start && it.start <= term.end } }.map { item ->
            Entry("off:${item.start}:${item.name}", "${item.name} · 不上课", day(LocalDate.parse(item.start)), day(LocalDate.parse(item.end).plusDays(1)), "", "", true, emptyList())
        }
        val lessonRows = events.filter { it.kind == "class" }.map { entry(it, it.name, listOf(15)) } +
            events.filter { it.kind == "lab" }.map { entry(it, "实验 · ${it.name}", listOf(15)) }
        val examRows = events.filter { it.kind == "exam" }.map { entry(it, "考试 · ${it.name}", settings.examReminders.map { key -> Exams.reminderMinutes(key, it.start) }) }
        if (settings.calendar) write(context, lessons, lessonRows + daysOff) else remove(context, lessons)
        if (settings.calendarExams) write(context, exams, examRows) else remove(context, exams)
        val rule = facts.run
        if (settings.calendarRun && rule != null) {
            val rows = settings.runDays.map { day ->
                val date = LocalDate.parse(day)
                fun at(minutes: Int) = date.atStartOfDay(CampusDay.zone).plusMinutes(minutes.toLong()).toInstant().toEpochMilli()
                Entry("run:$day", "早锻炼", at(clock(rule.time[0])), at(clock(rule.time[1])), rule.xianlin?.route?.joinToString(" ↔ ").orEmpty(), "你排好的早锻炼", false, listOf(30))
            }
            write(context, runs, rows)
        } else remove(context, runs)
        val taskRows = ownTasks.filter { it.parent == null && it.done == null && it.deleted != true }.flatMap { task -> buildList {
            fun at(date: String, minute: Int) = LocalDate.parse(date).atStartOfDay(CampusDay.zone).plusMinutes(minute.toLong()).toInstant().toEpochMilli()
            if (task.date != null && task.start != null) add(Entry("task:${task.id}:plan", task.title, at(task.date, task.start), at(task.date, task.end ?: minOf(1440, task.start + Tasks.MINUTES)), "", task.note.orEmpty(), false, task.remind.orEmpty()))
            task.due?.let { due ->
                val start = if (due.time == null) day(LocalDate.parse(due.date)) else at(due.date, due.time)
                val end = if (due.time == null) day(LocalDate.parse(due.date).plusDays(1)) else start + 60000
                add(Entry("task:${task.id}:due", "截止 · ${task.title}", start, end, "", task.note.orEmpty(), due.time == null, if (due.time == null) emptyList() else due.remind.orEmpty(), true))
            }
        } }
        if (settings.calendarTasks) write(context, tasks, taskRows) else remove(context, tasks)
        lessonRows.size + examRows.size + taskRows.size
    }
}
