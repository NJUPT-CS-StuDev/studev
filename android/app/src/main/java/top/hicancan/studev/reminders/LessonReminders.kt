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
import top.hicancan.studev.account.PLATFORM_ORIGIN
import top.hicancan.studev.timetable.CampusEvent
import java.time.Instant
import java.util.concurrent.TimeUnit

data class ReminderPlan(val event: CampusEvent, val at: Instant)
enum class ReminderScheduleMode { ExactAlarm, WorkManager }
object ReminderTimes {
    fun plans(events: List<CampusEvent>, leadMinutes: Int, now: Instant): List<ReminderPlan> = events.map {
        ReminderPlan(it, it.start.minusSeconds(leadMinutes.coerceIn(1, 120) * 60L))
    }.filter { it.at > now }.distinctBy { it.event.id }

    fun mode(exactAllowed: Boolean): ReminderScheduleMode =
        if (exactAllowed) ReminderScheduleMode.ExactAlarm else ReminderScheduleMode.WorkManager
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
        val preferences = prefs(context)
        preferences.getStringSet("ids", emptySet()).orEmpty().forEach { alarms.cancel(pending(context, it)) }
        work.cancelAllWorkByTag(TAG).result.get()
        if (!enabled) context.getSystemService(NotificationManager::class.java).let { manager ->
            manager.activeNotifications.filter { it.notification.channelId == TAG }.forEach { manager.cancel(it.id) }
        }
        // A rolling seven-day window stays below the platform's per-app alarm limit.
        // The persisted maintenance worker replenishes it twice daily and after boot.
        val plans = if (enabled) ReminderTimes.plans(events, lead, Instant.now()).filter { it.at < Instant.now().plusSeconds(7 * 86400L) } else emptyList()
        val edit = preferences.edit().putStringSet("ids", plans.map { it.event.id }.toSet())
        plans.forEach { edit.remove("sent:${it.event.id}") }
        edit.apply()
        if (!enabled) return@withContext
        val mode = ReminderTimes.mode(exact(context))
        plans.forEach { plan ->
            val event = plan.event
            val title = "${if (event.exam) "考试" else "上课"}还有 $lead 分钟 · ${event.title}"
            when (mode) {
                ReminderScheduleMode.ExactAlarm -> try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, plan.at.toEpochMilli(), pending(context, event.id, title, event.room))
                } catch (_: SecurityException) {
                    // Permission may have been revoked between the decision and
                    // the call. Rebuild once through the same fallback policy.
                    val fallback = fallback(event, title, plan.at)
                    work.enqueueUniqueWork("$TAG:${event.id}", ExistingWorkPolicy.REPLACE, fallback)
                }
                ReminderScheduleMode.WorkManager -> {
                    work.enqueueUniqueWork("$TAG:${event.id}", ExistingWorkPolicy.REPLACE, fallback(event, title, plan.at))
                }
            }
        }
    }
    private fun fallback(event: CampusEvent, title: String, at: Instant): OneTimeWorkRequest =
        OneTimeWorkRequestBuilder<ReminderWorker>().setInputData(workDataOf("id" to event.id, "title" to title,
            "room" to event.room, "start" to event.start.toEpochMilli())).setInitialDelay((at.toEpochMilli() - System.currentTimeMillis()).coerceAtLeast(0), TimeUnit.MILLISECONDS)
            .addTag(TAG).build()
    @SuppressLint("MissingPermission")
    @Synchronized fun notify(context: Context, id: String, title: String, room: String?) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val preferences = prefs(context)
        if (!preferences.getStringSet("ids", emptySet()).orEmpty().contains(id) || preferences.getBoolean("sent:$id", false)) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(TAG, "课程与考试提醒", NotificationManager.IMPORTANCE_HIGH))
        val uri = Uri.parse("$PLATFORM_ORIGIN/" + if (room == null) "search/timetable/" else "map/?place=${Uri.encode(room)}&route=true")
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
        // WorkManager is the permitted fallback when exact access is absent.
        // It may run late under Doze/OEM policy; deliver the reminder when it
        // runs instead of dropping it just because the planned instant passed.
        LessonReminders.notify(applicationContext, inputData.getString("id") ?: return Result.failure(), inputData.getString("title").orEmpty(), inputData.getString("room"))
        return Result.success()
    }
}
class ReminderRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(
                Intent.ACTION_BOOT_COMPLETED,
                Intent.ACTION_MY_PACKAGE_REPLACED,
                Intent.ACTION_TIME_CHANGED,
                Intent.ACTION_TIMEZONE_CHANGED,
                AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED,
            )) return
        CampusRefreshWorker.enqueue(context)
    }
}
