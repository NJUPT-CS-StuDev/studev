package top.hicancan.studev

import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.search.NativeSearch

/** Exercise the released corpus with the actual asset/cache/network reader. */
@RunWith(AndroidJUnit4::class)
class ColdSearchTest {
    @Test fun coldAndWarmSearchUseTheSameRanking() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val bundled = AcademicRepository.bundled(context)
        val downloads = Collections.synchronizedList(mutableListOf<JsonObject>())
        val active = AtomicInteger()
        val peak = AtomicInteger()
        val repository = AcademicRepository(context, bundled.release) { address ->
            val count = active.incrementAndGet()
            peak.updateAndGet { maxOf(it, count) }
            val start = SystemClock.elapsedRealtime()
            try { AcademicRepository.download(address).also { bytes -> downloads += buildJsonObject {
                put("path", address.substringAfter("/search/")); put("bytes", bytes.size); put("ms", SystemClock.elapsedRealtime() - start)
            } } } finally { active.decrementAndGet() }
        }
        val cache = File(context.filesDir, "campus/${repository.release.version}/search")
        assertTrue(!cache.exists() || cache.deleteRecursively())
        val reads = Collections.synchronizedList(mutableListOf<JsonObject>())
        val filters = buildJsonObject { put("excludedSourceIds", JsonArray(listOf("njupt-survival-guide", "njupt-general-free-exams").map(::JsonPrimitive))) }
        NativeSearch { path ->
            val start = SystemClock.elapsedRealtime()
            repository.bytes("search/$path").also { bytes -> reads += buildJsonObject {
                put("path", path); put("bytes", bytes.size); put("ms", SystemClock.elapsedRealtime() - start)
            } }
        }.use { search ->
            val start = SystemClock.elapsedRealtime()
            var firstResultMs = -1L
            var ranked: NativeSearch.Page? = null
            val cold = search.page("转专业", 30, filters = filters) { value ->
                firstResultMs = SystemClock.elapsedRealtime() - start
                ranked = value
                assertTrue(value.results.isNotEmpty())
                assertTrue(downloads.none { it["path"]!!.jsonPrimitive.content.startsWith("content-") })
            }
            val coldMs = SystemClock.elapsedRealtime() - start
            val coldReads = reads.toList()
            reads.clear()
            val warmStart = SystemClock.elapsedRealtime()
            val warm = search.page("转专业", 30, filters = filters)
            val warmMs = SystemClock.elapsedRealtime() - warmStart
            assertTrue(cold.results.isNotEmpty())
            assertEquals(cold.total, warm.total)
            assertEquals(cold.results.map { it["id"] }, warm.results.map { it["id"] })
            assertEquals(cold.results.map { it["id"] }, ranked!!.results.map { it["id"] })
            assertTrue(peak.get() in 1..4)
            assertTrue(downloads.none { it["path"]!!.jsonPrimitive.content.startsWith("documents-") })
            File(context.getExternalFilesDir(null), "search-cold.json").writeText(buildJsonObject {
                put("version", repository.release.version); put("coldMs", coldMs); put("warmMs", warmMs)
                put("firstResultMs", firstResultMs); put("peakDownloads", peak.get()); put("downloads", JsonArray(downloads.toList()))
                put("total", cold.total); put("coldReads", JsonArray(coldReads)); put("warmReads", JsonArray(reads.toList()))
            }.toString())
        }
    }

    @Test fun independentShardsLoadTogetherWhileDuplicateReadsCoalesce() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val bundled = AcademicRepository.bundled(context)
        val manifest = Json.parseToJsonElement(bundled.bytes("search/manifest.json").decodeToString()).jsonObject
        val paths = manifest["lexicon"]!!.jsonObject["blocks"]!!.jsonArray.take(2).map { "search/${it.jsonObject["path"]!!.jsonPrimitive.content}" }
        val root = File(context.filesDir, "campus/${bundled.release.version}")
        paths.forEach { File(root, it).delete() }
        val together = CountDownLatch(2)
        val requests = AtomicInteger()
        val repository = AcademicRepository(context, bundled.release) { address ->
            requests.incrementAndGet()
            together.countDown()
            check(together.await(5, TimeUnit.SECONDS)) { "Unrelated reads were serialized" }
            AcademicRepository.download(address)
        }
        paths.map { path -> async { repository.bytes(path) } }.awaitAll()
        assertEquals(2, requests.get())
        File(root, paths.first()).delete()
        requests.set(0)
        val readers = listOf(repository, AcademicRepository(context, bundled.release) { address -> requests.incrementAndGet(); AcademicRepository.download(address) })
        val values = readers.map { reader -> async { reader.bytes(paths.first()) } }.awaitAll()
        assertEquals(1, requests.get())
        assertArrayEquals(values[0], values[1])
    }
}
