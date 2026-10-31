package top.hicancan.studev

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import top.hicancan.studev.me.ApkManifest
import top.hicancan.studev.me.ApkPart
import top.hicancan.studev.me.AppRelease
import top.hicancan.studev.me.AppUpdates
import java.net.ServerSocket
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class AppUpdatesInstrumentedTest {
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    @Test fun downloadsAndAssemblesThreeParts() {
        runBlocking {
            val context = ApplicationProvider.getApplicationContext<android.content.Context>()
            val root = context.getExternalFilesDir("Download")!!.resolve("studev-update")
            root.deleteRecursively()
            val chunks = listOf("part-a".toByteArray(), "part-b".toByteArray(), "part-c".toByteArray())
            root.mkdirs()
            root.resolve("part-001").writeBytes(chunks[1].copyOf(1))
            val resumed = AtomicBoolean(false)
            ServerSocket(0).use { server ->
                val thread = Thread {
                    repeat(3) {
                        server.accept().use { socket ->
                            val reader = socket.getInputStream().bufferedReader()
                            val request = buildString { while (true) { val line = reader.readLine() ?: break; if (line.isEmpty()) break; appendLine(line) } }
                            val index = request.substringAfter("/part-").substringBefore(' ').toInt()
                            val bytes = chunks[index]
                            val offset = Regex("Range: bytes=(\\d+)-", RegexOption.IGNORE_CASE).find(request)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                            if (offset > 0) resumed.set(true)
                            val payload = bytes.copyOfRange(offset, bytes.size)
                            val out = socket.getOutputStream()
                            val status = if (offset > 0) "206 Partial Content" else "200 OK"
                            out.write("HTTP/1.1 $status\r\nContent-Length: ${payload.size}\r\nConnection: close\r\n\r\n".toByteArray())
                            out.write(payload); out.flush()
                        }
                    }
                }
                thread.start()
                val base = "http://127.0.0.1:${server.localPort}/part-"
                val parts = chunks.mapIndexed { index, bytes -> ApkPart("part-${index.toString().padStart(3, '0')}", bytes.size.toLong(), hash(bytes), "$base$index") }
                val manifest = ApkManifest("9.9.9", 99, 26, chunks.sumOf { it.size.toLong() }, hash(chunks.reduce { a, b -> a + b }), "test", parts)
                AppUpdates.download(context, AppRelease("test", manifest, "$base/latest.json"))
                thread.join(5_000)
                assertEquals(true, resumed.get())
                assertEquals(true, AppUpdates.pending(context))
                assertEquals(chunks.flatMap { it.asList() }, root.resolve("studev-update.apk").readBytes().asList())
                root.deleteRecursively()
            }
        }
    }
}
