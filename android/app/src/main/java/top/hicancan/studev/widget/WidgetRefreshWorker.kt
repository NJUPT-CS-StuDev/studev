package top.hicancan.studev.widget

import android.content.Context
import androidx.work.*
import java.time.Duration
import java.time.Instant
import java.util.concurrent.TimeUnit

/** One boundary job plus a sparse safety refresh; no GPS, polling or exact alarms. */
class WidgetRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val boundary = listOfNotNull(NextLessonWidget().refreshAll(applicationContext, false),
            CompactLessonWidget().refreshAll(applicationContext, false)).minOrNull()
        // Replacing the running boundary job is the final step, after both
        // providers have published their state.
        if (boundary != null) at(applicationContext, boundary)
        return Result.success()
    }
    companion object {
        private fun hasWidgets(context: Context) = listOf(NextLessonWidgetReceiver::class.java, CompactLessonWidgetReceiver::class.java).any {
            context.getSystemService(android.appwidget.AppWidgetManager::class.java)
                .getAppWidgetIds(android.content.ComponentName(context, it)).isNotEmpty()
        }
        fun refresh(context: Context) {
            if (!hasWidgets(context)) return
            WorkManager.getInstance(context).enqueueUniqueWork("widget-refresh", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<WidgetRefreshWorker>().build())
        }
        fun at(context: Context, instant: Instant, now: Instant = Instant.now()) {
            WorkManager.getInstance(context).enqueueUniqueWork("widget-boundary", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                    .setInitialDelay(Duration.between(now, instant).toMillis().coerceAtLeast(1000), TimeUnit.MILLISECONDS).build())
        }
        fun enable(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("widget-maintenance", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<WidgetRefreshWorker>(12, TimeUnit.HOURS).setInitialDelay(12, TimeUnit.HOURS).build())
        }
        fun disable(context: Context) {
            if (hasWidgets(context)) return
            WorkManager.getInstance(context).apply {
                cancelUniqueWork("widget-maintenance"); cancelUniqueWork("widget-boundary"); cancelUniqueWork("widget-refresh")
            }
        }
    }
}
