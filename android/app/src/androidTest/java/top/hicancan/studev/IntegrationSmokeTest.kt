package top.hicancan.studev

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.maps.MapView
import top.hicancan.studev.navigation.NavigationRuntime
import java.io.File

/** Read-only product smoke; safe on the owner's phone as well as the emulator. */
@RunWith(AndroidJUnit4::class)
class IntegrationSmokeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun wait(tag: String) = compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    private fun back() {
        compose.waitForIdle()
        instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
        compose.waitForIdle()
    }
    private fun backTo(tag: String) {
        repeat(4) {
            if (compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()) return
            back()
        }
        wait(tag)
    }
    private fun link(path: String) {
        compose.activityRule.scenario.onActivity {
            val launch = it.intent
            instrumentation.callActivityOnNewIntent(it, Intent(it, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("https://studev.hicancan.top/$path")))
            // ActivityScenario matches lifecycle callbacks to its original launch Intent.
            it.intent = launch
        }
    }
    private fun shot(name: String) {
        if (name == "route-planning") compose.waitUntil(30_000) {
            var rendered = false
            compose.activityRule.scenario.onActivity { activity ->
                fun find(view: View): MapView? {
                    if (view is MapView) return view
                    if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
                    return null
                }
                find(activity.window.decorView)?.let { view -> view.getMapAsync { map ->
                    rendered = map.style?.getLayer("route-chosen") != null && map.queryRenderedFeatures(
                        android.graphics.RectF(0f, 0f, view.width.toFloat(), view.height.toFloat()), "route-chosen").isNotEmpty()
                } }
            }
            rendered
        }
        compose.waitForIdle(); Thread.sleep(1600)
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(context.getExternalFilesDir(null), "integration-shots").apply { mkdirs() }.resolve("$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }
    @Test fun accountActivitiesReturnToTheSameCampusTab() {
        link("search/")
        wait("home")
        link("search/timetable/?class=B240402&week=5"); wait("timetable-week"); shot("timetable")
        compose.onNodeWithTag("tab-home").performClick(); wait("home"); shot("home-tab")
        compose.onNodeWithTag("tab-me").performClick(); wait("me"); shot("account-activities-entry")
        compose.onNodeWithTag("open-account").performClick()
        compose.onNodeWithText("账号", substring = false).assertIsDisplayed(); shot("account")
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText("账号", substring = false).assertIsDisplayed()
        back(); wait("me")
        compose.onNodeWithTag("open-activities").performClick(); wait("activity-host-activities"); shot("activities")
        compose.activityRule.scenario.recreate()
        wait("activity-host-activities")
        back(); wait("me")
        compose.onNodeWithTag("activity-host-activities").assertDoesNotExist()
        compose.onNodeWithTag("tab-timetable").performClick(); wait("timetable-week")
        back(); wait("home")
        compose.onNodeWithTag("tab-me").performClick(); wait("me")
        compose.onNodeWithTag("open-account").performClick(); wait("activity-host-account")
        link("map/?place=${Uri.encode("图书馆")}")
        compose.waitUntil(30_000) { compose.onAllNodesWithText("一周时间").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("activity-host-account").assertDoesNotExist()
        backTo("home-search"); back(); wait("home")
    }
    @Test fun mapHomeHoursPlanningAndBackShareOneShell() {
        wait("home")
        listOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION).forEach {
            instrumentation.uiAutomation.grantRuntimePermission(context.packageName, it)
        }
        val runtime = NavigationRuntime.get(context)
        try {
            compose.onNodeWithTag("tab-map").performClick(); wait("home-search"); shot("map-home-sheet")
            link("map/?place=${Uri.encode("图书馆")}")
            compose.waitUntil(30_000) { compose.onAllNodesWithText("一周时间").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("一周时间").performClick(); shot("place-with-hours")
            link("map/?place=${Uri.encode("教3")}")
            compose.waitUntil(20_000) { compose.onAllNodesWithText("一周时间").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithText("路线", useUnmergedTree = true).performClick()
            compose.onNodeWithTag("route-origin").performClick()
            compose.onNode(hasSetTextAction()).performTextInput("梅苑1栋")
            wait("place:梅苑1栋")
            compose.onNode(hasSetTextAction()).performImeAction()
            compose.onNodeWithTag("place:梅苑1栋").performClick()
            compose.waitUntil(30_000) { runtime.state.value.route != null && !runtime.state.value.busy }
            assertTrue(runtime.state.value.route!!.maneuvers.size >= 2)
            compose.onNodeWithText("开始导航").assertIsDisplayed(); shot("route-planning")
            back(); assertFalse(runtime.state.value.open)
            backTo("home-search")
            back(); wait("home")
        } finally { instrumentation.runOnMainSync { runtime.stop(close = true) } }
    }
}
