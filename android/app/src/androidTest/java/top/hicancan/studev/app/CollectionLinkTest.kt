package top.hicancan.studev.app

import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.net.toUri
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import top.hicancan.studev.BuildConfig

class CollectionLinkTest {
    @Test fun collectionPrefillSurvivesTheBrowserHandoff() {
        val place = "教学楼 A&B · 教室 1"
        val position = "32.099999,118.900001"
        val launch = collectionLink(BuildConfig.FORM_PLACE, listOf("place" to place, "position" to position)).toUri()
        assertEquals(BuildConfig.SITE_ORIGIN, "${launch.scheme}://${launch.authority}")
        assertEquals("/forms/", launch.path)
        assertEquals(BuildConfig.FORM_PLACE, launch.getQueryParameter("id"))
        assertEquals(place, launch.getQueryParameter("a.place"))
        assertEquals(position, launch.getQueryParameter("a.position"))
    }

    @Test fun nativeAppHandlesAccountLinksAndLeavesCollaborationToTheBrowser() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        fun isNative(path: String): Boolean {
            val intent = Intent(Intent.ACTION_VIEW, "${BuildConfig.SITE_ORIGIN}$path".toUri())
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setPackage(app.packageName)
            return app.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).isNotEmpty()
        }
        assertTrue(isNative("/account/"))
        assertFalse(isNative("/forms/?id=${BuildConfig.FORM_FEEDBACK}"))
        assertFalse(isNative("/members/"))
    }
}
