package top.hicancan.studev.data

import android.content.Context
import androidx.work.*
import top.hicancan.studev.me.CampusSettings
import java.util.concurrent.TimeUnit

/** A best-effort version check. Immutable downloaded shards stay offline indefinitely. */
class DataRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        AcademicRepository.discover(applicationContext, CampusSettings(applicationContext).state.value.klass)
        return Result.success()
    }
    companion object {
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("campus-data-update", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<DataRefreshWorker>(12, TimeUnit.HOURS)
                    .setInitialDelay(12, TimeUnit.HOURS)
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build())
                    .build())
        }
    }
}
