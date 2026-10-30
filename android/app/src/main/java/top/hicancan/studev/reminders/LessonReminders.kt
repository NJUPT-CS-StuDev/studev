package top.hicancan.studev.reminders

import android.Manifest
import android.annotation.SuppressLint
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.hicancan.studev.MainActivity
import top.hicancan.studev.R
import top.hicancan.studev.timetable.CampusEvent
import java.time.Instant
import java.util.concurrent.TimeUnit

data class ReminderPlan(val event: CampusEvent, val at: Instant)
object ReminderTimes {
    fun plans(events: List<CampusEvent>, leadMinutes: Int, now: Instant): List<ReminderPlan> = events.map {
        ReminderPlan(it, it.start.minusSeconds(leadMinutes.coerceIn(1, 120) * 60L))
    }.filter { it.at > now }.distinctBy { it.event.id }
}
object LessonReminders {
    private const val TAG = "studev-reminders"
    private fun prefs(context: Context) = context.getSharedPreferences(TAG, Context.MODE_PRIVATE)
    fun exact(context: Context) = Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    private fun pending(context: Context, id: String, title: String = "", room: String? = null) = PendingIntent.getBroadcast(context, 0,
        Intent(context, ReminderReceiver::class.java).setAction("studev.reminder").setData(Uri.parse("studev-reminder://event/" + Uri.encode(id)))
            .putExtra("title", title).putExtra("room", room), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    @SuppressLint("ScheduleExactAlarm")
    suspend fun sync(context: Context, events: List<CampusEvent>, enabled: Boolean, lead: Int) = withContext(Dispatchers.IO) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val work = WorkManager.getInstance(context)
        prefs(context).getStringSet("ids", emptySet()).orEmpty().forEach { alarms.cancel(pending(context, it)) }
        work.cancelAllWorkByTag(TAG).result.get()
        if (!enabled) context.getSystemService(NotificationManager::class.java).let { manager ->
            manager.activeNotifications.filter { it.notification.channelId == TAG }.forEach { manager.cancel(it.id) }
        }
        // A rolling seven-day window stays below the platform's per-app alarm limit.
        // The persisted maintenance worker replenishes it twice daily and after boot.
        val plans = if (enabled) ReminderTimes.plans(events, lead, Instant.now()).filter { it.at < Instant.now().plusSeconds(7 * 86400L) } else emptyList()
        prefs(context).edit().putStringSet("ids", plans.map { it.event.id }.toSet()).apply()
        plans.forEach { plan ->
            val event = plan.event
            val title = "${if (event.exam) "考试" else "上课"}还有 $lead 分钟 · ${event.title}"
            // Keep a persisted fallback even when exact access is later revoked by the system.
            val fallback = OneTimeWorkRequestBuilder<ReminderWorker>().setInputData(workDataOf("id" to event.id, "title" to title,
                "room" to event.room, "start" to event.start.toEpochMilli())).setInitialDelay((plan.at.toEpochMilli() - System.currentTimeMillis()).coerceAtLeast(0), TimeUnit.MILLISECONDS)
                .addTag(TAG).build()
            work.enqueueUniqueWork("$TAG:${event.id}", ExistingWorkPolicy.REPLACE, fallback)
            if (exact(context)) try { alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, plan.at.toEpochMilli(), pending(context, event.id, title, event.room)) }
                catch (_: SecurityException) { /* The already scheduled work remains valid. */ }
        }
    }
    @SuppressLint("MissingPermission")
    @Synchronized fun notify(context: Context, id: String, title: String, room: String?) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val preferences = prefs(context)
        if (!preferences.getStringSet("ids", emptySet()).orEmpty().contains(id) || preferences.getBoolean("sent:$id", false)) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(TAG, "课程与考试提醒", NotificationManager.IMPORTANCE_HIGH))
        val uri = Uri.parse("https://studev.hicancan.top/" + if (room == null) "search/timetable/" else "map/?place=${Uri.encode(room)}&route=true")
        val open = PendingIntent.getActivity(context, id.hashCode(), Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(uri),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, TAG).setSmallIcon(R.drawable.ic_navigation).setContentTitle(title)
            .setContentText(room ?: "打开课表查看详情").setContentIntent(open).setAutoCancel(true)
        if (room != null) notification.addAction(R.drawable.ic_navigation, "导航到 $room", open)
        manager.notify(id.hashCode(), notification.build())
        preferences.edit().putBoolean("sent:$id", true).apply()
    }
}
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.data?.lastPathSegment ?: return
        LessonReminders.notify(context, id, intent.getStringExtra("title").orEmpty(), intent.getStringExtra("room"))
    }
}
class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (inputData.getLong("start", 0) > System.currentTimeMillis())
            LessonReminders.notify(applicationContext, inputData.getString("id") ?: return Result.failure(), inputData.getString("title").orEmpty(), inputData.getString("room"))
        return Result.success()
    }
}
class ReminderRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED)) return
        WorkManager.getInstance(context).enqueueUniqueWork("campus-refresh", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<CampusRefreshWorker>().build())
    }
}
