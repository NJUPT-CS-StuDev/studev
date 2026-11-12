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
    /** One byte range of an immutable file, kept on disk so a query works offline next time. */
    suspend fun block(path: String, mirror: String?, offset: Long, length: Int): ByteArray = withContext(Dispatchers.IO) {
        val file = File(root, "$path.$offset")
        if (file.isFile) return@withContext file.readBytes()
        val address = "${BuildConfig.DATA_HOST}${release.base}/" + path.split('/').joinToString("/") { encode(it) }
        val bytes = try { mirror?.let { runCatching { download(it, offset, length) }.getOrNull() } ?: download(address, offset, length) } catch (e: IOException) { throw DataUnavailableException(e) }
        file.parentFile!!.mkdirs()
        val pending = File(file.parentFile, "${file.name}.${java.util.UUID.randomUUID()}.pending")
        try { pending.writeBytes(bytes); pending.renameTo(file) } finally { pending.delete() }
        bytes
    }
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
    suspend fun allExams(): List<Exam> = release.exams?.let { read<List<Exam>>("exams/$it/exams.json") }.orEmpty()
    suspend fun examIndex() = release.exams?.let { read<ExamIndex>("exams/$it/index.json") }
    suspend fun exams(id: String): List<Exam> {
        val term = release.exams ?: return emptyList()
        if (examIndex()?.classes?.contains(id) != true) return emptyList()
        return read<ClassExams>("exams/$term/classes/$id.json").exams
    }
    suspend fun allLabs(): List<Lab> = release.labs?.let { read<List<Lab>>("labs/$it/labs.json") }.orEmpty()
    suspend fun labIndex() = release.labs?.let { read<LabIndex>("labs/$it/index.json") }
    /** A class's lab sittings; a class with none has no file. */
    suspend fun labs(id: String): List<Lab> {
        val term = release.labs ?: return emptyList()
        if (labIndex()?.classes?.contains(id) != true) return emptyList()
        return read<ClassLabs>("labs/$term/classes/$id.json").labs
    }
    /**
     * The labs of a class as one person takes it: `raw` is the class's timetable, `effective` theirs. Labs are an extra
     * layer from outside the teaching office: when their files cannot be fetched, the timetable stands without them.
     */
    suspend fun personalLabs(id: String, raw: ClassSchedule, effective: ClassSchedule): List<Lab> = try { labsOf(id, raw, effective) } catch (_: DataUnavailableException) { emptyList() }
    private suspend fun labsOf(id: String, raw: ClassSchedule, effective: ClassSchedule): List<Lab> {
        val own = raw.meetings.mapTo(mutableSetOf()) { it.id }
        val (kept, added) = effective.meetings.partition { it.id in own }
        return top.hicancan.studev.timetable.CourseCatalog.effectiveLabs(labs(id), raw.meetings, kept, added, if (added.isEmpty()) emptyList() else allLabs())
    }
    suspend fun examRecord(id: String): ExamRecord {
        val index = examIndex() ?: return ExamRecord(emptyList(), emptyList(), null)
        if (id !in index.classes) return ExamRecord(emptyList(), index.sources, index.checked)
        return ExamRecord(read<ClassExams>("exams/${release.exams}/classes/$id.json").changes, index.sources, index.checked)
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
    /** The person's lessons and exams along time. */
    suspend fun line(settings: top.hicancan.studev.me.PersonalSettings): top.hicancan.studev.world.CampusLine {
        val term = term()
        val klass = settings.klass
        val schedule = klass?.takeIf { id -> classes().any { it.id == id } }?.let { effectiveSchedule(it, settings.timetableEdits(term.term)) }
        val exams = klass?.let { effectiveExams(it, settings) }.orEmpty()
        val labs = if (klass != null && schedule != null) top.hicancan.studev.timetable.CourseCatalog.attendingLabs(personalLabs(klass, schedule(klass), schedule), settings.labs) else emptyList()
        return top.hicancan.studev.world.CampusLine(term, periods(), schedule?.meetings.orEmpty(), labs, exams, top.hicancan.studev.world.CampusLine.holidays(calendar()), null)
    }
    suspend fun effectiveExams(id: String, settings: top.hicancan.studev.me.PersonalSettings): List<Exam> {
        val edits = settings.timetableEdits(release.teaching)
        val schedule = if (release.exams == release.teaching && classes().any { it.id == id }) effectiveSchedule(id, edits) else null
        return top.hicancan.studev.timetable.ExamAttendance.select(examCandidates(id, edits), settings.examChoices(release.exams, id),
            top.hicancan.studev.timetable.ExamAttendance.ownCodes(release, schedule))
    }
    private val lenient = Json { ignoreUnknownKeys = true }
    suspend fun calendar() = lenient.decodeFromString<top.hicancan.studev.world.CalendarFile>(bytes("calendar.json").decodeToString()).terms
    suspend fun runs() = lenient.decodeFromString<Map<String, top.hicancan.studev.world.MorningRun>>(bytes("morning-run.json").decodeToString())
    suspend fun rooms() = read<RoomIndex>("rooms/index.json")
    suspend fun roomDay(term: String, date: String): RoomDay? = try { read<RoomDay>("rooms/$term/$date.json") } catch (_: FileNotFoundException) { null }
    companion object {
        private val locks = Array(64) { Mutex() }
        private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        fun download(address: String, offset: Long? = null, length: Int = 0): ByteArray {
            val url = URI(address).toURL()
            require(url.protocol == "https" || (BuildConfig.DEBUG && url.protocol == "http" && address.startsWith(BuildConfig.DATA_HOST + "/")))
            val connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = 8_000; connection.readTimeout = 15_000
            connection.setRequestProperty("User-Agent", "studev-android")
            if (offset != null) connection.setRequestProperty("Range", "bytes=$offset-${offset + length - 1}")
            try {
                if (connection.responseCode == 404) throw FileNotFoundException(address)
                if (connection.responseCode !in 200..299) throw IOException("数据请求失败：${connection.responseCode}")
                val body = connection.inputStream.use { it.readBytes() }
                return if (offset == null || connection.responseCode == 206) body else body.copyOfRange(offset.toInt(), offset.toInt() + length)
            } finally { connection.disconnect() }
        }
        suspend fun open(context: Context): AcademicRepository = withContext(Dispatchers.IO) {
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
        /**
         * The same stable release manifest used by the website's offline worker. Null when the website cannot be
         * reached. Data that is published but cannot be decoded is reported, not skipped: it means this app is behind.
         */
        suspend fun discover(context: Context, klass: String? = null): Discovery? = withContext(Dispatchers.IO) {
            val text = try { download("${BuildConfig.DATA_HOST}/pwa-release.json").decodeToString() } catch (e: CancellationException) { throw e } catch (_: IOException) { return@withContext null }
            // A manifest this app cannot read says nothing it can act on: the data it has stays in use.
            val app = try { appInManifest(text) } catch (_: kotlinx.serialization.SerializationException) { return@withContext null } catch (_: IllegalArgumentException) { return@withContext null }
            try {
                val release = releaseFromManifest(text) ?: return@withContext Discovery(app, null, unreadable = true)
                Discovery(app, activate(context, release, klass), unreadable = false)
            } catch (e: CancellationException) { throw e }
            catch (_: kotlinx.serialization.SerializationException) { Discovery(app, null, unreadable = true) }
            catch (_: IllegalArgumentException) { Discovery(app, null, unreadable = true) }
            catch (_: IOException) { Discovery(app, null, unreadable = false) }
        }
        private fun validRelease(release: DataRelease) = Regex("[A-Za-z0-9._-]+").matches(release.version) && release.base == "/data/${release.version}"
        private suspend fun activate(context: Context, release: DataRelease, klass: String?): AcademicRepository {
            require(validRelease(release))
            val repository = AcademicRepository(context.applicationContext, release)
            val term = repository.term()
            repository.periods(); val classes = repository.classes(); repository.rooms(); repository.examIndex(); repository.labIndex()
            repository.coursePlans(); repository.teachingClasses()
            if (klass != null) {
                if (classes.any { it.id == klass }) {
                    repository.schedule(klass)
                    val edits = top.hicancan.studev.me.CampusSettings(context).state.value.timetableEdits(term.term)
                    if (edits.added.isNotEmpty()) repository.catalog()
                }
                repository.exams(klass)
                repository.labs(klass)
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

/** Missing downloads never erase the bundled map or another release's cache. */
class DataUnavailableException(cause: Exception) : IOException(
    "这份数据尚未下载，或新版本还未发布。校园地图可离线使用，请联网后重试。"
) {
    init { initCause(cause) }
}
