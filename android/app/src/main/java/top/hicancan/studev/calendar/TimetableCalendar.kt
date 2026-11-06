package top.hicancan.studev.calendar

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
import top.hicancan.studev.timetable.CampusDay
import top.hicancan.studev.timetable.CampusEvent
import top.hicancan.studev.ui.theme.Tokens
import top.hicancan.studev.world.*
import java.time.LocalDate
import java.time.ZoneOffset

/** School facts that reach the phone beyond lessons and exams. */
class PhoneFacts(val terms: List<CalendarTerm> = emptyList(), val run: MorningRun? = null) {
    val holidays = CampusLine.holidays(terms)
}

private class Entry(val id: String, val title: String, val start: Long, val end: Long, val room: String, val description: String, val allDay: Boolean, val reminders: List<Int>)

/** Each kind of thing has its own local calendar, so each can be switched off in the system calendar too. */
object TimetableCalendar {
    private const val ACCOUNT = "studev"
    private data class Book(val name: String, val title: String)
    private val lessons = Book("studev", "studev 课表")
    private val exams = Book("studev-exams", "studev 考表")
    private val school = Book("studev-school", "studev 校历")
    private val runs = Book("studev-run", "studev 早锻炼")
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
    private fun write(context: Context, book: Book, entries: List<Entry>) {
        val resolver = context.contentResolver
        val id = find(context, book) ?: resolver.insert(adapter(CalendarContract.Calendars.CONTENT_URI), ContentValues().apply {
            put(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT); put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            put(CalendarContract.Calendars.NAME, book.name); put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, book.title)
            put(CalendarContract.Calendars.CALENDAR_COLOR, Tokens.Color.Light.brand.toArgb())
            put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER)
            put(CalendarContract.Calendars.OWNER_ACCOUNT, ACCOUNT); put(CalendarContract.Calendars.VISIBLE, 1)
            put(CalendarContract.Calendars.SYNC_EVENTS, 1); put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, CampusDay.zone.id)
        })?.let(ContentUris::parseId) ?: error("设备未提供本地日历")
        // The old single calendar had a different title; renaming keeps its events in place.
        resolver.update(adapter(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, id)), ContentValues().apply { put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, book.title) }, null, null)
        val existing = mutableMapOf<String, Long>()
        resolver.query(CalendarContract.Events.CONTENT_URI, arrayOf(CalendarContract.Events._ID, CalendarContract.Events._SYNC_ID), "calendar_id=?", arrayOf(id.toString()), null)
            ?.use { cursor -> while (cursor.moveToNext()) existing[cursor.getString(1).orEmpty()] = cursor.getLong(0) }
        val operations = arrayListOf<ContentProviderOperation>()
        for (entry in entries) {
            val values = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, id); put(CalendarContract.Events._SYNC_ID, entry.id)
                put(CalendarContract.Events.TITLE, entry.title)
                put(CalendarContract.Events.DTSTART, entry.start); put(CalendarContract.Events.DTEND, entry.end)
                put(CalendarContract.Events.ALL_DAY, if (entry.allDay) 1 else 0)
                put(CalendarContract.Events.EVENT_TIMEZONE, if (entry.allDay) "UTC" else CampusDay.zone.id)
                put(CalendarContract.Events.EVENT_LOCATION, entry.room); put(CalendarContract.Events.DESCRIPTION, entry.description)
                put(CalendarContract.Events.HAS_ALARM, if (entry.reminders.isEmpty()) 0 else 1)
            }
            val old = existing.remove(entry.id)
            if (old != null) { operations += ContentProviderOperation.newUpdate(adapter(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, old))).withValues(values).build(); continue }
            val at = operations.size
            operations += ContentProviderOperation.newInsert(adapter(CalendarContract.Events.CONTENT_URI)).withValues(values).build()
            for (minutes in entry.reminders) operations += ContentProviderOperation.newInsert(adapter(CalendarContract.Reminders.CONTENT_URI))
                .withValueBackReference(CalendarContract.Reminders.EVENT_ID, at)
                .withValue(CalendarContract.Reminders.MINUTES, minutes).withValue(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT).build()
        }
        existing.values.forEach { operations += ContentProviderOperation.newDelete(adapter(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, it))).build() }
        // Back references need an insert and its reminders in one batch.
        var from = 0
        while (from < operations.size) {
            var to = minOf(from + 100, operations.size)
            while (to < operations.size && operations[to].uri.toString().contains("reminders")) to++
            resolver.applyBatch(CalendarContract.AUTHORITY, ArrayList(operations.subList(from, to)))
            from = to
        }
    }
    private fun day(date: LocalDate) = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    suspend fun sync(context: Context, events: List<CampusEvent>, facts: PhoneFacts, settings: PersonalSettings): Int = withContext(Dispatchers.IO) {
        fun entry(event: CampusEvent, title: String, reminders: List<Int>) = Entry(event.id, title, event.start.toEpochMilli(), event.end.toEpochMilli(),
            Names.room(event.room), event.description, false, reminders)
        val lessonRows = events.filterNot { it.exam }.map { entry(it, it.title, listOf(15)) }
        val examRows = events.filter { it.exam }.map { entry(it, "考试 · ${it.title}", listOf(24 * 60, 60)) }
        if (settings.calendar) write(context, lessons, lessonRows) else remove(context, lessons)
        if (settings.calendarExams) write(context, exams, examRows) else remove(context, exams)
        if (settings.calendarSchool) {
            write(context, school, facts.terms.flatMap { term -> term.holidays + term.events + listOfNotNull(term.pause) }.map { item ->
                Entry("school:${item.name}:${item.start}", item.name, day(LocalDate.parse(item.start)), day(LocalDate.parse(item.end).plusDays(1)), "", "校历", true, emptyList())
            })
        } else remove(context, school)
        val rule = facts.run
        if (settings.runAlarm && rule != null) {
            val rows = mutableListOf<Entry>()
            var date = LocalDate.parse(rule.start)
            while (date.toString() <= rule.end) {
                if (CampusLine.isRunDay(rule, facts.holidays, date)) {
                    fun at(minutes: Int) = date.atStartOfDay(CampusDay.zone).plusMinutes(minutes.toLong()).toInstant().toEpochMilli()
                    rows += Entry("run:$date", "早锻炼", at(clock(rule.time[0])), at(clock(rule.time[1])), rule.xianlin?.route?.joinToString(" ↔ ").orEmpty(), "次数以南邮小程序为准", false, emptyList())
                }
                date = date.plusDays(1)
            }
            write(context, runs, if (settings.runDone >= rule.required) emptyList() else rows)
        } else remove(context, runs)
        lessonRows.size + examRows.size
    }
}
