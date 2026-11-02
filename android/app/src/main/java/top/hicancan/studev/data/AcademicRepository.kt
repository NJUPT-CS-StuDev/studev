package top.hicancan.studev.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import java.io.File
import java.io.FileNotFoundException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import top.hicancan.studev.BuildConfig
import java.io.IOException
import kotlin.coroutines.coroutineContext

/** One immutable release per reader. Files are fetched lazily, then kept for offline reads.
 * A remote release never falls back to a different release's shards. */
class AcademicRepository(context: Context, release: DataRelease, fetchBytes: (String) -> ByteArray = Companion::download) {
    private val context = context
    private val fetchBytes = fetchBytes
    val release = release
    private val bundled: DataRelease by lazy { Json.decodeFromString(context.assets.open("data/release.json").bufferedReader().use { it.readText() }) }
    private val root = File(context.filesDir, "campus/${release.version}")
    suspend fun bytes(path: String): ByteArray = withContext(Dispatchers.IO) {
        require(path.isNotBlank() && !path.startsWith('/') && path.none { it in "\\:%?#" } && path.split('/').none { it == ".." || it == "." || it.isEmpty() })
        val file = File(root, path)
        // Coalesce same-file reads across repository instances without a single
        // release-wide lock blocking all unrelated data behind one download.
        val lock = locks[(file.absolutePath.hashCode() and Int.MAX_VALUE) % locks.size]
        lock.withLock {
        coroutineContext.ensureActive()
        if (file.isFile) return@withLock file.readBytes()
        // The bundled release is already local. Do not wait for the network to use it.
        if (release.version == bundled.version) {
            val local = try { context.assets.open("data/$path").use { it.readBytes() } } catch (_: FileNotFoundException) { null }
            if (local != null) return@withLock local
        }
        val bytes = try { fetchBytes("${BuildConfig.DATA_HOST}${release.base}/" + path.split('/').joinToString("/") { encode(it) }) }
        catch (e: FileNotFoundException) { throw e }
        catch (e: IOException) { throw DataUnavailableException(e) }
        if (path.endsWith(".json")) Json.parseToJsonElement(bytes.decodeToString())
        file.parentFile!!.mkdirs()
        val pending = File(file.parentFile, "${file.name}.${java.util.UUID.randomUUID()}.pending")
        try {
            pending.writeBytes(bytes)
            check(pending.renameTo(file)) { "无法保存离线数据" }
        } finally { pending.delete() }
        bytes
    } }
    suspend inline fun <reified T> read(path: String): T = Json.decodeFromString(bytes(path).decodeToString())
    suspend fun term() = read<TeachingTerm>("teaching/${release.teaching}/term.json")
    suspend fun periods() = read<List<TeachingPeriod>>("teaching/${release.teaching}/periods.json")
    suspend fun classes() = read<List<TeachingClass>>("teaching/${release.teaching}/classes.json")
    suspend fun coursePlans() = read<InformationEntityFile>("entities/information.json").items
        .filter { it["subtype"]?.jsonPrimitive?.content == "information:course-plan" }
        .map { Json.decodeFromJsonElement<CoursePlan>(it) }
    suspend fun teachingClasses() = read<AgentEntityFile>("entities/agent.json").items.filter { it.subtype == "agent:teaching-class" }
    private fun enrichMeetings(meetings: List<TeachingMeeting>, groups: Map<String, AgentEntity>): List<TeachingMeeting> =
        meetings.map { meeting ->
            groups[meeting.teaching_class.id]?.let { group ->
                meeting.copy(teaching_class = TeachingGroup(group.id, group.names.firstOrNull(), group.size, group.enrolled, group.capacity))
            } ?: meeting
        }
    suspend fun meetings(): List<TeachingMeeting> {
        val groups = teachingClasses().associateBy { it.id }
        return enrichMeetings(read<List<TeachingMeeting>>("teaching/${release.teaching}/meetings.json"), groups)
    }
    suspend fun catalog(): List<top.hicancan.studev.timetable.CatalogCourse> =
        top.hicancan.studev.timetable.CourseCatalog.groupCatalog(meetings(), coursePlans())
    suspend fun schedule(id: String): ClassSchedule {
        val groups = teachingClasses().associateBy { it.id }
        return read<ClassSchedule>("teaching/${release.teaching}/classes/$id.json").let { schedule ->
            schedule.copy(meetings = enrichMeetings(schedule.meetings, groups))
        }
    }
    suspend fun effectiveSchedule(id: String, edits: top.hicancan.studev.me.TimetableEdits): ClassSchedule {
        val base = schedule(id)
        if (edits.hidden.isEmpty() && edits.added.isEmpty()) return base
        val catalog = if (edits.added.isNotEmpty()) catalog() else emptyList()
        return base.copy(meetings = top.hicancan.studev.timetable.CourseCatalog.effectiveMeetings(base.meetings, catalog, edits))
    }
    suspend fun examIndex() = release.exams?.let { read<ExamIndex>("exams/$it/index.json") }
    suspend fun exams(id: String): List<Exam> {
        val term = release.exams ?: return emptyList()
        if (examIndex()?.classes?.contains(id) != true) return emptyList()
        return read<ClassExams>("exams/$term/classes/$id.json").exams
    }
    suspend fun examCandidates(id: String, edits: top.hicancan.studev.me.TimetableEdits, availableCatalog: List<top.hicancan.studev.timetable.CatalogCourse>? = null): List<Exam> {
        val published = exams(id).toMutableList()
        if (release.exams != release.teaching || edits.added.isEmpty()) return published
        val added = (availableCatalog ?: catalog()).filter { top.hicancan.studev.timetable.CourseCatalog.catalogId(it) in edits.added }
        val seen = published.mapTo(mutableSetOf()) { "${it.course.code}|${it.date}|${it.start}" }
        for (course in added) {
            val code = course.meetings.firstOrNull()?.course?.code ?: continue
            for (other in course.meetings.flatMap { it.classes }.distinct()) {
                for (exam in exams(other).filter { it.course.code == code }) {
                    if (seen.add("${exam.course.code}|${exam.date}|${exam.start}")) published += exam
                }
            }
        }
        return published
    }
    suspend fun effectiveExams(id: String, settings: top.hicancan.studev.me.PersonalSettings): List<Exam> {
        val edits = settings.timetableEdits(release.teaching)
        val schedule = if (release.exams == release.teaching && classes().any { it.id == id }) effectiveSchedule(id, edits) else null
        return top.hicancan.studev.exams.ExamAttendance.select(examCandidates(id, edits), settings.examChoices(release.exams, id),
            top.hicancan.studev.exams.ExamAttendance.ownCodes(release, schedule))
    }
    suspend fun rooms() = read<RoomIndex>("rooms/index.json")
    suspend fun roomDay(term: String, date: String): RoomDay? = try { read<RoomDay>("rooms/$term/$date.json") } catch (_: FileNotFoundException) { null }
    companion object {
        private val locks = Array(64) { Mutex() }
        private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        fun download(address: String): ByteArray {
            val url = URI(address).toURL()
            require(url.protocol == "https" || (BuildConfig.DEBUG && url.protocol == "http" && address.startsWith(BuildConfig.DATA_HOST + "/")))
            val connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 8_000; connection.readTimeout = 15_000
            connection.setRequestProperty("User-Agent", "studev-android")
            try {
                if (connection.responseCode == 404) throw FileNotFoundException(address)
                if (connection.responseCode !in 200..299) throw IOException("数据请求失败：${connection.responseCode}")
                return connection.inputStream.use { it.readBytes() }
            } finally { connection.disconnect() }
        }
        suspend fun open(context: Context): AcademicRepository = withContext(Dispatchers.IO) {
            DataRefreshWorker.schedule(context)
            val saved = File(context.filesDir, "campus/release.json")
            val release = runCatching { Json.decodeFromString<DataRelease>(saved.readText()).takeIf(::validRelease) }.getOrNull() ?: run {
                Json.decodeFromString(context.assets.open("data/release.json").bufferedReader().use { it.readText() })
            }
            require(validRelease(release))
            AcademicRepository(context.applicationContext, release)
        }
        suspend fun bundled(context: Context): AcademicRepository = withContext(Dispatchers.IO) {
            AcademicRepository(context.applicationContext, Json.decodeFromString(context.assets.open("data/release.json").bufferedReader().use { it.readText() }))
        }
        /** The same stable release manifest used by the website's offline worker. */
        suspend fun discover(context: Context, klass: String? = null): AcademicRepository? = withContext(Dispatchers.IO) {
            try {
                val release = releaseFromManifest(download("${BuildConfig.DATA_HOST}/pwa-release.json").decodeToString()) ?: return@withContext null
                activate(context, release, klass)
            } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
        }
        private fun validRelease(release: DataRelease) = Regex("[A-Za-z0-9._-]+").matches(release.version) && release.base == "/data/${release.version}"
        private suspend fun activate(context: Context, release: DataRelease, klass: String?): AcademicRepository {
            require(validRelease(release))
            val repository = AcademicRepository(context.applicationContext, release)
            val term = repository.term()
            repository.periods(); val classes = repository.classes(); repository.rooms(); repository.examIndex()
            repository.coursePlans(); repository.teachingClasses()
            if (klass != null) {
                if (classes.any { it.id == klass }) {
                    repository.schedule(klass)
                    val edits = top.hicancan.studev.me.CampusSettings(context).state.value.timetableEdits(term.term)
                    if (edits.added.isNotEmpty()) repository.catalog()
                }
                repository.exams(klass)
            }
            val index = File(context.filesDir, "campus/release.json")
            index.parentFile!!.mkdirs()
            val pending = File(index.parentFile, "release.${java.util.UUID.randomUUID()}.pending")
            try {
                pending.writeText(Json.encodeToString(release))
                check(pending.renameTo(index))
            } finally { pending.delete() }
            top.hicancan.studev.widget.WidgetRefreshWorker.refresh(context)
            return repository
        }
        internal fun releaseFromManifest(text: String): DataRelease? = runCatching {
            Json { ignoreUnknownKeys = true }.decodeFromString<DataRelease>(text).takeIf(::validRelease)
        }.getOrNull()
    }
}
