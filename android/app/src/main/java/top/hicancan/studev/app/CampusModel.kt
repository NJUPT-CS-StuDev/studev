package top.hicancan.studev.app

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
import top.hicancan.studev.device.*
import top.hicancan.studev.timetable.*
import top.hicancan.studev.widget.CampusWidget
import top.hicancan.studev.world.*
import top.hicancan.studev.timetable.ExamAttendance
import top.hicancan.studev.device.PhoneFacts

data class AcademicState(val repository: AcademicRepository? = null, val term: TeachingTerm? = null, val periods: List<TeachingPeriod> = emptyList(),
    val classes: List<TeachingClass> = emptyList(), val coursePlans: List<CoursePlan> = emptyList(), val examClasses: List<String> = emptyList(),
    val rawSchedule: ClassSchedule? = null, val schedule: ClassSchedule? = null, val catalog: List<CatalogCourse> = emptyList(),
    val catalogBusy: Boolean = false, val catalogError: String? = null,
    /** The person's labs: their class's, as their own timetable takes them. */
    val labs: List<Lab> = emptyList(),
    val exams: List<Exam> = emptyList(), val rooms: RoomIndex? = null, val busy: Boolean = true, val classBusy: Boolean = false,
    val error: String? = null,
    val calendar: List<CalendarTerm> = emptyList(), val run: MorningRun? = null,
    /** The newest app the website offers, and whether this one can no longer read its data. */
    val app: AppRelease? = null, val appRequired: Boolean = false) {
    val appBehind get() = app != null && app.versionCode > top.hicancan.studev.BuildConfig.VERSION_CODE
    val holidays by lazy { CampusLine.holidays(calendar) }
}
class CampusModel(application: Application) : AndroidViewModel(application) {
    val settings = CampusSettings(application)
    /** One's own tasks, on this device. */
    val tasks = top.hicancan.studev.me.TaskStore(application)
    private val _state = MutableStateFlow(AcademicState())
    val state = _state.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice = _notice.asStateFlow()
    private var loading: Job? = null
    private var phone: Job? = null
    private var editing: Job? = null
    init {
        DeviceRefreshWorker.schedule(application)
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
                // The packaged release stays immediately usable while the website is checked.
                AcademicRepository.discover(getApplication(), settings.state.value.klass)?.let { found -> take(found) }
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
        _state.update { it.copy(rawSchedule = null, schedule = null, labs = emptyList(), exams = emptyList(), error = null, classBusy = true) }
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
                now.copy(rawSchedule = rawSchedule, schedule = effective, catalog = availableCatalog, exams = exams, classBusy = false)
            }
            loadLabs(repo, id)
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
                )
            }
            loadLabs(repo, klass)
            syncPhone()
          } catch (e: CancellationException) { throw e }
          catch (_: Exception) { tell("课程目录尚未下载，修改已保存；请联网打开课表后重试。现有日历和提醒保持不变。") }
        }
    }
    /** The labs follow the timetable just settled: whatever was taken off or added decides them. */
    private suspend fun loadLabs(repo: AcademicRepository, klass: String?) {
        val (raw, effective) = state.value.let { it.rawSchedule to it.schedule }
        val labs = if (klass != null && raw != null && effective != null) repo.personalLabs(klass, raw, effective) else emptyList()
        _state.update { now -> if (now.repository === repo && settings.state.value.klass == klass && now.schedule === effective) now.copy(labs = labs) else now }
    }
    fun addTeachingClass(id: String) = applyTimetableChange { it.copy(added = (it.added + id).distinct()) }
    fun removeCourse(id: String) = applyTimetableChange { edits ->
        when {
            Courses.isCustom(id) -> edits.copy(custom = edits.custom.filter { "custom:${it.id}" != id })
            id in edits.added -> edits.copy(added = edits.added - id)
            else -> edits.copy(hidden = edits.hidden + id)
        }
    }
    /** A name of one's own for a course, or back to its own name when `name` is blank. */
    fun renameCourse(identity: String, name: String) = applyTimetableChange { edits ->
        edits.copy(names = if (name.isBlank()) edits.names - identity else edits.names + (identity to name.trim().take(60)))
    }
    fun saveCustomCourse(course: CustomCourse) = applyTimetableChange { edits -> edits.copy(custom = edits.custom.filter { it.id != course.id } + course) }
    /** Undoes what was changed about the class's timetable; one's own courses stay, since they are deleted one by one. */
    fun resetTimetableEdits() = applyTimetableChange { TimetableEdits(custom = it.custom) }
    private fun personalExams(repo: AcademicRepository, schedule: ClassSchedule?, exams: List<Exam>) =
        ExamAttendance.select(exams, settings.state.value.examChoices(repo.release.exams, settings.state.value.klass), ExamAttendance.ownCodes(repo.release, schedule))
    fun examAttendance(id: String, attending: Boolean) {
        val current = state.value
        val repo = current.repository ?: return
        val klass = settings.state.value.klass ?: return
        val term = repo.release.exams ?: return
        settings.updateExamAttendance(term, klass, mapOf(id to attending))
        syncPhone()
    }
    /** The visitor's own timeline, the same line the web draws. */
    fun myLine(state: AcademicState, settings: PersonalSettings, tasks: List<top.hicancan.studev.world.Task> = top.hicancan.studev.me.TaskStore.live(this.tasks.all.value)): CampusLine? {
        val term = state.term ?: return null
        val repo = state.repository ?: return null
        val grade = CampusLine.grade(state.classes.find { it.id == settings.klass }?.grade, term)
        val runShown = settings.runShown ?: (grade != null && grade <= 2)
        return Courses.named(CampusLine(term, state.periods, state.schedule?.meetings.orEmpty(), CourseCatalog.attendingLabs(state.labs, settings.labs), personalExams(repo, state.schedule, state.exams), state.holidays,
            state.run?.takeIf { runShown }?.let { RunPlan(it, settings.runDays, settings.runAdjust) }, tasks), settings.timetableEdits(term.term).names)
    }
    private var allMeetings: Deferred<List<TeachingMeeting>>? = null
    /** Every meeting of the term, for viewing a teacher, a course or a room. */
    suspend fun meetings(): List<TeachingMeeting> {
        val repo = state.value.repository ?: return emptyList()
        val loading = allMeetings ?: viewModelScope.async { repo.meetings() }.also { allMeetings = it }
        return try { loading.await() } catch (e: CancellationException) { throw e } catch (e: Exception) { allMeetings = null; throw e }
    }
    fun setRun(change: (PersonalSettings) -> PersonalSettings) { settings.update(change); syncPhone() }
    /** Takes what a check found: the newer app, and the newer data when this app can read it. */
    private suspend fun take(found: Discovery): Boolean {
        _state.update { it.copy(app = found.app, appRequired = found.unreadable && found.appBehind) }
        val repo = found.repository ?: return false
        if (repo.release.version == state.value.repository?.release?.version) return false
        loadRepository(repo)
        return true
    }
    fun refresh() { viewModelScope.launch {
        tell("正在检查更新")
        val found = AcademicRepository.discover(getApplication(), settings.state.value.klass)
        if (found == null) { tell("暂时连不上，离线数据仍可使用"); return@launch }
        val fresh = try { take(found) } catch (e: CancellationException) { throw e } catch (_: Exception) { tell("新数据暂时无法读取，请稍后重试"); return@launch }
        tell(when {
            found.appBehind -> "有新版本 ${found.app.versionName}" + if (fresh) "，校园数据已更新" else ""
            fresh -> "校园数据已更新"
            else -> "App 和校园数据都是最新的"
        })
    } }
    fun syncPhone() {
        if (state.value.classBusy || state.value.busy) return
        phone?.cancel()
        phone = viewModelScope.launch {
            val expectedSettings = settings.state.value
            try {
                DeviceSchedule.update(getApplication(), myLine(state.value, expectedSettings)?.lessonsAndExams().orEmpty(), expectedSettings.klass, expectedSettings, PhoneFacts(state.value.calendar, state.value.run))?.let { tell("已同步到手机日历") }
                CampusWidget.refreshAll(getApplication())
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { tell("同步未完成，请检查权限后重试") }
        }
    }
    fun calendar(enabled: Boolean) {
        settings.update { it.copy(calendar = enabled) }; syncPhone()
    }
}
