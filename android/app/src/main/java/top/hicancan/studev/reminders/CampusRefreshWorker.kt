package top.hicancan.studev.reminders

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.*
import kotlinx.coroutines.CancellationException
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.timetable.CampusEvents
import top.hicancan.studev.widget.NextLessonWidget
import java.util.concurrent.TimeUnit

class CampusRefreshWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = try {
        val settings = CampusSettings(applicationContext).state.value
        val repo = AcademicRepository.open(applicationContext)
        val events = CampusEvents.build(repo.term(), repo.periods(), settings.klass?.let { repo.schedule(it) }, settings.klass?.let { repo.exams(it) }.orEmpty())
        DeviceSchedule.update(applicationContext, events, settings.klass)
        NextLessonWidget().updateAll(applicationContext)
        Result.success()
    } catch (e: CancellationException) { throw e } catch (_: Exception) { Result.retry() }
    companion object {
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("campus-maintenance", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<CampusRefreshWorker>(12, TimeUnit.HOURS).build())
        }
    }
}
