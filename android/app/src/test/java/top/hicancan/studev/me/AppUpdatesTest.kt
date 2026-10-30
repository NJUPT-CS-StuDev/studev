package top.hicancan.studev.me

import org.junit.Assert.*
import org.junit.Test

class AppUpdatesTest {
    private fun release(body: String?, vararg assets: String) = """{"tag_name":"v1.0.1","name":"studev 1.0.1","body":${body?.let { "\"$it\"" } ?: "null"},
        "assets":[${assets.joinToString(",") { """{"name":"$it","browser_download_url":"https://github.com/NJUPT-CS-StuDev/studev/releases/download/v1.0.1/$it"}""" }}]}"""

    @Test fun newerDeclaredVersionCodeOffersTheStudevApk() {
        val result = AppUpdates.parse(release("校园地图\\n\\nversionCode: 2", "studev-1.0.1.apk", "studev.apk"), 1)
        val offered = (result as UpdateCheck.Available).release
        assertEquals("studev.apk", offered.asset); assertEquals(2L, offered.versionCode); assertEquals("studev 1.0.1", offered.name)
        assertTrue(offered.url.endsWith("/v1.0.1/studev.apk"))
    }

    @Test fun sameOrOlderVersionCodeIsCurrent() {
        assertEquals(UpdateCheck.Current, AppUpdates.parse(release("versionCode: 1", "studev.apk"), 1))
        assertEquals(UpdateCheck.Current, AppUpdates.parse(release("versionCode：1", "studev.apk"), 3))
    }

    @Test fun releaseWithoutTheAssetIsNotAnUpdate() {
        assertEquals(UpdateCheck.Current, AppUpdates.parse(release("versionCode: 9", "studev-1.0.1.apk"), 1))
    }

    @Test fun undeclaredVersionCodeDefersToTheDownloadedManifest() {
        val offered = (AppUpdates.parse(release(null, "studev.apk"), 1) as UpdateCheck.Available).release
        assertNull(offered.versionCode)
    }
}
