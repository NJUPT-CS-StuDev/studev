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
        val term = repo.term()
        val events = CampusEvents.build(term, repo.periods(), settings.klass?.takeIf { id -> repo.classes().any { it.id == id } }?.let { repo.effectiveSchedule(it, settings.timetableEdits(term.term)) }, settings.klass?.let { repo.effectiveExams(it, settings) }.orEmpty())
        val facts = top.hicancan.studev.calendar.PhoneFacts(repo.calendar(), repo.runs()[term.term])
        DeviceSchedule.update(applicationContext, events.filterNot { it.start.atZone(top.hicancan.studev.timetable.CampusDay.zone).toLocalDate() in facts.holidays && !it.exam }, settings.klass, settings, facts)
        NextLessonWidget().refreshAll(applicationContext)
        Result.success()
    } catch (e: CancellationException) { throw e } catch (_: Exception) { Result.retry() }
    companion object {
        private const val ONE_SHOT = "campus-refresh"
        private const val PERIODIC = "campus-maintenance"

        fun enqueue(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                ONE_SHOT,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<CampusRefreshWorker>().build(),
            )
            schedule(context)
        }

        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<CampusRefreshWorker>(12, TimeUnit.HOURS).build())
        }
    }
}
