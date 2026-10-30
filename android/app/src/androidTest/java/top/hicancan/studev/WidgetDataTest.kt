package top.hicancan.studev

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.updateAll
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import top.hicancan.studev.data.*
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.navigation.*
import top.hicancan.studev.timetable.*
import top.hicancan.studev.widget.*
import java.io.File
import java.io.FileNotFoundException
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class WidgetDataTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun wait(tag: String) {
        compose.waitUntil(30000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
    }
    private fun fixture(path: String) = instrumentation.context.assets.open("data/$path").use { it.readBytes() }
    private fun shot(name: String) {
        Thread.sleep(1600)
        val directory = File(context.getExternalFilesDir(null), "widget-shots").apply { mkdirs() }
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private fun visibleText(text: String): Boolean {
        fun has(node: android.view.accessibility.AccessibilityNodeInfo?): Boolean {
            if (node == null) return false
            if (node.text?.toString()?.contains(text) == true) return true
            return (0 until node.childCount).any { has(node.getChild(it)) }
        }
        return has(instrumentation.uiAutomation.rootInActiveWindow)
    }
    private fun showWidget() {
        val display = context.resources.displayMetrics
        val info = instrumentation.uiAutomation.serviceInfo
        info.packageNames = null
        info.flags = info.flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
            android.accessibilityservice.AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        instrumentation.uiAutomation.serviceInfo = info
        repeat(7) {
            if (visibleText("出门") || visibleText("今天和明天") || visibleText("课表还未下载") || visibleText("抬眼可见")) return
            android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(
                "input swipe ${display.widthPixels * 9 / 10} ${display.heightPixels / 2} ${display.widthPixels / 10} ${display.heightPixels / 2} 400"
            )).use { it.readBytes() }
            Thread.sleep(1200)
        }
        fail("The existing studev widget was not visible on the launcher")
    }

    @Test fun splitBundledReleaseDownloadsOnceAndSurvivesOfflineReaders(): Unit = runBlocking {
        val bundled = AcademicRepository.bundled(context)
        val release = bundled.release
        val fixturePath = "teaching/${release.teaching}/classes/B240402.json"
        // A private test cache path avoids racing the visible Activity's download
        // of the selected class while still exercising the bundled-version branch.
        val path = "widget-test/cache/class.json"
        val file = File(context.filesDir, "campus/${release.version}/$path")
        val previous = if (file.isFile) file.readBytes() else null
        file.delete()
        val requests = AtomicInteger()
        try {
            val online = AcademicRepository(context, release) { address ->
                assertTrue(address.endsWith("/$path"))
                requests.incrementAndGet(); fixture(fixturePath)
            }
            val readers = List(4) { async(Dispatchers.IO) { online.read<ClassSchedule>(path) } }.awaitAll()
            assertEquals(1, requests.get())
            assertTrue(readers.all { it.klass.id == "B240402" })
            val offline = AcademicRepository(context, release) { throw FileNotFoundException("offline") }
            assertEquals(readers.first(), offline.read<ClassSchedule>(path))
            assertEquals(bundled.term(), offline.term())
            assertTrue(file.isFile)
            val other = AcademicRepository(context, release.copy(version = "widget-test-isolation", base = "/data/widget-test-isolation")) { throw FileNotFoundException("offline") }
            try { other.bytes(path); fail("Never mix release shards") } catch (e: DataUnavailableException) { assertTrue(e.message!!.contains("尚未下载")) }
            for (bad in listOf("../release.json", "space\\escape.json", "space/./places.json", "https://other.invalid/a", "/absolute", "x/%2e%2e/a")) {
                try { offline.bytes(bad); fail("Unsafe path: $bad") } catch (_: IllegalArgumentException) { }
            }
        } finally {
            if (previous == null) file.delete() else file.writeBytes(previous)
        }
    }

    @Test fun malformedDownloadDoesNotPoisonOfflineCache(): Unit = runBlocking {
        val release = AcademicRepository.bundled(context).release.copy(version = "widget-test-invalid", base = "/data/widget-test-invalid")
        val root = File(context.filesDir, "campus/${release.version}")
        try {
            val repo = AcademicRepository(context, release) { "<html>not deployed</html>".encodeToByteArray() }
            try { repo.bytes("teaching/term.json"); fail("Reject non-JSON responses") } catch (_: kotlinx.serialization.SerializationException) { }
            assertFalse(File(root, "teaching/term.json").exists())
        } finally {
            check(root.canonicalFile.parentFile == File(context.filesDir, "campus").canonicalFile)
            root.deleteRecursively()
        }
    }

    @Test fun localServerDownloadsActualShardsAndActivatesCurrentRelease(): Unit = runBlocking {
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("localData") == "true")
        assertTrue(BuildConfig.DATA_HOST.startsWith("http://127.0.0.1:"))
        val repo = checkNotNull(AcademicRepository.discover(context, "B240402"))
        assertEquals("B240402", repo.schedule("B240402").klass.id)
        assertEquals(repo.release.version, AcademicRepository.open(context).release.version)
        assertTrue(repo.rooms().rooms.isNotEmpty())
        val offline = AcademicRepository(context, repo.release) { throw FileNotFoundException("offline") }
        assertEquals(repo.schedule("B240402"), offline.schedule("B240402"))
        assertEquals(repo.exams("B240402"), offline.exams("B240402"))
    }

    @Test fun localServerUpdateKeepsPreviousCacheAndRejectsIncompleteRelease(): Unit = runBlocking {
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("localData") == "true")
        val previous = checkNotNull(AcademicRepository.discover(context, "B240402"))
        try {
            AcademicRepository.download("${BuildConfig.DATA_HOST}/__test_release?version=widget-test-update")
            val next = checkNotNull(AcademicRepository.discover(context, "B240402"))
            assertEquals("widget-test-update", next.release.version)
            assertEquals(next.release, AcademicRepository.open(context).release)
            val previousOffline = AcademicRepository(context, previous.release) { throw FileNotFoundException("offline") }
            assertEquals(previous.schedule("B240402"), previousOffline.schedule("B240402"))
            AcademicRepository.download("${BuildConfig.DATA_HOST}/__test_release?version=widget-test-missing&missing=true")
            assertNull(AcademicRepository.discover(context, "B240402"))
            assertEquals(next.release, AcademicRepository.open(context).release)
            val nextOffline = AcademicRepository(context, next.release) { throw FileNotFoundException("offline") }
            assertEquals(next.schedule("B240402"), nextOffline.schedule("B240402"))
        } finally {
            AcademicRepository.download("${BuildConfig.DATA_HOST}/__test_release")
            assertNotNull(AcademicRepository.discover(context, "B240402"))
            for (version in listOf("widget-test-update", "widget-test-missing")) {
                val directory = File(context.filesDir, "campus/$version")
                check(directory.canonicalFile.parentFile == File(context.filesDir, "campus").canonicalFile)
                directory.deleteRecursively()
            }
        }
    }

    @Test fun dormPickerAndRealKernelWalk(): Unit = runBlocking {
        wait("tab-me")
        compose.onNodeWithTag("tab-me").performClick(); wait("me")
        compose.onNodeWithTag("home-dorm").performScrollTo().performClick(); wait("dorm-query")
        compose.onNodeWithTag("dorm-query").performTextInput("荷苑48")
        compose.onNodeWithTag("dorm-荷苑48栋").performClick()
        assertEquals("荷苑48栋", CampusSettings(context).state.value.homeDorm)
        shot("home-dorm-picker")
        compose.activityRule.scenario.recreate(); wait("me")
        compose.onNodeWithTag("home-dorm").performScrollTo()
        compose.onNodeWithText("荷苑48栋").assertIsDisplayed()
        val campus = CampusPackage.load(context.assets)
        val walk = withContext(Dispatchers.IO) { Wayfind.load(context.assets).use {
            it.route(RouteRequest(campus.byId.getValue("荷苑48栋").routing, campus.byId.getValue("教4-208").routing, alternatives = 1)).first()
        } }
        assertTrue(walk.duration_s > 60)
        val directory = File(context.getExternalFilesDir(null), "widget-shots").apply { mkdirs() }
        File(directory, "walk.txt").writeText("荷苑48栋 → 教4-208: ${walk.distance_m} m, ${walk.duration_s} s, ${minutes(walk.duration_s)} min\n")
    }

    @Test fun compactWidgetPinsAndRendersOnHuaweiLauncher(): Unit = runBlocking {
        val manager = context.getSystemService(AppWidgetManager::class.java)
        val component = android.content.ComponentName(context, CompactLessonWidgetReceiver::class.java)
        if (manager.getAppWidgetIds(component).isEmpty()) {
            assertTrue(manager.isRequestPinAppWidgetSupported)
            assertTrue(manager.requestPinAppWidget(component, null, null))
            delay(1200)
            val info = instrumentation.uiAutomation.serviceInfo
            info.packageNames = null
            info.flags = info.flags or android.accessibilityservice.AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
            instrumentation.uiAutomation.serviceInfo = info
            compose.waitUntil(15000) {
                val root = instrumentation.uiAutomation.rootInActiveWindow
                listOf("添加到桌面", "添加到主屏幕", "添加", "Add", "Add automatically", "Add to home screen").any { label ->
                    root?.findAccessibilityNodeInfosByText(label)?.any { node ->
                        if (node.text?.toString() != label) false else {
                            var button: android.view.accessibility.AccessibilityNodeInfo? = node
                            while (button != null && !button.isClickable) button = button.parent
                            button?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK) == true
                        }
                    } == true
                }
            }
            compose.waitUntil(15000) { manager.getAppWidgetIds(component).isNotEmpty() }
        }
        val preferences = context.getSharedPreferences("campus-settings", Context.MODE_PRIVATE)
        val previousClass = preferences.getString("class", null)
        val previousDorm = preferences.getString("home-dorm", null)
        val previousTheme = preferences.getString("theme", "system")
        val repo = AcademicRepository.open(context)
        val fixtureRepo = AcademicRepository(context, repo.release) { url -> fixture(url.substringAfter(repo.release.base + "/")) }
        val events = CampusEvents.build(repo.term(), repo.periods(), fixtureRepo.schedule("B240402"), fixtureRepo.exams("B240402"))
        val lesson = events.first { !it.exam && it.room == "教4-208" }
        try {
            preferences.edit().putString("class", "B240402").putString("home-dorm", "荷苑48栋").apply()
            delay(2000)
            instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
            delay(1500); showWidget()
            for (theme in listOf("light", "dark")) {
                preferences.edit().putString("theme", theme).apply()
                CompactLessonWidget(Clock.fixed(lesson.start.minusSeconds(1800), ZoneOffset.UTC)).refreshAll(context, false)
                delay(2500); shot("launcher-4x1-$theme")
            }
        } finally {
            preferences.edit().putString("class", previousClass).putString("home-dorm", previousDorm).putString("theme", previousTheme).apply()
            CompactLessonWidget().refreshAll(context)
        }
    }

    /** Uses published lessons and a fixed display clock, never fake stored events or GPS.
     * Theme overrides affect studev only; the launcher's system settings are untouched. */
    @Test fun launcherWidgetBothThemesAndSizes(): Unit = runBlocking {
        val ids = GlanceAppWidgetManager(context).getGlanceIds(NextLessonWidget::class.java)
        assertTrue("Add studev's widget once before running this launcher check", ids.isNotEmpty())
        val preferences = context.getSharedPreferences("campus-settings", Context.MODE_PRIVATE)
        val previousClass = preferences.getString("class", null)
        val previousDorm = preferences.getString("home-dorm", null)
        val previousTheme = preferences.getString("theme", "system")
        val repo = AcademicRepository.open(context)
        val path = "teaching/${repo.release.teaching}/classes/B240402.json"
        val scheduleFile = File(context.filesDir, "campus/${repo.release.version}/$path")
        if (!scheduleFile.isFile) { scheduleFile.parentFile!!.mkdirs(); scheduleFile.writeBytes(fixture(path)) }
        val examPath = "exams/${repo.release.exams}/classes/B240402.json"
        val examFile = File(context.filesDir, "campus/${repo.release.version}/$examPath")
        if (!examFile.isFile) { examFile.parentFile!!.mkdirs(); examFile.writeBytes(fixture(examPath)) }
        val events = CampusEvents.build(repo.term(), repo.periods(), repo.schedule("B240402"), repo.exams("B240402"))
        val lesson = events.first { !it.exam && it.room == "教4-208" }
        val fixed = lesson.start.minusSeconds(30 * 60)
        val widgets = context.getSystemService(AppWidgetManager::class.java)
        val appIds = widgets.getAppWidgetIds(android.content.ComponentName(context, NextLessonWidgetReceiver::class.java))
        val options = appIds.associateWith { Bundle(widgets.getAppWidgetOptions(it)) }
        val notes = File(context.getExternalFilesDir(null), "widget-shots").apply { mkdirs() }
        File(notes, "capture.txt").writeText("Published lesson: ${lesson.title}; ${lesson.start}; ${lesson.room}\nFixed display clock: $fixed\nOriginal widget options: $options\n")
        try {
            preferences.edit().putString("class", "B240402").putString("home-dorm", "荷苑48栋").apply()
            instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
            Thread.sleep(1500)
            showWidget()
            for (theme in listOf("light", "dark")) {
                preferences.edit().putString("theme", theme).apply()
                NextLessonWidget(Clock.fixed(fixed, ZoneOffset.UTC)).refreshAll(context)
                compose.waitUntil(15000) { visibleText("出门") && visibleText("导航") && visibleText("课表") && visibleText("步行 18 分钟") }
                delay(3000); shot("launcher-next-lesson-$theme")
            }
            preferences.edit().putString("theme", "light").remove("home-dorm").apply()
            NextLessonWidget(Clock.fixed(fixed, ZoneOffset.UTC)).refreshAll(context)
            delay(2000); shot("launcher-choose-dorm")
            preferences.edit().putString("home-dorm", "荷苑48栋").apply()
            NextLessonWidget(Clock.fixed(lesson.start.minusSeconds(12 * 3600), ZoneOffset.UTC)).refreshAll(context)
            delay(2000); shot("launcher-tomorrow")
            NextLessonWidget(Clock.fixed(events.maxOf { it.end }.plusSeconds(2 * 86400), ZoneOffset.UTC)).refreshAll(context)
            compose.waitUntil(15000) { visibleText("今天和明天没有课") }
            delay(2000); shot("launcher-no-lessons")
            events.firstOrNull { it.exam }?.let { exam ->
                NextLessonWidget(Clock.fixed(exam.start.minusSeconds(3600), ZoneOffset.UTC)).refreshAll(context)
                delay(2000); shot("launcher-exam-day")
            }
        } finally {
            preferences.edit().putString("class", previousClass).putString("home-dorm", previousDorm).putString("theme", previousTheme).apply()
            NextLessonWidget().refreshAll(context)
        }
    }
}
