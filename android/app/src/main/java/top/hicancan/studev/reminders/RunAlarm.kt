package top.hicancan.studev.reminders

import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import top.hicancan.studev.MainActivity
import top.hicancan.studev.R
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.timetable.CampusDay
import top.hicancan.studev.world.*
import java.time.Instant
import java.time.LocalDate

/** A real alarm for 早锻炼 mornings: it rings only on run days and stops once the count is reached. */
object RunAlarm {
    private const val CHANNEL = "studev-run-alarm"
    const val LEAD_MINUTES = 30
    private fun pending(context: Context) = PendingIntent.getBroadcast(context, 7, Intent(context, RunAlarmReceiver::class.java).setAction("studev.run-alarm"),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun next(rule: MorningRun, holidays: Map<LocalDate, String>, done: Int, now: Instant): Instant? {
        if (done >= rule.required) return null
        var date = now.atZone(CampusDay.zone).toLocalDate()
        val last = LocalDate.parse(rule.end)
        while (date <= last) {
            if (CampusLine.isRunDay(rule, holidays, date)) {
                val at = date.atStartOfDay(CampusDay.zone).plusMinutes((clock(rule.time[0]) - LEAD_MINUTES).toLong()).toInstant()
                if (at > now) return at
            }
            date = date.plusDays(1)
        }
        return null
    }
    fun schedule(context: Context, rule: MorningRun?, holidays: Map<LocalDate, String>, settings: PersonalSettings) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        alarms.cancel(pending(context))
        if (!settings.runAlarm || rule == null) return
        val at = next(rule, holidays, settings.runDone, Instant.now()) ?: return
        val show = PendingIntent.getActivity(context, 8, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // setAlarmClock is the one that still fires on time under Doze and aggressive vendor power saving.
        alarms.setAlarmClock(AlarmManager.AlarmClockInfo(at.toEpochMilli(), show), pending(context))
    }
    fun ring(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "早锻炼闹钟", NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null); enableVibration(false) })
        val screen = PendingIntent.getActivity(context, 9, Intent(context, RunAlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(CHANNEL.hashCode(), NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_navigation)
            .setContentTitle("早锻炼 · 该起床了").setContentText("30 分钟后开始").setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX).setOngoing(true).setContentIntent(screen).setFullScreenIntent(screen, true).build())
        runCatching { context.startActivity(Intent(context, RunAlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
    fun dismiss(context: Context) { context.getSystemService(NotificationManager::class.java).cancel(CHANNEL.hashCode()) }
}

class RunAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        RunAlarm.ring(context)
        // The next morning is scheduled by the same worker that restores everything else.
        CampusRefreshWorker.enqueue(context)
    }
}

/** Shows over the lock screen, the way an alarm clock does. */
class RunAlarmActivity : Activity() {
    private var tone: Ringtone? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else @Suppress("DEPRECATION") window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val settings = CampusSettings(this)
        val pad = (24 * resources.displayMetrics.density).toInt()
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(pad, pad, pad, pad)
            addView(TextView(context).apply { text = "早锻炼"; textSize = 34f; gravity = Gravity.CENTER })
            addView(TextView(context).apply { text = "06:35 开始 · 已跑 ${settings.state.value.runDone} 次"; textSize = 16f; gravity = Gravity.CENTER; setPadding(0, pad / 2, 0, pad) })
            addView(Button(context).apply { text = "知道了"; setOnClickListener { finish() } })
        })
        tone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))?.apply {
            audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            if (Build.VERSION.SDK_INT >= 28) isLooping = true
            play()
        }
    }
    override fun onDestroy() { tone?.stop(); RunAlarm.dismiss(this); super.onDestroy() }
}
