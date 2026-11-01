package top.hicancan.studev.campus

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import top.hicancan.studev.data.*
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.me.TimetableEdits
import top.hicancan.studev.reminders.*
import top.hicancan.studev.timetable.*
import top.hicancan.studev.widget.NextLessonWidget
import top.hicancan.studev.search.AcademicSearch
import top.hicancan.studev.search.CampusSearch

data class AcademicState(val repository: AcademicRepository? = null, val term: TeachingTerm? = null, val periods: List<TeachingPeriod> = emptyList(),
    val classes: List<TeachingClass> = emptyList(), val coursePlans: List<CoursePlan> = emptyList(), val examClasses: List<String> = emptyList(),
    val rawSchedule: ClassSchedule? = null, val schedule: ClassSchedule? = null, val catalog: List<CatalogCourse> = emptyList(),
    val catalogBusy: Boolean = false, val catalogError: String? = null,
    val exams: List<Exam> = emptyList(), val rooms: RoomIndex? = null, val busy: Boolean = true, val classBusy: Boolean = false,
    val error: String? = null, val events: List<CampusEvent> = emptyList())
class CampusModel(application: Application) : AndroidViewModel(application) {
    val settings = CampusSettings(application)
    private val _state = MutableStateFlow(AcademicState())
    val state = _state.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice = _notice.asStateFlow()
    private var loading: Job? = null
    private var phone: Job? = null
    private var search: AcademicSearch? = null
    private val placeSearch = CampusSearch(application.assets)
    private var campus: CampusPackage? = null
    suspend fun places(query: String): List<Place> {
        val loaded = campus ?: CampusPackage.load(getApplication<Application>().assets).also { campus = it }
        return placeSearch.search(query, loaded)
    }
    private var searchVersion: String? = null
    fun search(repository: AcademicRepository): AcademicSearch {
        if (search == null || searchVersion != repository.release.version) {
            search?.close(); search = AcademicSearch(repository); searchVersion = repository.release.version
        }
        return checkNotNull(search)
    }
    override fun onCleared() { search?.close(); placeSearch.close() }
    init {
        CampusRefreshWorker.schedule(application)
        load()
    }
    fun clearNotice() { _notice.value = null }
    fun tell(message: String) { _notice.value = message }
    fun load() {
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
        val term = repo.term(); val periods = repo.periods(); val classes = repo.classes(); val coursePlans = runCatching { repo.coursePlans() }.getOrDefault(emptyList()); val rooms = repo.rooms()
        val examClasses = repo.examIndex()?.classes.orEmpty()
        _state.value = AcademicState(repo, term, periods, classes, coursePlans, examClasses, rooms = rooms, busy = false)
        loadClass(settings.state.value.klass)
    }
    fun chooseClass(id: String) {
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
                runCatching { repo.catalog() }.getOrDefault(emptyList())
            } else current.catalog
            val schedule = rawSchedule?.let { raw ->
                raw.copy(meetings = CourseCatalog.effectiveMeetings(raw.meetings, catalog, edits))
            }
            val exams = id?.let { repo.exams(it) }.orEmpty()
            _state.update { it.copy(rawSchedule = rawSchedule, schedule = schedule, catalog = catalog, exams = exams, classBusy = false,
                events = CampusEvents.build(checkNotNull(it.term), it.periods, schedule, exams)) }
            syncPhone()
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { _state.update { it.copy(classBusy = false, error = if (e is DataUnavailableException) e.message else "班级数据暂时无法打开，请重试") } }
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
                    val edits = stateNow.term?.let { settings.state.value.timetableEdits(it.term) } ?: TimetableEdits()
                    val schedule = stateNow.rawSchedule?.let { raw ->
                        raw.copy(meetings = CourseCatalog.effectiveMeetings(raw.meetings, catalog, edits))
                    }
                    stateNow.copy(
                        catalog = catalog,
                        catalogBusy = false,
                        schedule = schedule,
                        events = if (stateNow.term != null) CampusEvents.build(stateNow.term, stateNow.periods, schedule, stateNow.exams) else stateNow.events,
                    )
                }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { _state.update { it.copy(catalogBusy = false, catalogError = "全校课程目录暂时无法加载，请重试") } }
        }
    }
    private fun applyTimetableChange(change: (TimetableEdits) -> TimetableEdits) {
        val term = state.value.term?.term ?: return
        settings.updateTimetable(term, change)
        viewModelScope.launch {
            val current = state.value
            val edits = settings.state.value.timetableEdits(term)
            val catalog = if (edits.added.isNotEmpty() && current.catalog.isEmpty()) {
                current.repository?.let { runCatching { it.catalog() }.getOrDefault(emptyList()) }.orEmpty()
            } else current.catalog
            _state.update { stateNow ->
                val schedule = stateNow.rawSchedule?.let { raw ->
                    raw.copy(meetings = CourseCatalog.effectiveMeetings(raw.meetings, catalog, edits))
                }
                stateNow.copy(
                    catalog = catalog,
                    schedule = schedule,
                    events = if (stateNow.term != null) CampusEvents.build(stateNow.term, stateNow.periods, schedule, stateNow.exams) else stateNow.events,
                )
            }
            syncPhone()
        }
    }
    fun hideCourse(id: String) = applyTimetableChange { it.copy(hidden = it.hidden + id) }
    fun showCourse(id: String) = applyTimetableChange { it.copy(hidden = it.hidden.filterNot { item -> item == id }) }
    fun addCourse(course: CatalogCourse) = applyTimetableChange { it.copy(added = it.added + CourseCatalog.catalogId(course)) }
    fun removeAddedCourse(id: String) = applyTimetableChange { it.copy(added = it.added.filterNot { item -> item == id }) }
    fun resetTimetableEdits() = applyTimetableChange { TimetableEdits() }
    fun refresh() { viewModelScope.launch {
        tell("正在检查校园数据")
        val repo = AcademicRepository.discover(getApplication(), settings.state.value.klass)
        if (repo == null) tell("暂未发现新数据，离线数据仍可使用")
        else try { loadRepository(repo); tell("校园数据已更新") } catch (_: Exception) { tell("新数据暂时无法读取，请稍后重试") }
    } }
    fun syncPhone() {
        if (state.value.classBusy || state.value.busy) return
        phone?.cancel()
        phone = viewModelScope.launch {
            val expectedClass = settings.state.value.klass
            try {
                DeviceSchedule.update(getApplication(), state.value.events, expectedClass)?.let { tell("已同步 $it 项课程与考试") }
                NextLessonWidget().refreshAll(getApplication())
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { tell("同步未完成，请检查权限后重试") }
        }
    }
    fun calendar(enabled: Boolean) {
        if (enabled) { settings.update { it.copy(calendar = true) }; syncPhone() }
        else {
            phone?.cancel()
            settings.update { it.copy(calendar = false) }
            viewModelScope.launch {
                try { DeviceSchedule.removeCalendar(getApplication()); tell("已移除 studev 日历") }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { settings.update { it.copy(calendar = true) }; tell("请允许访问日历后，再关闭同步并移除日历") }
            }
        }
    }
}
