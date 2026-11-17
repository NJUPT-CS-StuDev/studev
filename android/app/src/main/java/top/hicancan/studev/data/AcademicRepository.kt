package top.hicancan.studev.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
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
    private val checkedRetirement = java.util.concurrent.atomic.AtomicBoolean()
    private fun missing() { if (checkedRetirement.compareAndSet(false, true)) retired.tryEmit(release) }
    private val bundled: DataRelease by lazy { Json.decodeFromString(context.assets.open("data/release.json").bufferedReader().use { it.readText() }) }
    private fun component(path: String): Pair<String, String> = when {
        path.startsWith("space/") -> release.map_base to path.removePrefix("space/")
        path.startsWith("knowledge/") -> release.knowledge_base to path.removePrefix("knowledge/")
        path.startsWith("search/") -> release.search_base to path.removePrefix("search/")
        path.startsWith("texts/") -> release.texts_base to path.removePrefix("texts/")
        else -> release.base to path
    }
    private fun address(path: String): String { val (base, relative) = component(path); return URI(BuildConfig.DATA_HOST).resolve(base).toString() + "/" + relative.split('/').joinToString("/") { encode(it) } }
    private fun local(path: String): File { val (base, relative) = component(path); return File(context.filesDir, "campus${URI(base).path}/$relative") }
    suspend fun localFile(path: String): File { bytes(path); return local(path) }
    suspend fun mapAssets(): String {
        if (URI(release.map_base).path == URI(bundled.map_base).path) return StyleTokens.ASSETS
        val prefix = URI(release.map_base).path + "/assets/"
        val assets = release.core.map { URI(it).path }.filter { it.startsWith(prefix) }
        require(assets.isNotEmpty()) { "地图字体资源未发布" }
        for (path in assets) bytes("space/assets/" + path.removePrefix(prefix))
        return File(context.filesDir, "campus${URI(release.map_base).path}/assets").toURI().toString().trimEnd('/')
    }
    /** A knowledge picture, named by its full address on one of the hosts the knowledge release lists; kept on disk. */
    suspend fun media(address: String, hosts: List<String>): ByteArray? = withContext(Dispatchers.IO) {
        if (hosts.none { address.startsWith("$it/") }) return@withContext null
        val name = java.security.MessageDigest.getInstance("SHA-256").digest(address.toByteArray()).joinToString("") { "%02x".format(it) }
        val file = File(context.cacheDir, "knowledge-media/$name")
        if (file.isFile) return@withContext file.readBytes()
        val bytes = try { fetchBytes(address) } catch (e: IOException) { return@withContext null }
        file.parentFile?.mkdirs(); file.writeBytes(bytes)
        bytes
    }
    suspend fun bytes(path: String): ByteArray = withContext(Dispatchers.IO) {
        require(path.isNotBlank() && !path.startsWith('/') && path.none { it in "\\:%?#" } && path.split('/').none { it == ".." || it == "." || it.isEmpty() })
        val file = local(path)
        // Coalesce same-file reads across repository instances without a single
        // release-wide lock blocking all unrelated data behind one download.
        val lock = locks[(file.absolutePath.hashCode() and Int.MAX_VALUE) % locks.size]
        lock.withLock {
        coroutineContext.ensureActive()
        if (file.isFile) return@withLock file.readBytes()
        // The bundled release is already local. Do not wait for the network to use it.
        val sameComponent = when {
            path.startsWith("space/") -> URI(release.map_base).path == URI(bundled.map_base).path
            path.startsWith("knowledge/") -> URI(release.knowledge_base).path == URI(bundled.knowledge_base).path
            else -> release.version == bundled.version
        }
        if (sameComponent) {
            val local = try { context.assets.open("data/$path").use { it.readBytes() } } catch (_: FileNotFoundException) { null }
            if (local != null) {
                file.parentFile?.mkdirs(); file.writeBytes(local)
                return@withLock local
            }
        }
        val bytes = try { fetchBytes(address(path)) }
        catch (e: FileNotFoundException) { missing(); throw e }
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
    suspend fun block(path: String, offset: Long, length: Int): ByteArray = withContext(Dispatchers.IO) {
        require(offset >= 0 && length > 0 && offset <= Long.MAX_VALUE - length)
        val file = File(local(path).absolutePath + ".$offset")
        val lock = locks[(file.absolutePath.hashCode() and Int.MAX_VALUE) % locks.size]
        lock.withLock {
        coroutineContext.ensureActive()
        if (file.isFile) return@withLock file.readBytes().also { if (it.size != length) throw DataCorruptionException("离线搜索数据不完整") }
        val address = address(path)
        val bytes = try { download(address, offset, length) }
        catch (e: FileNotFoundException) { missing(); throw e }
        catch (e: IOException) { throw DataUnavailableException(e) }
        file.parentFile!!.mkdirs()
        val pending = File(file.parentFile, "${file.name}.${java.util.UUID.randomUUID()}.pending")
        try { pending.writeBytes(bytes); check(pending.renameTo(file)) { "无法保存离线数据" } } finally { pending.delete() }
        bytes
    } }
    suspend inline fun <reified T> read(path: String): T = withContext(Dispatchers.Default) { Json.decodeFromString(bytes(path).decodeToString()) }
    suspend fun term() = read<TeachingTerm>("teaching/${release.teaching}/term.json")
    suspend fun periods() = read<List<TeachingPeriod>>("teaching/${release.teaching}/periods.json")
    suspend fun classes() = read<List<TeachingClass>>("teaching/${release.teaching}/classes.json")
    suspend fun coursePlans() = withContext(Dispatchers.Default) { read<InformationEntityFile>("entities/information.json").items
        .filter { it["subtype"]?.jsonPrimitive?.content == "information:course-plan" }
        .map { Json.decodeFromJsonElement<CoursePlan>(it) } }
    suspend fun teachingClasses() = withContext(Dispatchers.Default) { read<AgentEntityFile>("entities/agent.json").items.filter { it.subtype == "agent:teaching-class" } }
    private fun enrichMeetings(meetings: List<TeachingMeeting>, groups: Map<String, AgentEntity>): List<TeachingMeeting> =
        meetings.map { meeting ->
            groups[meeting.teaching_class.id]?.let { group ->
                meeting.copy(teaching_class = TeachingGroup(group.id, group.names.firstOrNull(), group.size, group.enrolled, group.capacity))
            } ?: meeting
        }
    suspend fun meetings(): List<TeachingMeeting> = withContext(Dispatchers.Default) {
        val groups = teachingClasses().associateBy { it.id }
        enrichMeetings(read<List<TeachingMeeting>>("teaching/${release.teaching}/meetings.json"), groups)
    }
    suspend fun catalog(): List<top.hicancan.studev.timetable.CatalogCourse> =
        withContext(Dispatchers.Default) { top.hicancan.studev.timetable.CourseCatalog.groupCatalog(meetings(), coursePlans()) }
    suspend fun schedule(id: String): ClassSchedule {
        val groups = teachingClasses().associateBy { it.id }
        return read<ClassSchedule>("teaching/${release.teaching}/classes/$id.json").let { schedule ->
            schedule.copy(meetings = enrichMeetings(schedule.meetings, groups))
        }
    }
    suspend fun effectiveSchedule(id: String, edits: top.hicancan.studev.me.TimetableEdits): ClassSchedule {
        val base = schedule(id)
        if (edits.hidden.isEmpty() && edits.added.isEmpty() && edits.custom.isEmpty()) return base
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
     * Lab sources are independent of lecture attendance: one's own class and explicitly selected extra classes.
     * If these external files cannot be fetched, the teaching-office timetable still stands on its own.
     */
    suspend fun personalLabs(id: String, choices: top.hicancan.studev.me.LabChoices): List<Lab> {
        val own = try { labs(id) } catch (_: DataUnavailableException) { emptyList() }
        val extra = if (choices.classes.isEmpty()) emptyList() else try { allLabs() } catch (_: DataUnavailableException) { emptyList() }
        return top.hicancan.studev.timetable.CourseCatalog.effectiveLabs(own, choices.classes, extra)
    }
    suspend fun examRecord(id: String): ExamRecord {
        val index = examIndex() ?: return ExamRecord(emptyList(), emptyList(), null, emptyList())
        if (id !in index.classes) return ExamRecord(emptyList(), index.sources, index.checked, index.history)
        return ExamRecord(read<ClassExams>("exams/${release.exams}/classes/$id.json").changes, index.sources, index.checked, index.history)
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
    suspend fun line(settings: top.hicancan.studev.me.PersonalSettings, tasks: List<top.hicancan.studev.world.Task> = emptyList()): top.hicancan.studev.world.CampusLine {
        val term = term()
        val klass = settings.klass
        val schedule = klass?.takeIf { id -> classes().any { it.id == id } }?.let { effectiveSchedule(it, settings.timetableEdits(term.term)) }
        val courseMeetings = (klass?.takeIf { schedule != null }?.let { this.schedule(it).meetings }.orEmpty() + schedule?.meetings.orEmpty()).distinctBy { it.id }
        val exams = klass?.let { effectiveExams(it, settings) }.orEmpty()
        val rawLabs = if (klass != null) personalLabs(klass, settings.labs) else emptyList()
        val labs = top.hicancan.studev.timetable.CourseCatalog.attendingLabs(rawLabs, settings.labs)
        return top.hicancan.studev.timetable.Courses.named(top.hicancan.studev.world.CampusLine(term, periods(), schedule?.meetings.orEmpty(), labs, exams, top.hicancan.studev.world.CampusLine.holidays(calendar()), null, tasks, courseMeetings = courseMeetings), settings.timetableEdits(term.term).names, settings.events)
    }
    suspend fun effectiveExams(id: String, settings: top.hicancan.studev.me.PersonalSettings): List<Exam> {
        val edits = settings.timetableEdits(release.teaching)
        val schedule = if (release.exams == release.teaching && classes().any { it.id == id }) effectiveSchedule(id, edits) else null
        return top.hicancan.studev.timetable.ExamAttendance.select(examCandidates(id, edits), settings.examChoices(release.exams, id),
            top.hicancan.studev.timetable.ExamAttendance.ownCodes(release, schedule))
    }
    private val lenient = Json { ignoreUnknownKeys = true }
    suspend fun calendar() = withContext(Dispatchers.Default) { lenient.decodeFromString<top.hicancan.studev.world.CalendarFile>(bytes("calendar.json").decodeToString()).terms }
    suspend fun materials() = withContext(Dispatchers.Default) { lenient.decodeFromString<List<top.hicancan.studev.world.CourseMaterials>>(bytes("materials.json").decodeToString()) }
    suspend fun runs() = withContext(Dispatchers.Default) { lenient.decodeFromString<Map<String, top.hicancan.studev.world.MorningRun>>(bytes("morning-run.json").decodeToString()) }
    suspend fun rooms() = read<RoomIndex>("rooms/index.json")
    suspend fun roomDay(term: String, date: String): RoomDay? = try { read<RoomDay>("rooms/$term/$date.json") } catch (_: FileNotFoundException) { null }
    companion object {
        internal val retired = kotlinx.coroutines.flow.MutableSharedFlow<DataRelease>(extraBufferCapacity = 1)
        private val locks = Array(64) { Mutex() }
        private fun activeRelease(context: Context) = File(context.filesDir, "campus/release.json")
        private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        fun download(address: String, offset: Long? = null, length: Int = 0, connectTimeoutMs: Int = 8_000): ByteArray {
            val url = URI(address).toURL()
            require(url.protocol == "https" || (BuildConfig.DEBUG && url.protocol == "http" && address.startsWith(BuildConfig.DATA_HOST + "/")))
            val connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = connectTimeoutMs; connection.readTimeout = minOf(connectTimeoutMs, 15_000)
            connection.setRequestProperty("User-Agent", "studev-android")
            if (offset != null) connection.setRequestProperty("Range", "bytes=$offset-${offset + length - 1}")
            try {
                if (connection.responseCode == 404) throw FileNotFoundException(address)
                if (connection.responseCode !in 200..299) throw IOException("数据请求失败：${connection.responseCode}")
                val body = connection.inputStream.use { it.readBytes() }
                if (offset == null) return body
                if (connection.responseCode == 206) {
                    val expected = "bytes $offset-${offset + length - 1}/"
                    if (body.size != length || connection.getHeaderField("Content-Range")?.startsWith(expected) != true) {
                        throw DataCorruptionException("服务器返回的搜索数据范围不完整")
                    }
                    return body
                }
                if (offset > body.size.toLong() || length > body.size.toLong() - offset) throw DataCorruptionException("服务器返回的搜索数据不完整")
                return body.copyOfRange(offset.toInt(), offset.toInt() + length)
            } finally { connection.disconnect() }
        }
        suspend fun open(context: Context): AcademicRepository = withContext(Dispatchers.IO) {
            val saved = activeRelease(context)
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
            // Application updates and campus snapshots have independent lifecycles.
            val runtimeFile = File(context.filesDir, "campus/app.json")
            val runtime = try {
                val fresh = download("${BuildConfig.SITE_ORIGIN}/app-release.json", connectTimeoutMs = 2_500).decodeToString()
                val parsed = appRuntime(fresh)
                runtimeFile.parentFile?.mkdirs(); runtimeFile.writeText(fresh)
                parsed
            } catch (e: CancellationException) { throw e } catch (_: Exception) { runCatching { appRuntime(runtimeFile.readText()) }.getOrNull() }
            val app = runtime?.android
            val entry = runtime?.campus_entry ?: "${BuildConfig.DATA_HOST}/campus-release.json"
            val text = try { download(entry).decodeToString() } catch (e: CancellationException) { throw e } catch (_: IOException) { return@withContext null }
            try {
                val release = releaseFromManifest(text) ?: return@withContext Discovery(app, null, unreadable = true)
                val at = URI(entry)
                Discovery(app, activate(context, release.copy(base = at.resolve(release.base).toString(),
                    map_base = at.resolve(release.map_base).toString(), knowledge_base = at.resolve(release.knowledge_base).toString(),
                    search_base = at.resolve(release.search_base).toString(), texts_base = at.resolve(release.texts_base).toString()), klass), unreadable = false)
            } catch (e: CancellationException) { throw e }
            catch (_: kotlinx.serialization.SerializationException) { Discovery(app, null, unreadable = true) }
            catch (_: IllegalArgumentException) { Discovery(app, null, unreadable = true) }
            catch (_: IOException) { Discovery(app, null, unreadable = false) }
        }
        private fun componentBase(value: String, prefix: String): Boolean = runCatching {
            val uri = URI(value)
            (uri.scheme == null && uri.rawAuthority == null || uri.scheme == "https" && uri.host != null) && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null
                && Regex("/$prefix/[A-Za-z0-9._-]+").matches(uri.path)
        }.getOrDefault(false)
        private fun validRelease(release: DataRelease) = Regex("[A-Za-z0-9._-]+").matches(release.version) && runCatching { val base = URI(release.base); base.path == "/data/${release.version}" && (base.scheme == null || base.scheme == "https") && base.rawUserInfo == null && base.rawQuery == null && base.rawFragment == null }.getOrDefault(false)
            && componentBase(release.map_base, "space") && componentBase(release.knowledge_base, "knowledge")
            && componentBase(release.search_base, "search") && componentBase(release.texts_base, "texts")
        private suspend fun activate(context: Context, release: DataRelease, klass: String?): AcademicRepository {
            require(validRelease(release))
            val repository = AcademicRepository(context.applicationContext, release)
            val (term, classes) = coroutineScope {
                val term = async { repository.term() }
                val classes = async { repository.classes() }
                awaitAll(async { repository.periods() }, async { repository.rooms() },
                    async { repository.examIndex() }, async { repository.labIndex() },
                    async { repository.coursePlans() }, async { repository.teachingClasses() })
                term.await() to classes.await()
            }
            if (klass != null) {
                coroutineScope {
                    awaitAll(async {
                        if (classes.any { it.id == klass }) {
                            repository.schedule(klass)
                            val edits = top.hicancan.studev.me.CampusSettings(context).state.value.timetableEdits(term.term)
                            if (edits.added.isNotEmpty()) repository.catalog()
                        }
                    }, async { repository.exams(klass) }, async { repository.labs(klass) })
                }
            }
            val index = activeRelease(context)
            index.parentFile!!.mkdirs()
            val pending = File(index.parentFile, "release.${java.util.UUID.randomUUID()}.pending")
            try {
                pending.writeText(Json.encodeToString(release))
                check(pending.renameTo(index))
            } finally { pending.delete() }
            // Only the superseded public cache layout is retired. Account,
            // preferences and tasks live elsewhere and are never touched here.
            index.parentFile?.listFiles()?.forEach { child ->
                if (child.isFile && Regex("release-\\d+\\.json").matches(child.name)) child.delete()
                if (child.isDirectory && "__app" in child.name && child.canonicalPath.startsWith(index.parentFile!!.canonicalPath + File.separator)) child.deleteRecursively()
            }
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

class DataCorruptionException(message: String) : IllegalStateException(message)
