package top.hicancan.studev

import android.Manifest
import android.app.UiModeManager
import android.os.Build
import android.content.Intent
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.style.sources.GeoJsonSource
import android.content.Context
import android.graphics.Bitmap
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
import top.hicancan.studev.search.CampusSearch
import java.io.File

@RunWith(AndroidJUnit4::class)
class MapSmokeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private fun shot(name: String) {
        compose.waitForIdle()
        // MapLibre renders outside Compose's idling resource; allow glyph/camera frames to settle.
        Thread.sleep(1800)
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        val directory = File(context.getExternalFilesDir(null), "shots").apply { mkdirs() }
        File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private fun withMap(action: (MapLibreMap) -> Unit) {
        compose.activityRule.scenario.onActivity { activity ->
            fun find(view: View): MapView? {
                if (view is MapView) return view
                if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
                return null
            }
            checkNotNull(find(activity.window.decorView)).getMapAsync(action)
        }
    }
    private fun waitForMap() {
        compose.waitUntil(15000) { compose.onAllNodesWithText("搜索地点、楼栋或教室").fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
    }
    @Test fun nativeSearchUsesThePackagedProtocol() = runBlocking {
        val campus = CampusPackage.load(context.assets)
        CampusSearch(context.assets).use { search ->
            val teaching = search.search("教3", campus)
            assertTrue(teaching.any { it.id == "教3" })
            assertTrue(search.search("教3-101", campus).any { it.id == "教3-101" })
            assertTrue(search.search("图书馆", campus).any { it.id.contains("图书馆") })
            assertTrue(search.search("zzzxqv9999", campus).isEmpty())
        }
    }
    @Test fun mapSearchAndPlaceSheet() {
        compose.waitUntil(15000) { compose.onAllNodesWithText("搜索地点、楼栋或教室").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("搜索地点、楼栋或教室").performClick()
        compose.onNode(hasSetTextAction()).performTextInput("教3")
        compose.mainClock.advanceTimeBy(500)
        try {
            compose.waitUntil(15000) { compose.onAllNodesWithTag("place:教3").fetchSemanticsNodes().isNotEmpty() }
        } finally { compose.waitForIdle() }
        compose.onNode(hasSetTextAction()).performImeAction()
        shot("search-jiao3")
        compose.onNodeWithTag("place:教3").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithContentDescription("关闭地点").fetchSemanticsNodes().isNotEmpty() }
        shot("place-jiao3")
        withMap { map -> assertEquals(true, map.style!!.getSourceAs<GeoJsonSource>("places")!!.getFeatureState("教3")?.get("selected")?.asBoolean) }
        compose.onNodeWithText("地点详情").performClick()
        shot("place-jiao3-half")
        compose.onNodeWithText("地点详情").performClick()
        shot("place-jiao3-expanded")
        val wasSaved = compose.onAllNodesWithText("已收藏", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        val before = if (wasSaved) "已收藏" else "收藏"
        val after = if (wasSaved) "收藏" else "已收藏"
        compose.onNodeWithText(before, useUnmergedTree = true).performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithText(after, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(after, useUnmergedTree = true).performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithText(before, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("关闭地点").performClick()
        compose.onNodeWithText("搜索地点、楼栋或教室").performClick()
        compose.onNode(hasSetTextAction()).performTextReplacement("图书馆")
        compose.mainClock.advanceTimeBy(500)
        compose.waitUntil(15000) { compose.onAllNodesWithTag("place:图书馆").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction()).performImeAction()
        shot("search-library")
        compose.onNodeWithContentDescription("返回地图").performClick()
        shot("map-light")
        compose.onNodeWithContentDescription("切换三维地图").performClick()
        shot("map-3d")
        compose.onNodeWithContentDescription("切换二维地图").performClick()
    }
    @Test fun themeLocationAndDeepLink() {
        waitForMap()
        val modes = context.getSystemService(UiModeManager::class.java)
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                compose.runOnUiThread { modes.setApplicationNightMode(UiModeManager.MODE_NIGHT_NO) }
                Thread.sleep(1200)
                waitForMap()
            }
            shot("map-light")
            if (Build.VERSION.SDK_INT >= 31) {
                compose.runOnUiThread { modes.setApplicationNightMode(UiModeManager.MODE_NIGHT_YES) }
                Thread.sleep(1200)
                waitForMap()
                shot("map-dark")
                compose.runOnUiThread { modes.setApplicationNightMode(UiModeManager.MODE_NIGHT_NO) }
                Thread.sleep(1200)
                waitForMap()
            }
            val link = Uri.Builder().scheme("https").authority("studev.hicancan.top").path("/map/")
                .appendQueryParameter("place", "教3").build()
            compose.activityRule.scenario.onActivity { activity ->
                val launchIntent = activity.intent
                instrumentation.callActivityOnNewIntent(activity, Intent(activity, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(link))
                // ActivityScenario identifies its Activity by the original launch Intent.
                activity.intent = launchIntent
            }
            compose.waitUntil(10000) { compose.onAllNodesWithContentDescription("关闭地点").fetchSemanticsNodes().isNotEmpty() }
            compose.activityRule.scenario.recreate()
            compose.waitUntil(10000) { compose.onAllNodesWithContentDescription("关闭地点").fetchSemanticsNodes().isNotEmpty() }
            shot("deep-link-restored")
            compose.onNodeWithContentDescription("关闭地点").performClick()
            if (Build.VERSION.SDK_INT >= 28) {
                instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.ACCESS_COARSE_LOCATION)
                instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.ACCESS_FINE_LOCATION)
                compose.activityRule.scenario.recreate()
                waitForMap()
                compose.onNodeWithContentDescription("定位", substring = false).performClick()
                compose.waitUntil(5000) { compose.onAllNodesWithContentDescription("跟随位置").fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithContentDescription("跟随位置").performClick()
                compose.onNodeWithContentDescription("跟随朝向").assertExists()
                var centered = false
                var details = ""
                try { compose.waitUntil(10000) {
                    withMap { map ->
                        val fix = map.locationComponent.lastKnownLocation
                        if (fix != null) {
                            val at = map.cameraPosition.target!!
                            val distance = FloatArray(1)
                            android.location.Location.distanceBetween(fix.latitude, fix.longitude, at.latitude, at.longitude, distance)
                            details = "mode=${map.locationComponent.cameraMode}, distance=${distance[0]}, accuracy=${fix.accuracy}, target=$at, fix=${fix.latitude},${fix.longitude}"
                            centered = distance[0] < maxOf(20f, fix.accuracy) && map.locationComponent.cameraMode == org.maplibre.android.location.modes.CameraMode.TRACKING_COMPASS
                        }
                    }
                    centered
                } } catch (e: androidx.compose.ui.test.ComposeTimeoutException) { shot("location-debug"); throw AssertionError(details, e) }
                shot("location-heading")
            }
        } finally {
            if (Build.VERSION.SDK_INT >= 31) compose.runOnUiThread { modes.setApplicationNightMode(UiModeManager.MODE_NIGHT_AUTO) }
        }
    }
}
