package top.hicancan.studev

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class BrowserDownloadTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun bundledReleaseIndexesOpenWithoutNetwork() = kotlinx.coroutines.runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val repository = top.hicancan.studev.data.AcademicRepository.bundled(context)
        repository.term(); repository.periods(); repository.classes(); repository.rooms(); repository.examIndex()
        Unit
    }

    @Test fun applicationUpdateOpensTheWebDownloadPage() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("tab-me").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("tab-me").performClick()
        compose.onNodeWithTag("me").performScrollToNode(hasText("下载新版本"))
        compose.onNodeWithText("下载新版本").assertIsDisplayed()
        compose.waitForIdle()
        val context = instrumentation.targetContext
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(context.getExternalFilesDir(null), "converge-shots").apply { mkdirs() }.resolve("browser-update-entry.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
        val opened = AtomicReference<Intent>()
        val monitor = object : Instrumentation.ActivityMonitor() {
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                if (intent.action != Intent.ACTION_VIEW) return null
                opened.set(intent)
                return Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
            }
        }
        instrumentation.addMonitor(monitor)
        try {
            compose.onNodeWithText("下载新版本").performClick()
            compose.waitUntil(5_000) { opened.get() != null }
            assertEquals("${BuildConfig.SITE_ORIGIN}/download/", opened.get().data.toString())
            assertEquals(null, opened.get().component)
        } finally {
            instrumentation.removeMonitor(monitor)
            compose.onNodeWithTag("tab-home").performClick()
        }
    }
}
