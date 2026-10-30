package top.hicancan.studev

import android.Manifest
import android.app.UiModeManager
import android.graphics.Bitmap
import android.os.Build
import android.os.SystemClock
import android.os.PowerManager
import android.view.View
import android.view.ViewGroup
import org.maplibre.android.maps.MapView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.home.CampusClock
import top.hicancan.studev.location.CampusLocation
import top.hicancan.studev.navigation.*
import java.io.File
import java.time.LocalDateTime

/** Reproducible slide captures; time overrides and route simulation never alter device clocks/GPS. */
@RunWith(AndroidJUnit4::class)
class PresentationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val runtime get() = NavigationRuntime.get(context)
    private fun main(action: () -> Unit) = instrumentation.runOnMainSync(action)
    private fun shell(command: String): String = instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes().toString(Charsets.UTF_8) }
    }
    private fun ready() { compose.waitUntil(30_000) { runCatching { compose.onAllNodesWithTag("home-search").fetchSemanticsNodes().isNotEmpty() }.getOrDefault(false) } }
    private fun buildingsReady() {
        compose.waitUntil(30_000) {
            var rendered = false
            compose.activityRule.scenario.onActivity { activity ->
                fun find(view: View): MapView? {
                    if (view is MapView) return view
                    if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
                    return null
                }
                find(activity.window.decorView)?.let { view -> view.getMapAsync { map ->
                    rendered = map.style?.getLayer("campus-building") != null && map.queryRenderedFeatures(android.graphics.RectF(0f, 0f, view.width.toFloat(), view.height.toFloat()), "campus-building").isNotEmpty()
                } }
            }
            rendered
        }
    }
    private fun time(hour: Int) = main { CampusClock.setDebugTime(LocalDateTime.of(2026, 10, 30, hour, if (hour == 7) 40 else 0)) }
    private fun prepare() {
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION).forEach {
            instrumentation.uiAutomation.grantRuntimePermission(context.packageName, it)
        }
        if (Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        ready()
        if (Build.VERSION.SDK_INT >= 31) { main { context.getSystemService(UiModeManager::class.java).setApplicationNightMode(UiModeManager.MODE_NIGHT_NO) }; Thread.sleep(1500) }
        main { runtime.stop(close = true) }; ready(); time(7)
    }
    private fun restore() {
        main { runtime.stop(close = true); CampusClock.setDebugTime(null) }
        if (Build.VERSION.SDK_INT >= 31) main { context.getSystemService(UiModeManager::class.java).setApplicationNightMode(UiModeManager.MODE_NIGHT_AUTO) }
    }
    private fun shot(name: String) {
        compose.waitForIdle(); Thread.sleep(1800); compose.waitForIdle()
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(context.getExternalFilesDir(null), "shots").apply { mkdirs() }.resolve("$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }; bitmap.recycle()
    }
    private fun search(query: String, capture: Boolean = false) {
        compose.onNodeWithText("搜索地点、楼栋或教室").performClick()
        compose.onNode(hasSetTextAction()).performTextInput(query)
        compose.waitUntil(20_000) { compose.onAllNodesWithTag("place:$query").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction()).performImeAction()
        if (capture) shot("search")
        compose.onNodeWithTag("place:$query").performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("关闭地点").fetchSemanticsNodes().isNotEmpty() }
    }
    @Test fun homeAndFacts() {
        try {
            prepare(); shot("home-morning")
            assertTrue(compose.onAllNodesWithText("热门推荐").fetchSemanticsNodes().isNotEmpty())
            time(12); shot("home-lunch")
            compose.onNodeWithTag("category:食堂").performClick(); shot("category-canteen")
            compose.onNodeWithContentDescription("返回热门推荐").performClick()
            search("教3", capture = true)
            compose.onNodeWithText("地点详情").performClick(); shot("place-jiao3")
            compose.onNodeWithContentDescription("关闭地点").performClick()
            search("图书馆")
            compose.onNodeWithText("地点详情").performClick(); shot("place-library")
            compose.onNodeWithText("一周时间").performClick(); shot("place-library-week")
            compose.onNodeWithContentDescription("关闭地点").performClick()
            time(7)
            compose.onNodeWithContentDescription("切换三维地图").performClick(); shot("map-3d")
            compose.onNodeWithContentDescription("切换二维地图").performClick()
            if (Build.VERSION.SDK_INT >= 31) {
                main { context.getSystemService(UiModeManager::class.java).setApplicationNightMode(UiModeManager.MODE_NIGHT_YES) }; ready(); buildingsReady(); shot("map-dark")
            }
        } finally { restore() }
    }
    @Test fun phoneHomeAndPlanner() {
        try {
            prepare(); Thread.sleep(10_000)
            val fix = CampusLocation.get(context).fix.value
            File(context.getExternalFilesDir(null), "phone-location.txt").writeText(if (fix == null) "No provider fix; distances explicitly use campus centre." else "Real provider fix; age_ms=${SystemClock.elapsedRealtime() - fix.timestamp}; accuracy_m=${fix.accuracy}")
            shot("phone-home-morning")
            time(12); shot("phone-home-lunch")
            search("教3")
            compose.onNodeWithText("路线", useUnmergedTree = true).performClick()
            Thread.sleep(3000); main { runtime.plan() }
            compose.waitUntil(20_000) { !runtime.state.value.busy }; shot("phone-planner-walk")
            assertNull(runtime.state.value.origin)
            compose.onNodeWithText("骑行").performClick()
            compose.waitUntil(20_000) { !runtime.state.value.busy }; shot("phone-planner-bike")
        } finally { restore() }
    }
    @Test fun threeDimensionalMap() {
        try {
            prepare(); search("图书馆")
            Thread.sleep(2000)
            compose.onNodeWithContentDescription("关闭地点").performClick()
            ready(); Thread.sleep(2000)
            compose.onNodeWithContentDescription("切换三维地图").performClick()
            compose.waitUntil(15_000) {
                var tilted = false
                compose.activityRule.scenario.onActivity { activity ->
                    fun find(view: View): MapView? {
                        if (view is MapView) return view
                        if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
                        return null
                    }
                    find(activity.window.decorView)?.getMapAsync { tilted = it.cameraPosition.tilt > 50 }
                }
                tilted
            }
            Thread.sleep(2000); shot("map-3d")
        } finally { restore() }
    }
    @Test fun darkMap() {
        try {
            prepare(); search("图书馆"); Thread.sleep(2000)
            compose.onNodeWithContentDescription("关闭地点").performClick(); ready()
            if (Build.VERSION.SDK_INT >= 31) {
                main { context.getSystemService(UiModeManager::class.java).setApplicationNightMode(UiModeManager.MODE_NIGHT_YES) }
                Thread.sleep(1500); ready(); buildingsReady(); Thread.sleep(1500); shot("map-dark")
            }
        } finally { restore() }
    }
    @Test fun notificationAfterScreenOff() = runBlocking {
        org.junit.Assume.assumeTrue("Emulator-only screen controls", Build.HARDWARE in listOf("ranchu", "goldfish"))
        try {
            prepare()
            val campus = CampusPackage.load(context.assets)
            main { runtime.open(campus.byId.getValue("教3")); runtime.origin(campus.byId.getValue("梅苑1栋")) }
            compose.waitUntil(20_000) { runtime.state.value.route != null && !runtime.state.value.busy }
            main { runtime.start(true, 1.0) }
            compose.waitUntil(15_000) { runtime.state.value.trip.update != null }
            main { runtime.debugCommand("pause") }
            shell("input keyevent 223"); Thread.sleep(4000)
            assertFalse(context.getSystemService(PowerManager::class.java).isInteractive)
            File(context.getExternalFilesDir(null), "screen-off-power.txt").writeText(shell("dumpsys power"))
            File(context.getExternalFilesDir(null), "screen-off-service.txt").writeText(shell("dumpsys activity services top.hicancan.studev"))
            assertTrue(context.getSystemService(android.app.NotificationManager::class.java).activeNotifications.any { it.id == NavigationService.ID })
            shell("input keyevent 224"); shell("wm dismiss-keyguard")
            val until = SystemClock.elapsedRealtime() + 10_000
            while (!context.getSystemService(PowerManager::class.java).isInteractive && SystemClock.elapsedRealtime() < until) Thread.sleep(100)
            assertTrue(context.getSystemService(PowerManager::class.java).isInteractive)
            Thread.sleep(1500); shell("input keyevent 82"); shell("cmd statusbar expand-notifications"); Thread.sleep(2000)
            if (InstrumentationRegistry.getArguments().getString("captureHold") == "true") {
                File(context.getExternalFilesDir(null), "notification-ready.txt").writeText("ready")
                Thread.sleep(20_000)
            }
            val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
            File(context.getExternalFilesDir(null), "shots/notification-screen-off.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
            shell("cmd statusbar collapse")
        } finally { shell("input keyevent 224"); shell("cmd statusbar collapse"); restore() }
        Unit
    }
    @Test fun continuousDemo() = runBlocking {
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("demo") == "true")
        try {
            prepare(); time(7)
            val start = SystemClock.elapsedRealtime()
            val timeline = mutableListOf<String>()
            fun mark(text: String) { timeline += "${(SystemClock.elapsedRealtime() - start) / 1000}s $text" }
            File(context.getExternalFilesDir(null), "demo-ready.txt").writeText(System.currentTimeMillis().toString())
            mark("首页 · 早晨推荐"); Thread.sleep(6000)
            search("教3"); mark("搜索教3 → 地点用途与楼层"); Thread.sleep(3000)
            compose.onNodeWithText("地点详情").performClick(); Thread.sleep(2000)
            compose.onNodeWithText("路线", useUnmergedTree = true).performClick()
            compose.onNodeWithTag("route-origin").performClick()
            compose.onNode(hasSetTextAction()).performTextInput("梅苑1栋")
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("place:梅苑1栋").fetchSemanticsNodes().isNotEmpty() }
            compose.onNode(hasSetTextAction()).performImeAction(); compose.onNodeWithTag("place:梅苑1栋").performClick()
            compose.waitUntil(20_000) { !runtime.state.value.busy && runtime.state.value.route != null }
            mark("步行备选路线 · 梅苑1栋 → 教3"); Thread.sleep(4000)
            if (runtime.state.value.routes.size > 1) { compose.onNodeWithTag("route-card:1").performClick(); Thread.sleep(2000); compose.onNodeWithTag("route-card:0").performClick() }
            compose.onNodeWithText("路线详情").performClick(); mark("转向步骤"); Thread.sleep(2000)
            compose.onNodeWithContentDescription("关闭路线详情").performClick()
            main { runtime.start(true, 3.0) }; mark("开始导航 · 模拟步行，3倍速"); Thread.sleep(10000)
            main { runtime.debugCommand("detour") }; mark("故意偏航");
            compose.waitUntil(20_000) { runtime.state.value.trip.reroutes > 0 }
            mark("自动重新规划路线"); Thread.sleep(6000)
            main { runtime.debugCommand("arrive") }
            compose.waitUntil(15_000) { runtime.state.value.trip.phase == TripPhase.Arrived }
            compose.onNodeWithText("已到达 教3").assertIsDisplayed()
            mark("到达教3 · 到达卡"); Thread.sleep(6000)
            File(context.getExternalFilesDir(null), "demo-timeline.txt").writeText(timeline.joinToString("\n"))
            File(context.getExternalFilesDir(null), "demo-done.txt").writeText(System.currentTimeMillis().toString())
            assertTrue(runtime.state.value.trip.phase == TripPhase.Arrived)
        } finally { restore() }
        Unit
    }
}
