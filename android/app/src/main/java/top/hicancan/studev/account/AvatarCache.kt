package top.hicancan.studev.account

import android.content.Context
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.security.MessageDigest

internal val qqNumber = Regex("[1-9]\\d{4,11}")

/** The last public QQ avatar for a device, independent of the account tokens. */
internal object AvatarCache {
    const val freshness = 86_400_000L
    private const val maxBytes = 256 * 1024
    private const val maxFiles = 16
    private val memory = LruCache<String, Picture>(maxFiles)

    data class Picture(val image: ImageBitmap, val fetchedAt: Long) {
        fun isFresh() = System.currentTimeMillis() - fetchedAt in 0 until freshness
    }

    fun memory(qq: String): Picture? = memory.get(qq)
    fun disk(context: Context, qq: String): Picture? = runCatching {
        val file = file(context, qq)
        if (!file.isFile) return null
        val image = file.inputStream().use { decode(it.accountBytes(maxBytes)) } ?: return null
        Picture(image, file.lastModified()).also { memory.put(qq, it) }
    }.getOrNull()

    fun fetch(context: Context, qq: String): Picture? = runCatching {
        val connection = URL("https://q1.qlogo.cn/g?b=qq&nk=$qq&s=100").openConnection() as HttpURLConnection
        val bytes = try {
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.inputStream.use { it.accountBytes(maxBytes) }
        } finally { connection.disconnect() }
        val image = decode(bytes) ?: return null
        val picture = Picture(image, System.currentTimeMillis())
        memory.put(qq, picture)
        runCatching { save(file(context, qq), bytes) }
        picture
    }.getOrNull()

    private fun decode(bytes: ByteArray): ImageBitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth !in 1..512 || bounds.outHeight !in 1..512) return null
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
    }

    private fun file(context: Context, qq: String): File {
        val digest = MessageDigest.getInstance("SHA-256").digest(qq.toByteArray()).joinToString("") { "%02x".format(it) }
        return context.cacheDir.resolve("account/avatars/$digest")
    }

    @Synchronized private fun save(file: File, bytes: ByteArray) {
        val directory = checkNotNull(file.parentFile)
        directory.mkdirs()
        val pending = File.createTempFile("avatar-", ".pending", directory)
        try {
            pending.writeBytes(bytes)
            Files.move(pending.toPath(), file.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
            directory.listFiles()?.filter { it.isFile && it.name.length == 64 }?.sortedByDescending { it.lastModified() }
                ?.drop(maxFiles)?.forEach { it.delete() }
        } finally { pending.delete() }
    }
}
