package top.hicancan.studev.device

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.CancellationException
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.widget.CampusWidget
import java.util.concurrent.TimeUnit

/** Looks for new campus data, then rebuilds what lives outside the app from the person's line. */
class DeviceRefreshWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = try {
        val settings = CampusSettings(applicationContext).state.value
        AcademicRepository.discover(applicationContext, settings.klass)
        val repo = AcademicRepository.open(applicationContext)
        val facts = PhoneFacts(repo.calendar(), repo.runs()[repo.term().term])
        DeviceSchedule.update(applicationContext, repo.line(settings).lessonsAndExams(), settings.klass, settings, facts)
        CampusWidget.refreshAll(applicationContext)
        Result.success()
    } catch (e: CancellationException) { throw e } catch (_: Exception) { Result.retry() }
    companion object {
        fun enqueue(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("device-refresh", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<DeviceRefreshWorker>().build())
            schedule(context)
        }
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("device-maintenance", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<DeviceRefreshWorker>(12, TimeUnit.HOURS).build())
        }
    }
}
