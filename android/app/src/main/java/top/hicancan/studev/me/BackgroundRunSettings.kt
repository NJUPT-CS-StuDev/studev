package top.hicancan.studev.me

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat

data class BackgroundRunStatus(
    val manufacturer: String,
    val batteryExempt: Boolean,
    val notificationsEnabled: Boolean,
    val exactAlarms: Boolean,
)

/** One OEM-neutral entry point for the background execution guidance screen. */
object BackgroundRunSettings {
    fun status(context: Context): BackgroundRunStatus {
        val power = context.getSystemService(PowerManager::class.java)
        val alarms = context.getSystemService(AlarmManager::class.java)
        return BackgroundRunStatus(
            manufacturer = Build.MANUFACTURER.ifBlank { "Android" },
            batteryExempt = Build.VERSION.SDK_INT < 23 || power.isIgnoringBatteryOptimizations(context.packageName),
            notificationsEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled(),
            exactAlarms = Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms(),
        )
    }

    fun requestBatteryExemption(context: Context) {
        if (Build.VERSION.SDK_INT < 23) return
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${context.packageName}")).withTaskStack()
        runCatching { context.startActivity(intent) }.getOrElse {
            context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).withTaskStack())
        }
    }

    fun openOemStartup(context: Context) {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val component = when {
            manufacturer.contains("huawei") || manufacturer.contains("honor") ->
                ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") ->
                ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
            manufacturer.contains("oppo") ->
                ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
            manufacturer.contains("vivo") ->
                ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
            else -> null
        }
        val intent = Intent().apply { component?.let(::setComponent) }.withTaskStack()
        runCatching { context.startActivity(intent) }.getOrElse {
            context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:${context.packageName}")).withTaskStack())
        }
    }

    fun openNotifications(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel("campus-navigation", "校园导航", NotificationManager.IMPORTANCE_LOW))
            manager.createNotificationChannel(NotificationChannel("studev-reminders", "课程与考试提醒", NotificationManager.IMPORTANCE_HIGH))
        }
        val intent = if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            putExtra(Settings.EXTRA_CHANNEL_ID, "studev-reminders")
        } else Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        }
        context.startActivity(intent.withTaskStack())
    }

    private fun Intent.withTaskStack() = addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
