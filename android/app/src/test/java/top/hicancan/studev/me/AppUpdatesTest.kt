package top.hicancan.studev.me

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdatesTest {
    private val manifestUrl = "https://studev.hicancan.top/download/2/manifest.json"
    private val manifest = """{"format":1,"versionName":"1.0.1","versionCode":2,"minSdk":26,"size":6,"sha256":"${"00".repeat(32)}","releaseNotes":"修复","parts":[{"name":"part-000","size":2,"sha256":"${"11".repeat(32)}","url":"part-000"},{"name":"part-001","size":2,"sha256":"${"22".repeat(32)}","url":"part-001"},{"name":"part-002","size":2,"sha256":"${"33".repeat(32)}","url":"part-002"}]}"""

    @Test fun latestPointsToManifestAndAllPartsAreKept() {
        val (url, code) = AppUpdates.parseLatest("{\"format\":1,\"versionCode\":2,\"manifestUrl\":\"/download/2/manifest.json\"}", "https://studev.hicancan.top/download/latest.json")
        val parsed = AppUpdates.parseManifest(manifest, url)
        assertEquals(2L, code); assertEquals("https://studev.hicancan.top/download/2/manifest.json", url)
        assertEquals(3, parsed.parts.size); assertEquals("part-002", parsed.parts.last().name); assertEquals(26, parsed.minSdk)
    }

    @Test fun siteRelativePartUrlsResolveFromManifest() {
        val parsed = AppUpdates.parseManifest(manifest, manifestUrl)
        assertTrue(parsed.parts.first().url.startsWith("https://studev.hicancan.top/download/2/"))
    }
}
