package top.hicancan.studev.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import java.io.File
import java.io.FileNotFoundException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder
import top.hicancan.studev.BuildConfig
import java.io.IOException

/** One immutable release per reader. Files are fetched lazily, then kept for offline reads.
 * A remote release never falls back to a different release's shards. */
class AcademicRepository(context: Context, release: DataRelease, fetchBytes: (String) -> ByteArray = Companion::download) {
    private val context = context
    private val fetchBytes = fetchBytes
    val release = release
    private val bundled: DataRelease by lazy { Json.decodeFromString(context.assets.open("data/release.json").bufferedReader().use { it.readText() }) }
    private val root = File(context.filesDir, "campus/${release.version}")
    private val reads = locks.computeIfAbsent(root.absolutePath) { Mutex() }
    suspend fun bytes(path: String): ByteArray = withContext(Dispatchers.IO) { reads.withLock {
        require(path.isNotBlank() && !path.startsWith('/') && path.none { it in "\\:%?#" } && path.split('/').none { it == ".." || it == "." || it.isEmpty() })
        val file = File(root, path)
        if (file.isFile) return@withLock file.readBytes()
        // The bundled release is already local. Do not wait for the network to use it.
        if (release.version == bundled.version) {
            val local = try { context.assets.open("data/$path").use { it.readBytes() } } catch (_: FileNotFoundException) { null }
            if (local != null) return@withLock local
        }
        val bytes = try { fetchBytes("${BuildConfig.DATA_HOST}${release.base}/" + path.split('/').joinToString("/") { encode(it) }) }
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
    suspend fun schedule(id: String) = read<ClassSchedule>("teaching/${release.teaching}/classes/$id.json")
    suspend fun examIndex() = release.exams?.let { read<ExamIndex>("exams/$it/index.json") }
    suspend fun exams(id: String): List<Exam> {
        val term = release.exams ?: return emptyList()
        if (examIndex()?.classes?.contains(id) != true) return emptyList()
        return read<ClassExams>("exams/$term/classes/$id.json").exams
    }
    suspend fun rooms() = read<RoomIndex>("rooms/index.json")
    suspend fun roomDay(term: String, date: String): RoomDay? = try { read<RoomDay>("rooms/$term/$date.json") } catch (_: FileNotFoundException) { null }
    companion object {
        private val locks = java.util.concurrent.ConcurrentHashMap<String, Mutex>()
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
            val release = runCatching { Json.decodeFromString<DataRelease>(saved.readText()) }.getOrElse {
                Json.decodeFromString(context.assets.open("data/release.json").bufferedReader().use { it.readText() })
            }
            require(validRelease(release))
            AcademicRepository(context.applicationContext, release)
        }
        suspend fun bundled(context: Context): AcademicRepository = withContext(Dispatchers.IO) {
            AcademicRepository(context.applicationContext, Json.decodeFromString(context.assets.open("data/release.json").bufferedReader().use { it.readText() }))
        }
        /** The web embeds campus-release.json at build time, rather than exposing a latest URL.
         * Discover the same release from the campus island's entry module. No date guessing. */
        suspend fun discover(context: Context, klass: String? = null): AcademicRepository? = withContext(Dispatchers.IO) {
            try {
                val host = BuildConfig.DATA_HOST
                val html = download("$host/search/").decodeToString()
                val modules = Regex("(?:component-url|src)=\"([^\"]+\\.js)\"").findAll(html).map { it.groupValues[1] }.distinct().take(12).toMutableList()
                var cursor = 0
                while (cursor < modules.size && cursor < 20) {
                    val module = modules[cursor++]
                    val url = URL(URL(host), module)
                    if (url.authority != URL(host).authority || url.protocol != URL(host).protocol) continue
                    val script = download(url.toString()).decodeToString()
                    Regex("(?:_astro/|\\./)?constants\\.[A-Za-z0-9_-]+\\.js").findAll(script).forEach {
                        val dependency = "/_astro/" + it.value.substringAfterLast('/')
                        if (dependency !in modules) modules += dependency
                    }
                    val release = releaseFromModule(script) ?: continue
                    return@withContext activate(context, release, klass)
                }
                null
            } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
        }
        private fun validRelease(release: DataRelease) = Regex("[A-Za-z0-9._-]+").matches(release.version) && release.base == "/data/${release.version}"
        private suspend fun activate(context: Context, release: DataRelease, klass: String?): AcademicRepository {
            require(validRelease(release))
            val repository = AcademicRepository(context.applicationContext, release)
            repository.term(); repository.periods(); val classes = repository.classes(); repository.rooms(); repository.examIndex()
            if (klass != null) {
                if (classes.any { it.id == klass }) repository.schedule(klass)
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
        internal fun releaseFromModule(script: String): DataRelease? {
            // Minifiers may quote property names; the values are the untouched digest contract.
            val objectText = Regex("\\{[^{}]{0,1500}(?:base|\"base\")\\s*:\\s*[\"`]/data/[^\"`]+[\"`][^{}]{0,1500}\\}").find(script)?.value ?: return null
            fun field(name: String) = Regex("(?:\"$name\"|\\b$name)\\s*:\\s*[\"`]([^\"`]*)[\"`]").find(objectText)?.groupValues?.get(1)
            val version = field("version") ?: return null
            val base = field("base") ?: return null
            if (!Regex("[A-Za-z0-9._-]+").matches(version) || base != "/data/$version") return null
            return DataRelease(version, base, field("built_at") ?: return null, field("teaching") ?: return null, field("exams"), field("rooms") ?: return null)
        }
    }
}
