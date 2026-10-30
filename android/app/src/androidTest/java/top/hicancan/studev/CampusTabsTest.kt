package top.hicancan.studev

import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.FixMethodOrder
import org.junit.runners.MethodSorters
import top.hicancan.studev.calendar.TimetableCalendar
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.navigation.NavigationRuntime
import top.hicancan.studev.navigation.Wayfind
import top.hicancan.studev.navigation.RouteRequest
import top.hicancan.studev.navigation.Endpoint
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.RoomIndex
import top.hicancan.studev.reminders.*
import top.hicancan.studev.search.AcademicSearch
import top.hicancan.studev.timetable.*
import top.hicancan.studev.widget.NextLessonWidget
import java.io.File
import java.time.Instant

@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class CampusTabsTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun wait(tag: String) { compose.waitUntil(25000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }; compose.waitForIdle() }
    private fun shot(name: String) {
        compose.waitForIdle(); Thread.sleep(700)
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        val directory = File(context.getExternalFilesDir(null), "campus-shots").apply { mkdirs() }
        File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    }
    private fun link(path: String) { compose.activityRule.scenario.onActivity {
        val launch = it.intent
        val incoming = Intent(it, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://studev.hicancan.top/$path"))
        instrumentation.callActivityOnNewIntent(it, incoming)
        // ActivityScenario tracks the launch Intent across theme recreation.
        it.intent = launch
    } }
    private fun selectClass() {
        wait("tab-home")
        link("search/timetable/?class=B240402")
        wait("timetable-week")
        compose.waitUntil(15000) { compose.onAllNodes(SemanticsMatcher("a lesson") { it.config.getOrElse(androidx.compose.ui.semantics.SemanticsProperties.TestTag) { "" }.startsWith("lesson-") }).fetchSemanticsNodes().isNotEmpty() }
    }
    @Test fun tabsDeepLinksAndNativeScreensInBothThemes() {
        val manager = context.getSystemService(UiModeManager::class.java)
        try {
            selectClass()
            for ((mode, suffix) in listOf(UiModeManager.MODE_NIGHT_NO to "light", UiModeManager.MODE_NIGHT_YES to "dark")) {
                compose.activityRule.scenario.onActivity { manager.setApplicationNightMode(mode) }
                // Let Activity recreation replace the old window before awaiting its frames.
                Thread.sleep(1200); compose.waitForIdle()
                link("search/"); wait("home"); shot("home-$suffix")
                compose.onNodeWithTag("tab-timetable").performClick(); wait("timetable-week"); shot("timetable-week-$suffix")
                compose.onNodeWithTag("day-view").performClick(); wait("timetable-day"); shot("timetable-day-$suffix")
                compose.onNodeWithTag("week-view").performClick()
                val matcher = SemanticsMatcher("a lesson") { it.config.getOrElse(androidx.compose.ui.semantics.SemanticsProperties.TestTag) { "" }.startsWith("lesson-") }
                compose.onAllNodes(matcher).onFirst().performClick(); wait("lesson-detail"); shot("lesson-detail-$suffix")
                instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
                link("search/exam/?class=B240402"); wait("exams"); shot("exams-$suffix")
                link("search/classrooms/?building=教3&date=2026-10-30&period=3"); wait("rooms"); Thread.sleep(1000); shot("free-rooms-$suffix")
                link("search/web/?q=奖学金"); wait("academic-search"); wait("search-results"); shot("search-$suffix")
                compose.onNodeWithTag("tab-me").performClick(); wait("me")
                compose.onNodeWithText("系统日历同步").performScrollTo().performClick(); wait("calendar-settings"); shot("calendar-sync-$suffix")
                compose.onNodeWithTag("tab-map").performClick()
                compose.waitUntil(20000) { compose.onAllNodesWithText("搜索地点、楼栋或教室").fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithTag("tab-home").performClick(); wait("home")
            }
        } finally { compose.activityRule.scenario.onActivity { manager.setApplicationNightMode(UiModeManager.MODE_NIGHT_AUTO) } }
    }
    @Test fun calendarResyncDoesNotDuplicateAndOptOutRemovesItsCalendar() = runBlocking {
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, android.Manifest.permission.READ_CALENDAR)
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, android.Manifest.permission.WRITE_CALENDAR)
        val repository = AcademicRepository.open(context)
        val events = CampusEvents.build(repository.term(), repository.periods(), repository.schedule("B240402"), repository.exams("B240402"))
        fun ids(): List<Long> = buildList { context.contentResolver.query(android.provider.CalendarContract.Events.CONTENT_URI, arrayOf("_id"), "_sync_id LIKE ?", arrayOf("lesson:%"), "_id")?.use { while (it.moveToNext()) add(it.getLong(0)) } }
        selectClass()
        compose.onNodeWithTag("tab-me").performClick(); wait("me")
        compose.onNodeWithText("系统日历同步").performScrollTo().performClick(); wait("calendar-settings")
        if (CampusSettings(context).state.value.calendar) {
            compose.onNode(isToggleable()).performClick()
            compose.waitUntil(15000) { !CampusSettings(context).state.value.calendar && ids().isEmpty() }
        }
        compose.onNode(isToggleable()).performClick()
        compose.waitUntil(15000) { CampusSettings(context).state.value.calendar && ids().size == events.count { !it.exam } }
        val first = ids(); assertTrue(first.isNotEmpty()); TimetableCalendar.sync(context, events); assertEquals(first, ids())
        shot("calendar-sync-enabled")
        compose.onNode(isToggleable()).performClick()
        compose.waitUntil(15000) { !CampusSettings(context).state.value.calendar && ids().isEmpty() }
    }
    @Test fun nativeContentSearchUsesTheWebPackage() = runBlocking {
        AcademicSearch(AcademicRepository.open(context)).use { search ->
            val result = search.search("奖学金")
            assertTrue(result.isNotEmpty()); assertTrue(result.all { it.title.isNotBlank() && it.url.startsWith("https://") })
            assertTrue(search.search("zzzxqv9999").isEmpty())
        }
    }
    @Test fun nextLessonWalkingTimeUsesTheNativeRouter() = runBlocking {
        val campus = CampusPackage.load(context.assets)
        Wayfind.load(context.assets).use { engine ->
            val routes = engine.route(RouteRequest(Endpoint.Position(listOf(118.9255, 32.1150)), campus.byId.getValue("教4-208").routing, alternatives = 1))
            assertTrue(routes.isNotEmpty()); assertTrue(routes.first().duration_s > 0)
        }
    }
    @Test fun shardCacheWorksOfflineAndNeverMixesReleases() = runBlocking {
        val bundled = AcademicRepository.bundled(context)
        val release = bundled.release.copy(version = "test-${System.nanoTime()}", base = "/data/test-placeholder")
            .let { it.copy(base = "/data/${it.version}") }
        val fixture = context.assets.open("data/rooms/index.json").use { it.readBytes() }
        val requests = java.util.concurrent.atomic.AtomicInteger()
        val fetch: (String) -> ByteArray = { url ->
            assertEquals("https://studev.hicancan.top${release.base}/rooms/index.json", url)
            requests.incrementAndGet(); fixture
        }
        val readers = listOf(AcademicRepository(context, release, fetch), AcademicRepository(context, release, fetch))
        val root = File(context.filesDir, "campus/${release.version}")
        try {
            val results = (0..7).map { index -> async(Dispatchers.IO) { readers[index % 2].read<RoomIndex>("rooms/index.json") } }.awaitAll()
            assertTrue(requests.get() in 1..2); assertTrue(results.all { it == results.first() })
            val offline = AcademicRepository(context, release) { throw java.io.FileNotFoundException("offline") }
            assertEquals(results.first(), offline.rooms())
            try { offline.term(); fail("A missing remote shard must not use the bundled term") } catch (_: java.io.FileNotFoundException) { }
        } finally {
            check(root.canonicalFile.parentFile == File(context.filesDir, "campus").canonicalFile)
            root.deleteRecursively()
        }
    }
    @Test fun classPickerRemembersTheChoiceAndHomeCanStartNavigation() {
        val runtime = NavigationRuntime.get(context)
        try {
            selectClass()
            compose.onNodeWithTag("tab-me").performClick(); wait("me")
            compose.onNodeWithText("B240402").performClick(); wait("class-query")
            compose.onNodeWithTag("class-query").performTextInput("B240403")
            wait("class-B240403"); compose.onNodeWithTag("class-B240403").performClick()
            compose.waitUntil(10000) { CampusSettings(context).state.value.klass == "B240403" }
            compose.activityRule.scenario.recreate(); wait("me")
            compose.onNodeWithText("B240403").assertIsDisplayed()
            link("search/timetable/?class=B240402"); wait("timetable-week")
            link("search/"); wait("home")
            instrumentation.uiAutomation.grantRuntimePermission(context.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
            val nextRoom = runBlocking {
                val repo = AcademicRepository.open(context)
                CampusEvents.build(repo.term(), repo.periods(), repo.schedule("B240402"), emptyList()).firstOrNull { it.start > Instant.now() }?.room
            }
            org.junit.Assume.assumeNotNull(nextRoom)
            compose.waitUntil(20000) { runtime.location.fix.value?.let { android.os.SystemClock.elapsedRealtime() - it.timestamp in 0..30000 } == true }
            compose.onNodeWithText("现在出发").performClick()
            compose.waitUntil(20000) { runtime.state.value.active }
            assertEquals(nextRoom, runtime.state.value.destination?.id)
            shot("next-lesson-navigation")
        } finally { compose.activityRule.scenario.onActivity { runtime.stop(close = true) } }
    }
    @Test fun reminderNotificationAndRoomNavigation() = runBlocking {
        wait("home")
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
        val now = Instant.now()
        val repository = AcademicRepository.open(context)
        val room = repository.rooms().rooms.first { it.id.contains("教3-601") }.id
        val event = CampusEvent("test-notification-${now.epochSecond}", "算法与数据结构", now.plusSeconds(68), now.plusSeconds(3600), room, room, "提醒调度验证", false)
        LessonReminders.sync(context, listOf(event), true, 1)
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        compose.waitUntil(30000) { manager.activeNotifications.any { it.id == event.id.hashCode() } }
        val notification = manager.activeNotifications.first { it.id == event.id.hashCode() }.notification
        assertEquals("导航到 $room", notification.actions.first().title.toString())
        instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS)
        Thread.sleep(1600)
        shot("reminder-notification")
        instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
        val launchIntent = compose.activity.intent
        notification.actions.first().actionIntent.send()
        compose.waitUntil(15000) { NavigationRuntime.get(context).state.value.destination?.id == room }
        assertTrue(NavigationRuntime.get(context).state.value.open)
        compose.activityRule.scenario.onActivity { it.intent = launchIntent; NavigationRuntime.get(context).stop(close = true) }
        manager.cancel(event.id.hashCode()); LessonReminders.sync(context, emptyList(), false, 15)
    }
    @Test fun widgetPinOnLauncher() {
        selectClass()
        val existing = runBlocking { androidx.glance.appwidget.GlanceAppWidgetManager(context).getGlanceIds(NextLessonWidget::class.java) }
        if (existing.isNotEmpty()) {
            instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
            Thread.sleep(2000); shot("widget-launcher")
            return
        }
        compose.onNodeWithTag("tab-me").performClick(); wait("me")
        compose.onNodeWithText("添加到桌面").performScrollTo().performClick()
        Thread.sleep(1200); shot("widget-pin-dialog")
        var accepted = false
        val deadline = System.currentTimeMillis() + 15000
        while (!accepted && System.currentTimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            for (label in listOf("Add to home screen", "Add automatically", "Add", "添加到主屏幕", "添加")) {
                root?.findAccessibilityNodeInfosByText(label)?.forEach { node ->
                    if (accepted || node.text?.toString() != label) return@forEach
                    var button: android.view.accessibility.AccessibilityNodeInfo? = node
                    while (button != null && !button.isClickable) button = button.parent
                    if (button?.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK) == true) accepted = true
                }
            }
            if (!accepted) Thread.sleep(500)
        }
        assertTrue("The launcher's widget pin confirmation was not found", accepted)
        compose.waitUntil(15000) { runBlocking { androidx.glance.appwidget.GlanceAppWidgetManager(context).getGlanceIds(NextLessonWidget::class.java).isNotEmpty() } }
        instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
        Thread.sleep(2500); shot("widget-launcher")
    }
}
