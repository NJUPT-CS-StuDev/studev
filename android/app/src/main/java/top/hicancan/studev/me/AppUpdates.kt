package top.hicancan.studev.me

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.studev.BuildConfig
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest

data class ApkPart(val name: String, val size: Long, val sha256: String, val url: String)
data class ApkManifest(val versionName: String, val versionCode: Long, val minSdk: Int, val size: Long, val sha256: String, val releaseNotes: String, val parts: List<ApkPart>)
data class AppRelease(val name: String, val manifest: ApkManifest, val manifestUrl: String)
sealed interface UpdateCheck { data class Available(val release: AppRelease) : UpdateCheck; data object Current : UpdateCheck; data object Unavailable : UpdateCheck }

object AppUpdates {
    const val PRIMARY_LATEST = "/download/latest.json"
    private const val PREFS = "app-update"
    private const val PENDING = "pending"
    private const val MAX_RETRIES = 3

    suspend fun check(): UpdateCheck = withContext(Dispatchers.IO) {
        runCatching {
            val primary = "${BuildConfig.DATA_HOST}$PRIMARY_LATEST"
            val release = readRelease(primary)
            if (release.manifest.versionCode <= BuildConfig.VERSION_CODE) UpdateCheck.Current else UpdateCheck.Available(release)
        }.getOrDefault(UpdateCheck.Unavailable)
    }

    suspend fun download(context: Context, release: AppRelease) = withContext(Dispatchers.IO) {
        val root = updateRoot(context); root.mkdirs()
        for (part in release.manifest.parts) downloadPart(part, File(root, part.name))
        val apk = File(root, "studev-update.apk")
        FileOutputStream(apk).use { output -> release.manifest.parts.forEach { output.write(File(root, it.name).readBytes()) } }
        check(apk.length() == release.manifest.size && digest(apk) == release.manifest.sha256) { "APK 校验失败" }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(PENDING, true).apply()
    }

    fun pending(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(PENDING, false) && apkFile(context).isFile

    @Suppress("DEPRECATION")
    fun installDownloaded(context: Context, requestPermission: Boolean = false): String? {
        if (!pending(context)) return null
        val file = apkFile(context)
        val apk = context.packageManager.getPackageArchiveInfo(file.path, 0)
        val code = apk?.let { if (android.os.Build.VERSION.SDK_INT >= 28) it.longVersionCode else it.versionCode.toLong() }
        if (apk?.packageName != context.packageName || code == null || code <= BuildConfig.VERSION_CODE) { clear(context); return "当前已是最新版本" }
        if (!context.packageManager.canRequestPackageInstalls()) {
            if (requestPermission) context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
            return "允许安装后，返回 studev 继续"
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        clear(context); return null
    }

    internal fun parseLatest(json: String, latestUrl: String): Pair<String, Long> {
        val data = Json.parseToJsonElement(json).jsonObject
        val versionCode = data["versionCode"]!!.jsonPrimitive.long
        return URI(latestUrl).resolve(data["manifestUrl"]!!.jsonPrimitive.content).toString() to versionCode
    }

    internal fun parseManifest(json: String, manifestUrl: String): ApkManifest {
        val data = Json.parseToJsonElement(json).jsonObject; val base = URI(manifestUrl)
        val parts = data["parts"]!!.jsonArray.map { item ->
            val part = item.jsonObject
            ApkPart(part["name"]!!.jsonPrimitive.content, part["size"]!!.jsonPrimitive.long, part["sha256"]!!.jsonPrimitive.content, base.resolve(part["url"]!!.jsonPrimitive.content).toString())
        }
        require(parts.isNotEmpty() && data["size"]!!.jsonPrimitive.long > 0)
        return ApkManifest(data["versionName"]!!.jsonPrimitive.content, data["versionCode"]!!.jsonPrimitive.long, data["minSdk"]!!.jsonPrimitive.int, data["size"]!!.jsonPrimitive.long, data["sha256"]!!.jsonPrimitive.content, data["releaseNotes"]?.jsonPrimitive?.contentOrNull.orEmpty(), parts)
    }

    private fun readRelease(latestUrl: String): AppRelease {
        val (manifestUrl, pointerCode) = parseLatest(fetch(latestUrl).decodeToString(), latestUrl)
        val manifest = parseManifest(fetch(manifestUrl).decodeToString(), manifestUrl)
        require(manifest.versionCode == pointerCode)
        return AppRelease("studev ${manifest.versionName}", manifest, manifestUrl)
    }

    private fun downloadPart(part: ApkPart, file: File) {
        require(part.size > 0 && part.name.matches(Regex("part-[0-9]{3,}")))
        for (attempt in 0 until MAX_RETRIES) {
            if (file.isFile && file.length() == part.size && digest(file) == part.sha256) return
            var offset = file.takeIf { it.isFile }?.length() ?: 0L
            if (offset > part.size) { file.delete(); offset = 0 }
            if (offset == part.size) { file.delete(); offset = 0 }
            val connection = open(part.url)
            if (offset > 0) connection.setRequestProperty("Range", "bytes=$offset-")
            try {
                val status = connection.responseCode
                if (status !in 200..299 && status != 416) throw IOException("分片请求失败：$status")
                if (offset > 0 && status == 200) { file.delete(); offset = 0 }
                if (status == 416 && file.length() == part.size && digest(file) == part.sha256) return
                connection.inputStream.use { input -> FileOutputStream(file, offset > 0).use { output -> input.copyTo(output) } }
            } catch (error: IOException) {
                if (attempt == MAX_RETRIES - 1) throw error
                continue
            } finally { connection.disconnect() }
            if (file.length() == part.size && digest(file) == part.sha256) return
            if (attempt == MAX_RETRIES - 1) throw IOException("分片校验失败：${part.name}")
        }
    }

    private fun fetch(url: String): ByteArray = open(url).let { connection -> try { connection.inputStream.use { it.readBytes() } } finally { connection.disconnect() } }
    private fun open(address: String): HttpURLConnection {
        val uri = URI(address)
        require(uri.scheme == "https" || (BuildConfig.DEBUG && (address.startsWith(BuildConfig.DATA_HOST) || uri.host == "127.0.0.1" || uri.host == "localhost")))
        return (uri.toURL().openConnection() as HttpURLConnection).apply { connectTimeout = 8_000; readTimeout = 15_000 }
    }
    private fun digest(file: File): String { val hash = MessageDigest.getInstance("SHA-256"); file.inputStream().use { input -> val buffer = ByteArray(64 * 1024); while (true) { val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) } }; return hash.digest().joinToString("") { "%02x".format(it) } }
    private fun updateRoot(context: Context) = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "studev-update")
    private fun apkFile(context: Context) = File(updateRoot(context), "studev-update.apk")
    private fun clear(context: Context) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PENDING).apply(); updateRoot(context).deleteRecursively() }
}
