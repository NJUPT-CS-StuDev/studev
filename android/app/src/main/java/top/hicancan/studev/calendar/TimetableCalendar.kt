package top.hicancan.studev.calendar

import android.Manifest
import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import androidx.compose.ui.graphics.toArgb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.hicancan.studev.timetable.CampusEvent
import top.hicancan.studev.ui.theme.Tokens

/** Own local calendar only. Stable event identities update in place, and stale events are removed. */
object TimetableCalendar {
    private const val ACCOUNT = "studev"
    private fun adapter(uri: android.net.Uri) = uri.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT)
        .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL).build()
    fun permitted(context: Context) = listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR).all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }
    private fun calendar(context: Context): Long? = context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI,
        arrayOf(CalendarContract.Calendars._ID), "account_name=? AND account_type=? AND name=?",
        arrayOf(ACCOUNT, CalendarContract.ACCOUNT_TYPE_LOCAL, ACCOUNT), null)?.use { if (it.moveToFirst()) it.getLong(0) else null }
    suspend fun remove(context: Context) = withContext(Dispatchers.IO) {
        check(permitted(context)) { "请允许访问日历后移除 studev 日历" }
        calendar(context)?.let { context.contentResolver.delete(adapter(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, it)), null, null) }
        Unit
    }
    suspend fun sync(context: Context, events: List<CampusEvent>): Int = withContext(Dispatchers.IO) {
        check(permitted(context)) { "请允许访问日历" }
        val resolver = context.contentResolver
        val id = calendar(context) ?: resolver.insert(adapter(CalendarContract.Calendars.CONTENT_URI), ContentValues().apply {
            put(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT); put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            put(CalendarContract.Calendars.NAME, ACCOUNT); put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, "studev 课表与考试")
            put(CalendarContract.Calendars.CALENDAR_COLOR, Tokens.Color.Light.brand.toArgb())
            put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER)
            put(CalendarContract.Calendars.OWNER_ACCOUNT, ACCOUNT); put(CalendarContract.Calendars.VISIBLE, 1)
            put(CalendarContract.Calendars.SYNC_EVENTS, 1); put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, "Asia/Shanghai")
        })?.let(ContentUris::parseId) ?: error("设备未提供本地日历")
        val existing = mutableMapOf<String, Long>()
        resolver.query(CalendarContract.Events.CONTENT_URI, arrayOf(CalendarContract.Events._ID, CalendarContract.Events._SYNC_ID),
            "calendar_id=?", arrayOf(id.toString()), null)?.use { cursor -> while (cursor.moveToNext()) existing[cursor.getString(1).orEmpty()] = cursor.getLong(0) }
        val operations = arrayListOf<ContentProviderOperation>()
        events.forEach { event ->
            val values = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, id); put(CalendarContract.Events._SYNC_ID, event.id)
                put(CalendarContract.Events.TITLE, if (event.exam) "考试 · ${event.title}" else event.title)
                put(CalendarContract.Events.DTSTART, event.start.toEpochMilli()); put(CalendarContract.Events.DTEND, event.end.toEpochMilli())
                put(CalendarContract.Events.EVENT_TIMEZONE, "Asia/Shanghai"); put(CalendarContract.Events.EVENT_LOCATION, event.location ?: event.room.orEmpty())
                put(CalendarContract.Events.DESCRIPTION, event.description); put(CalendarContract.Events.HAS_ALARM, 0)
            }
            val old = existing.remove(event.id)
            val builder = if (old == null) ContentProviderOperation.newInsert(adapter(CalendarContract.Events.CONTENT_URI))
                else ContentProviderOperation.newUpdate(adapter(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, old)))
            operations += builder.withValues(values).build()
        }
        existing.values.forEach { operations += ContentProviderOperation.newDelete(adapter(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, it))).build() }
        operations.chunked(100).forEach { resolver.applyBatch(CalendarContract.AUTHORITY, ArrayList(it)) }
        events.size
    }
}
