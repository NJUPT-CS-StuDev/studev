package top.hicancan.studev.device

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
import top.hicancan.studev.world.LineEvent
import top.hicancan.studev.world.startsAt
import java.time.Instant
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/** One reminder to deliver: what it says, where it leads, and when. */
data class ReminderPlan(val id: String, val title: String, val room: String?, val at: Instant, val start: Instant)
enum class ReminderScheduleMode { ExactAlarm, WorkManager }
object ReminderTimes {
    /** Lessons, labs and exams remind a set time before they start, when lesson reminders are on. */
    fun plans(events: List<LineEvent>, leadMinutes: Int, now: Instant): List<ReminderPlan> = events.map {
        val lead = leadMinutes.coerceIn(1, 120)
        val title = "${when (it.kind) { "exam" -> "考试"; "lab" -> "实验"; else -> "上课" }}还有 $lead 分钟 · ${it.name}"
        ReminderPlan(it.id, title, it.room, it.startsAt.minusSeconds(lead * 60L), it.startsAt)
    }.filter { it.at > now }.distinctBy { it.id }
    /** One's own tasks remind when each was asked to: they are theirs, so they do not wait for lesson reminders to be on. */
    fun taskPlans(tasks: List<top.hicancan.studev.world.Task>, now: Instant): List<ReminderPlan> = tasks.filter { it.parent == null && it.done == null && it.deleted != true }.flatMap { task ->
        listOf("plan" to task.remind.orEmpty(), "due" to task.due?.remind.orEmpty()).flatMap { (anchor, reminders) -> reminders.mapNotNull { remind ->
            val (date, min) = top.hicancan.studev.world.Tasks.reminderAt(task, remind, anchor) ?: return@mapNotNull null
            val at = date.atStartOfDay(top.hicancan.studev.world.CampusDay.zone).plusMinutes(min.toLong()).toInstant()
            val day = if (anchor == "due") task.due!!.date else task.date!!
            val time = if (anchor == "due") task.due?.time ?: 1439 else task.start ?: 0
            val start = LocalDate.parse(day).atStartOfDay(top.hicancan.studev.world.CampusDay.zone).plusMinutes(time.toLong()).toInstant()
            val title = if (anchor == "due") "截止提醒 · ${task.title}" else if (remind == 0) "任务开始 · ${task.title}" else "执行提醒 · ${task.title}"
            ReminderPlan("task:${task.id}:$anchor:$remind", title, null, at, start)
        } }
    }.filter { it.at > now }

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
    suspend fun sync(context: Context, events: List<LineEvent>, tasks: List<top.hicancan.studev.world.Task>, enabled: Boolean, lead: Int) = withContext(Dispatchers.IO) {
        val now = Instant.now()
        replace(context, (if (enabled) ReminderTimes.plans(events, lead, now) else emptyList()) + ReminderTimes.taskPlans(tasks, now), tasks, !enabled) { true }
    }
    /** A local task still reminds when campus files cannot be read; keep existing school reminders intact. */
    suspend fun syncTasks(context: Context, tasks: List<top.hicancan.studev.world.Task>) = withContext(Dispatchers.IO) {
        replace(context, ReminderTimes.taskPlans(tasks, Instant.now()), tasks, false) { it.startsWith("task:") }
    }
    private fun replace(context: Context, requested: List<ReminderPlan>, tasks: List<top.hicancan.studev.world.Task>, clearLessons: Boolean, selected: (String) -> Boolean) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val work = WorkManager.getInstance(context)
        val preferences = prefs(context)
        val previous = preferences.getStringSet("ids", emptySet()).orEmpty()
        val replaced = previous.filter(selected)
        replaced.forEach { id -> alarms.cancel(pending(context, id)); work.cancelUniqueWork("$TAG:$id").result.get() }
        context.getSystemService(NotificationManager::class.java).let { manager ->
            val live = tasks.filter { it.deleted != true && it.done == null }.map { "task:${it.id}:" }
            manager.activeNotifications.filter { notice -> notice.notification.channelId == TAG &&
                (if (notice.tag?.startsWith("task:") == true) live.none { notice.tag.startsWith(it) } else clearLessons) }
                .forEach { manager.cancel(it.tag, it.id) }
        }
        // A rolling seven-day window stays below the platform's per-app alarm limit.
        // The persisted maintenance worker replenishes it twice daily and after boot.
        val now = Instant.now()
        val plans = requested.filter { it.at < now.plusSeconds(7 * 86400L) }
        val edit = preferences.edit().putStringSet("ids", (previous.filterNot(selected) + plans.map { it.id }).toSet())
        replaced.forEach { edit.remove("sent:$it") }
        plans.forEach { edit.remove("sent:${it.id}") }
        edit.apply()
        val mode = ReminderTimes.mode(exact(context))
        plans.forEach { plan ->
            when (mode) {
                ReminderScheduleMode.ExactAlarm -> try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, plan.at.toEpochMilli(), pending(context, plan.id, plan.title, plan.room))
                } catch (_: SecurityException) {
                    // Permission may have been revoked between the decision and
                    // the call. Rebuild once through the same fallback policy.
                    work.enqueueUniqueWork("$TAG:${plan.id}", ExistingWorkPolicy.REPLACE, fallback(plan))
                }
                ReminderScheduleMode.WorkManager -> work.enqueueUniqueWork("$TAG:${plan.id}", ExistingWorkPolicy.REPLACE, fallback(plan))
            }
        }
    }
    private fun fallback(plan: ReminderPlan): OneTimeWorkRequest =
        OneTimeWorkRequestBuilder<ReminderWorker>().setInputData(workDataOf("id" to plan.id, "title" to plan.title,
            "room" to plan.room, "start" to plan.start.toEpochMilli())).setInitialDelay((plan.at.toEpochMilli() - System.currentTimeMillis()).coerceAtLeast(0), TimeUnit.MILLISECONDS)
            .addTag(TAG).build()
    @SuppressLint("MissingPermission")
    @Synchronized fun notify(context: Context, id: String, title: String, room: String?) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val preferences = prefs(context)
        if (!preferences.getStringSet("ids", emptySet()).orEmpty().contains(id) || preferences.getBoolean("sent:$id", false)) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(TAG, "课程、考试与任务提醒", NotificationManager.IMPORTANCE_HIGH))
        val uri = Uri.parse("$PLATFORM_ORIGIN/" + if (room == null) "" else "map/?nav=${Uri.encode(room)}")
        val open = PendingIntent.getActivity(context, id.hashCode(), Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(uri),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val roomName = room?.let(top.hicancan.studev.world.Names::room)
        val notification = NotificationCompat.Builder(context, TAG).setSmallIcon(R.drawable.ic_navigation).setContentTitle(title)
            .setContentText(roomName ?: "打开课表查看详情").setContentIntent(open).setAutoCancel(true)
        if (roomName != null) notification.addAction(R.drawable.ic_navigation, "导航到 $roomName", open)
        manager.notify(id, id.hashCode(), notification.build())
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
        DeviceRefreshWorker.enqueue(context)
    }
}
