package top.hicancan.studev.me

import android.app.DownloadManager
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
import top.hicancan.studev.data.AcademicRepository
import java.io.File

data class AppRelease(val name: String, val asset: String, val url: String)
object AppUpdates {
    suspend fun check(): AppRelease? = withContext(Dispatchers.IO) {
        // No releases is an ordinary state for the first public version.
        runCatching<AppRelease?> {
            var page = 1
            while (true) {
                val releases = Json.parseToJsonElement(AcademicRepository.download("https://api.github.com/repos/NJUPT-CS-StuDev/studev/releases?per_page=100&page=$page").decodeToString()).jsonArray
                val found = releases.firstNotNullOfOrNull { release ->
                    val data = release.jsonObject
                    if (data["draft"]?.jsonPrimitive?.boolean == true || data["prerelease"]?.jsonPrimitive?.boolean == true) return@firstNotNullOfOrNull null
                    data["assets"]?.jsonArray?.firstOrNull { it.jsonObject["name"]?.jsonPrimitive?.content?.endsWith(".apk") == true }?.jsonObject?.let { asset ->
                        AppRelease(data["name"]?.jsonPrimitive?.content ?: data.getValue("tag_name").jsonPrimitive.content,
                            asset.getValue("name").jsonPrimitive.content, asset.getValue("browser_download_url").jsonPrimitive.content)
                    }
                }
                if (found != null) return@runCatching found
                if (releases.size < 100) return@runCatching null
                page++
            }
            @Suppress("UNREACHABLE_CODE") null
        }.getOrNull()
    }
    fun download(context: Context, release: AppRelease) {
        val url = Uri.parse(release.url)
        require(url.scheme == "https" && url.host == "github.com" && url.path.orEmpty().startsWith("/NJUPT-CS-StuDev/studev/releases/download/"))
        File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "studev-update.apk").delete()
        val request = DownloadManager.Request(url).setTitle("studev ${release.name}").setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "studev-update.apk")
        val id = context.getSystemService(DownloadManager::class.java).enqueue(request)
        context.getSharedPreferences("app-update", Context.MODE_PRIVATE).edit().putLong("download", id).apply()
    }
    /** Called from the visible Activity on return. Compare the downloaded manifest's actual
     * versionCode, not GitHub's tag or versionName. The platform installer verifies signing. */
    fun pending(context: Context) = context.getSharedPreferences("app-update", Context.MODE_PRIVATE).getLong("download", -1) != -1L
    @Suppress("DEPRECATION")
    fun installDownloaded(context: Context, requestPermission: Boolean = false): String? {
        val prefs = context.getSharedPreferences("app-update", Context.MODE_PRIVATE)
        val id = prefs.getLong("download", -1)
        if (id == -1L) return null
        context.getSystemService(DownloadManager::class.java).query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
            if (!cursor.moveToFirst()) return null
            val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            if (status == DownloadManager.STATUS_FAILED) { prefs.edit().remove("download").apply(); return "下载未完成，请重试" }
            if (status != DownloadManager.STATUS_SUCCESSFUL) return null
        }
        val file = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "studev-update.apk")
        val apk = context.packageManager.getPackageArchiveInfo(file.path, 0)
        val code = apk?.let { if (android.os.Build.VERSION.SDK_INT >= 28) it.longVersionCode else it.versionCode.toLong() }
        if (apk?.packageName != context.packageName || code == null || code <= BuildConfig.VERSION_CODE) {
            prefs.edit().remove("download").apply(); file.delete(); return "当前已是最新版本"
        }
        if (!context.packageManager.canRequestPackageInstalls()) {
            if (requestPermission) context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
            return "允许安装后，返回 studev 继续"
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        prefs.edit().remove("download").apply()
        return null
    }
}
