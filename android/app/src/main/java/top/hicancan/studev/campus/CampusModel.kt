package top.hicancan.studev.campus

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import top.hicancan.studev.data.*
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.me.TimetableEdits
import top.hicancan.studev.reminders.*
import top.hicancan.studev.timetable.*
import top.hicancan.studev.widget.NextLessonWidget
import top.hicancan.studev.world.*
import top.hicancan.studev.exams.ExamAttendance
import top.hicancan.studev.calendar.PhoneFacts

data class AcademicState(val repository: AcademicRepository? = null, val term: TeachingTerm? = null, val periods: List<TeachingPeriod> = emptyList(),
    val classes: List<TeachingClass> = emptyList(), val coursePlans: List<CoursePlan> = emptyList(), val examClasses: List<String> = emptyList(),
    val rawSchedule: ClassSchedule? = null, val schedule: ClassSchedule? = null, val catalog: List<CatalogCourse> = emptyList(),
    val catalogBusy: Boolean = false, val catalogError: String? = null,
    val exams: List<Exam> = emptyList(), val rooms: RoomIndex? = null, val busy: Boolean = true, val classBusy: Boolean = false,
    val error: String? = null, val events: List<CampusEvent> = emptyList(),
    val calendar: List<CalendarTerm> = emptyList(), val run: MorningRun? = null) {
    val holidays by lazy { CampusLine.holidays(calendar) }
}
class CampusModel(application: Application) : AndroidViewModel(application) {
    val settings = CampusSettings(application)
    private val _state = MutableStateFlow(AcademicState())
    val state = _state.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice = _notice.asStateFlow()
    private var loading: Job? = null
    private var phone: Job? = null
    private var editing: Job? = null
    init {
        CampusRefreshWorker.schedule(application)
        load()
    }
    fun clearNotice() { _notice.value = null }
    fun tell(message: String) { _notice.value = message }
    fun load() {
        editing?.cancel()
        loading?.cancel()
        loading = viewModelScope.launch {
            try {
                _state.update { it.copy(busy = true, error = null) }
                val repo = AcademicRepository.open(getApplication())
                try { loadRepository(repo) }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { loadRepository(AcademicRepository.bundled(getApplication())) }
                // Discovery is best effort; the packaged release stays immediately usable.
                val discovered = AcademicRepository.discover(getApplication(), settings.state.value.klass)
                if (discovered != null && discovered.release.version != state.value.repository?.release?.version) loadRepository(discovered)
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { _state.update { it.copy(busy = false, error = "校园数据暂时无法打开，请重试") } }
        }
    }
    private suspend fun loadRepository(repo: AcademicRepository) {
        val term = repo.term(); val periods = repo.periods(); val classes = repo.classes(); val coursePlans = repo.coursePlans(); val rooms = repo.rooms()
        val examClasses = repo.examIndex()?.classes.orEmpty()
        val calendar = repo.calendar(); val run = repo.runs()[term.term]
        _state.value = AcademicState(repo, term, periods, classes, coursePlans, examClasses, rooms = rooms, busy = false, calendar = calendar, run = run)
        loadClass(settings.state.value.klass)
    }
    fun chooseClass(id: String) {
        editing?.cancel()
        settings.update { it.copy(klass = id) }
        loading?.cancel()
        loading = viewModelScope.launch { loadClass(id) }
    }
    private suspend fun loadClass(id: String?) {
        val current = state.value
        val repo = current.repository ?: return
        _state.update { it.copy(rawSchedule = null, schedule = null, exams = emptyList(), events = emptyList(), error = null, classBusy = true) }
        try {
            val rawSchedule = if (id != null && current.classes.any { it.id == id }) repo.schedule(id) else null
            val edits = current.term?.let { settings.state.value.timetableEdits(it.term) } ?: TimetableEdits()
            val catalog = if (edits.added.isNotEmpty() && current.catalog.isEmpty()) {
                repo.catalog()
            } else current.catalog
            val exams = id?.let { repo.examCandidates(it, edits, catalog.takeIf { it.isNotEmpty() }) }.orEmpty()
            if (settings.state.value.klass != id || state.value.repository !== repo) return
            _state.update { now ->
                if (settings.state.value.klass != id || now.repository !== repo) return@update now
                // Loading a class and opening its course manager can finish in either order.
                // Never replace a catalogue that the manager has just finished loading.
                val availableCatalog = catalog.ifEmpty { now.catalog }
                val effective = rawSchedule?.copy(meetings = CourseCatalog.effectiveMeetings(rawSchedule.meetings, availableCatalog, settings.state.value.timetableEdits(checkNotNull(now.term).term)))
                now.copy(rawSchedule = rawSchedule, schedule = effective, catalog = availableCatalog, exams = exams, classBusy = false,
                    events = CampusEvents.build(checkNotNull(now.term), now.periods, effective, personalExams(repo, effective, exams), now.holidays.keys))
            }
            syncPhone()
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { _state.update { if (settings.state.value.klass == id && it.repository === repo) it.copy(classBusy = false, error = if (e is DataUnavailableException) e.message else "班级数据暂时无法打开，请重试") else it } }
    }
    fun openCourseManager() {
        val current = state.value
        if (current.catalog.isNotEmpty() || current.catalogBusy) return
        val repo = current.repository ?: return
        viewModelScope.launch {
            _state.update { it.copy(catalogBusy = true, catalogError = null) }
            try {
                val catalog = repo.catalog()
                _state.update { stateNow ->
                    if (stateNow.repository !== repo) return@update stateNow
                    val edits = stateNow.term?.let { settings.state.value.timetableEdits(it.term) } ?: TimetableEdits()
                    val schedule = stateNow.rawSchedule?.let { raw ->
                        raw.copy(meetings = CourseCatalog.effectiveMeetings(raw.meetings, catalog, edits))
                    }
                    stateNow.copy(
                        catalog = catalog,
                        catalogBusy = false,
                        schedule = schedule,
                        events = if (stateNow.term != null) CampusEvents.build(stateNow.term, stateNow.periods, schedule, personalExams(repo, schedule, stateNow.exams), stateNow.holidays.keys) else stateNow.events,
                    )
                }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { _state.update { if (it.repository === repo) it.copy(catalogBusy = false, catalogError = "全校课程目录暂时无法加载，请重试") else it } }
        }
    }
    private fun applyTimetableChange(change: (TimetableEdits) -> TimetableEdits) {
        val term = state.value.term?.term ?: return
        settings.updateTimetable(term, change)
        editing?.cancel()
        editing = viewModelScope.launch {
          try {
            val current = state.value
            val edits = settings.state.value.timetableEdits(term)
            val catalog = if (edits.added.isNotEmpty() && current.catalog.isEmpty()) {
                current.repository?.catalog() ?: return@launch
            } else current.catalog
            val repo = current.repository ?: return@launch
            val klass = settings.state.value.klass
            val exams = klass?.let { repo.examCandidates(it, edits, catalog.takeIf { it.isNotEmpty() }) }.orEmpty()
            _state.update { stateNow ->
                if (stateNow.repository !== repo || stateNow.term?.term != term || settings.state.value.klass != klass || settings.state.value.timetableEdits(term) != edits) return@update stateNow
                val schedule = stateNow.rawSchedule?.let { raw ->
                    raw.copy(meetings = CourseCatalog.effectiveMeetings(raw.meetings, catalog, edits))
                }
                stateNow.copy(
                    catalog = catalog,
                    schedule = schedule,
                    exams = exams,
                    events = if (stateNow.term != null) CampusEvents.build(stateNow.term, stateNow.periods, schedule, personalExams(repo, schedule, exams), stateNow.holidays.keys) else stateNow.events,
                )
            }
            syncPhone()
          } catch (e: CancellationException) { throw e }
          catch (_: Exception) { tell("课程目录尚未下载，修改已保存；请联网打开课表后重试。现有日历和提醒保持不变。") }
        }
    }
    fun addTeachingClass(id: String) = applyTimetableChange { it.copy(added = (it.added + id).distinct()) }
    fun removeCourse(id: String) = applyTimetableChange { if (id in it.added) it.copy(added = it.added - id) else it.copy(hidden = it.hidden + id) }
    fun resetTimetableEdits() = applyTimetableChange { TimetableEdits() }
    private fun personalExams(repo: AcademicRepository, schedule: ClassSchedule?, exams: List<Exam>) =
        ExamAttendance.select(exams, settings.state.value.examChoices(repo.release.exams, settings.state.value.klass), ExamAttendance.ownCodes(repo.release, schedule))
    fun examAttendance(id: String, attending: Boolean) {
        val current = state.value
        val repo = current.repository ?: return
        val klass = settings.state.value.klass ?: return
        val term = repo.release.exams ?: return
        settings.updateExamAttendance(term, klass, mapOf(id to attending))
        _state.update { now ->
            if (now.repository !== repo || now.term == null) now else now.copy(events = CampusEvents.build(now.term, now.periods, now.schedule, personalExams(repo, now.schedule, now.exams), now.holidays.keys))
        }
        syncPhone()
    }
    /** The visitor's own timeline, the same line the web draws. */
    fun myLine(state: AcademicState, settings: PersonalSettings): CampusLine? {
        val term = state.term ?: return null
        val repo = state.repository ?: return null
        val grade = CampusLine.grade(state.classes.find { it.id == settings.klass }?.grade, term)
        val runShown = settings.runShown ?: (grade != null && grade <= 2)
        return CampusLine(term, state.periods, state.schedule?.meetings.orEmpty(), personalExams(repo, state.schedule, state.exams), state.holidays,
            state.run?.takeIf { runShown }?.let { RunPlan(it, settings.runDays, settings.runAdjust) })
    }
    private var allMeetings: Deferred<List<TeachingMeeting>>? = null
    /** Every meeting of the term, for viewing a teacher, a course or a room. */
    suspend fun meetings(): List<TeachingMeeting> {
        val repo = state.value.repository ?: return emptyList()
        val loading = allMeetings ?: viewModelScope.async { repo.meetings() }.also { allMeetings = it }
        return try { loading.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { allMeetings = null; throw e }
    }
    fun setRun(change: (PersonalSettings) -> PersonalSettings) { settings.update(change); syncPhone() }
    fun refresh() { viewModelScope.launch {
        tell("正在检查校园数据")
        val repo = AcademicRepository.discover(getApplication(), settings.state.value.klass)
        if (repo == null) tell("暂未发现新数据，离线数据仍可使用")
        else try { loadRepository(repo); tell("校园数据已更新") } catch (e: CancellationException) { throw e } catch (_: Exception) { tell("新数据暂时无法读取，请稍后重试") }
    } }
    fun syncPhone() {
        if (state.value.classBusy || state.value.busy) return
        phone?.cancel()
        phone = viewModelScope.launch {
            val expectedSettings = settings.state.value
            try {
                DeviceSchedule.update(getApplication(), state.value.events, expectedSettings.klass, expectedSettings, PhoneFacts(state.value.calendar, state.value.run))?.let { tell("已同步到手机日历") }
                NextLessonWidget().refreshAll(getApplication())
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { tell("同步未完成，请检查权限后重试") }
        }
    }
    fun calendar(enabled: Boolean) {
        settings.update { it.copy(calendar = enabled) }; syncPhone()
    }
}
