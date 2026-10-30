package top.hicancan.studev

import android.Manifest
import android.graphics.Bitmap
import android.os.Build
import android.view.View
import android.view.ViewGroup
import org.maplibre.android.maps.MapView
import org.maplibre.android.geometry.LatLng
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.navigation.*
import java.io.File

@RunWith(AndroidJUnit4::class)
class NavigationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val runtime get() = NavigationRuntime.get(context)
    private fun permissions() {
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION).forEach {
            instrumentation.uiAutomation.grantRuntimePermission(context.packageName, it)
        }
        if (Build.VERSION.SDK_INT >= 33) instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
    }
    private fun shot(name: String, app: Boolean = true) {
        if (app) compose.waitForIdle()
        Thread.sleep(1800)
        if (app) compose.waitForIdle()
        if (app && name.startsWith("planner") && runtime.state.value.route != null) {
            compose.waitUntil(15_000) {
                var loaded = false
                compose.activityRule.scenario.onActivity { activity ->
                    fun find(view: View): MapView? {
                        if (view is MapView) return view
                        if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
                        return null
                    }
                    find(activity.window.decorView)?.getMapAsync { map ->
                        val endpointLayer = map.style?.getLayerAs<org.maplibre.android.style.layers.CircleLayer>("route-endpoints")
                        val source = endpointLayer?.let { map.style?.getSourceAs<org.maplibre.android.style.sources.GeoJsonSource>(it.sourceId) }
                        val labels = source?.querySourceFeatures(null)?.map { it.getStringProperty("label") }.orEmpty()
                        loaded = labels.contains(runtime.state.value.origin?.id ?: "起点") && labels.contains(runtime.state.value.destinationName)
                    }
                }
                loaded
            }
        }
        if (app) compose.activityRule.scenario.onActivity { activity ->
            fun find(view: View): MapView? {
                if (view is MapView) return view
                if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
                return null
            }
            find(activity.window.decorView)?.let { view -> view.getMapAsync { map ->
                val points = runtime.state.value.route?.geometry?.map { map.projection.toScreenLocation(LatLng(it[1], it[0])) }
                val fix = runtime.state.value.trip.update?.matched_position?.let { map.projection.toScreenLocation(LatLng(it[1], it[0])) }
                File(context.getExternalFilesDir(null), "camera-$name.txt").writeText("size=${view.width}x${view.height}\ncamera=${map.cameraPosition}\npoints=$points\nfix=$fix")
                val layer = map.style?.getLayerAs<org.maplibre.android.style.layers.LineLayer>("route-chosen")
                android.util.Log.d("StudevCamera", "audit $name source=${layer?.sourceId} rendered=${map.queryRenderedFeatures(android.graphics.RectF(0f,0f,view.width.toFloat(),view.height.toFloat()), "route-chosen").size}")
                if (name.startsWith("planner") && runtime.state.value.route != null) {
                    val endpointLayer = map.style!!.getLayerAs<org.maplibre.android.style.layers.CircleLayer>("route-endpoints")!!
                    val endpointSource = map.style!!.getSourceAs<org.maplibre.android.style.sources.GeoJsonSource>(endpointLayer.sourceId)!!
                    val labels = endpointSource.querySourceFeatures(null).map { it.getStringProperty("label") }.toSet()
                    assertTrue("Planner endpoint labels are stale: $labels", labels.contains(runtime.state.value.origin?.id ?: "起点"))
                }
            } }
        }
        val bitmap = checkNotNull(instrumentation.uiAutomation.takeScreenshot())
        val dir = File(context.getExternalFilesDir(null), "shots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    private fun main(action: () -> Unit) { instrumentation.runOnMainSync(action) }
    private fun ready() {
        compose.waitUntil(20_000) { compose.onAllNodesWithTag("tab-map").fetchSemanticsNodes().isNotEmpty() || compose.onAllNodesWithText("搜索地点、楼栋或教室").fetchSemanticsNodes().isNotEmpty() }
        if (compose.onAllNodesWithText("搜索地点、楼栋或教室").fetchSemanticsNodes().isEmpty()) compose.onNodeWithTag("tab-map").performClick()
        compose.waitUntil(20_000) { compose.onAllNodesWithText("搜索地点、楼栋或教室").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun search(query: String) {
        compose.onNode(hasSetTextAction()).performTextInput(query)
        compose.waitUntil(20_000) { compose.onAllNodesWithTag("place:$query").fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(hasSetTextAction()).performImeAction()
        compose.onNodeWithTag("place:$query").performClick()
    }
    private fun plan(origin: String, destination: String) {
        permissions(); ready()
        compose.onNodeWithText("搜索地点、楼栋或教室").performClick(); search(destination)
        compose.onNodeWithText("路线", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("route-origin").performClick(); search(origin)
        compose.waitUntil(20_000) { runtime.state.value.route != null && !runtime.state.value.busy }
        assertTrue(runtime.state.value.route!!.maneuvers.size >= 2)
        compose.onNodeWithText("开始导航").assertIsDisplayed()
    }
    @Test fun walkingPlannerAndSimulator() {
        try {
            plan("梅苑1栋", "教3")
            shot("planner-walk-alternatives")
            val selected = runtime.state.value.route!!
            File(context.getExternalFilesDir(null), "route-walk.json").writeText(Json.encodeToString(selected))
            if (runtime.state.value.routes.size > 1) {
                compose.onNodeWithTag("route-card:1").performClick()
                assertEquals(1, runtime.state.value.selected)
                compose.onNodeWithTag("route-card:0").performClick()
            }
            compose.onNodeWithText("路线详情").performClick(); shot("steps-walk")
            compose.onNodeWithContentDescription("关闭路线详情").performClick()
            compose.waitUntil(5000) { compose.onAllNodesWithTag("route-steps").fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithContentDescription("调试菜单").performClick()
            compose.waitUntil(5000) { compose.onAllNodesWithText("模拟走一遍 · 20 倍速").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("模拟走一遍 · 20 倍速").performClick()
            compose.waitUntil(15_000) { runtime.state.value.trip.update != null }
            Thread.sleep(5500)
            main { runtime.debugCommand("pause"); runtime.notice(null) }
            shot("navigation-walk-mid-route")
            val center = compose.onRoot().fetchSemanticsNode().boundsInRoot.center
            instrumentation.uiAutomation.executeShellCommand("input swipe ${center.x.toInt()} ${center.y.toInt()} ${(center.x + 180).toInt()} ${(center.y + 80).toInt()} 500").use { descriptor ->
                android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
            }
            shot("navigation-panned")
            compose.onNodeWithText("回到当前位置").assertIsDisplayed().performClick()
            compose.onNodeWithContentDescription("静音").performClick()
            assertTrue(runtime.state.value.muted)
            compose.onNodeWithContentDescription("开启语音").performClick()
            main { runtime.debugCommand("detour") }
            compose.waitUntil(15_000) { runtime.state.value.trip.reroutes > 0 }
            shot("navigation-reroute")
            main { runtime.debugCommand("pause") }
            // Screen-off proof is also saved as a shell dump by the verification commands.
            instrumentation.uiAutomation.executeShellCommand("input keyevent 223").close()
            Thread.sleep(4000)
            instrumentation.uiAutomation.executeShellCommand("dumpsys power").use { descriptor ->
                android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
                    File(context.getExternalFilesDir(null), "screen-off-power.txt").writeBytes(input.readBytes())
                }
            }
            instrumentation.uiAutomation.executeShellCommand("dumpsys activity services top.hicancan.studev").use { descriptor ->
                android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
                    File(context.getExternalFilesDir(null), "screen-off-service.txt").writeBytes(input.readBytes())
                }
            }
            instrumentation.uiAutomation.executeShellCommand("input keyevent 224").close()
            Thread.sleep(1000)
            instrumentation.uiAutomation.executeShellCommand("cmd statusbar expand-notifications").close()
            shot("foreground-notification", app = false)
            instrumentation.uiAutomation.executeShellCommand("cmd statusbar collapse").close()
            instrumentation.uiAutomation.executeShellCommand("wm dismiss-keyguard").close()
            Thread.sleep(1000)
            main { runtime.debugCommand("arrive") }
            compose.waitUntil(15_000) { runtime.state.value.trip.phase == TripPhase.Arrived }
            shot("arrival-walk")
            compose.onNodeWithText("已到达 教3").assertIsDisplayed()
            compose.waitUntil(15_000) { context.getSystemService(android.app.NotificationManager::class.java).activeNotifications.none { it.id == NavigationService.ID } }
        } finally { main { runtime.stop(close = true) } }
    }
    @Test fun cyclingPlannerAndSimulator() {
        try {
            plan("桃苑22栋", "图书馆")
            compose.onNodeWithText("骑行").performClick()
            compose.waitUntil(20_000) { !runtime.state.value.busy && runtime.state.value.route?.mode == "bike" }
            assertTrue(runtime.state.value.route!!.segments.none { it.steps })
            File(context.getExternalFilesDir(null), "route-bike.json").writeText(Json.encodeToString(runtime.state.value.route!!))
            shot("planner-bike-alternatives")
            compose.onNodeWithText("路线详情").performClick(); shot("steps-bike")
            compose.onNodeWithContentDescription("关闭路线详情").performClick()
            main { runtime.start(true, 20.0) }
            compose.waitUntil(15_000) { runtime.state.value.trip.update != null }
            Thread.sleep(4000); shot("navigation-bike-mid-route")
            main { runtime.debugCommand("arrive") }
            compose.waitUntil(15_000) { runtime.state.value.trip.phase == TripPhase.Arrived }
            shot("arrival-bike")
        } finally { main { runtime.stop(close = true) } }
    }
    @Test fun phonePlannerFromRealPosition() {
        try {
            permissions(); ready()
            compose.onNodeWithText("搜索地点、楼栋或教室").performClick(); search("教3")
            compose.onNodeWithText("路线", useUnmergedTree = true).performClick()
            Thread.sleep(5000)
            main { runtime.plan() }
            compose.waitUntil(15_000) { !runtime.state.value.busy }
            shot("phone-planner-real-position")
            assertNull(runtime.state.value.origin)
        } finally { main { runtime.stop(close = true) } }
    }
    @Test fun nativeWrapperRoutesActualPackage() = runBlocking {
        Wayfind.load(context.assets).use { engine ->
            for ((origin, destination, mode) in listOf(Triple("梅苑1栋", "教3", "walk"), Triple("桃苑22栋", "图书馆", "bike"))) {
                val routes = engine.route(RouteRequest(Endpoint.Target(origin), Endpoint.Target(destination), mode))
                assertTrue(routes.size in 1..3)
                routes.forEach { route ->
                    assertEquals(route.geometry.size, route.geometry_offsets_m.size)
                    assertTrue(route.distance_m > 0); assertTrue(route.maneuvers.size >= 2)
                    engine.navigate(route).use { session ->
                        val sampler = RouteSimulator(route)
                        val update = session.update(sampler.sample(0.0, 0))
                        assertFalse(update.arrived); assertFalse(update.off_route)
                        val final = session.update(sampler.sample(route.distance_m, (route.duration_s * 1000).toLong(), false))
                        assertTrue(final.arrived)
                    }
                }
            }
        }
    }
    @Test fun myPositionSwapAndOptions() {
        try {
            permissions(); ready()
            compose.waitUntil(15_000) { runtime.location.fix.value != null }
            compose.onNodeWithText("搜索地点、楼栋或教室").performClick(); search("教3")
            compose.onNodeWithText("路线", useUnmergedTree = true).performClick()
            main { runtime.plan() }
            compose.waitUntil(15_000) { !runtime.state.value.busy && runtime.state.value.route != null }
            val plannedPosition = runtime.state.value.route!!.geometry.first()
            compose.onNodeWithContentDescription("交换起终点").performClick()
            compose.waitUntil(15_000) { !runtime.state.value.busy && runtime.state.value.destinationIsMyPosition && runtime.state.value.route != null }
            assertEquals("教3", runtime.state.value.origin!!.id)
            val reversedGoal = runtime.state.value.route!!.geometry.last()
            assertEquals(plannedPosition[0], reversedGoal[0], .00001)
            assertEquals(plannedPosition[1], reversedGoal[1], .00001)
            shot("planner-swapped-position")
            compose.onNodeWithText("避开楼梯").performClick()
            compose.waitUntil(15_000) { runtime.state.value.avoidSteps && !runtime.state.value.busy }
            assertTrue(runtime.state.value.route!!.segments.none { it.steps })
            compose.onNodeWithText("骑行").performClick()
            compose.waitUntil(15_000) { runtime.state.value.mode == "bike" && !runtime.state.value.busy }
            assertTrue(runtime.state.value.route!!.segments.none { it.steps })
            val goal = runtime.state.value.route!!.geometry.last()
            main { runtime.start(true) }
            compose.waitUntil(15_000) { runtime.state.value.trip.update != null }
            main { runtime.debugCommand("detour") }
            compose.waitUntil(15_000) { runtime.state.value.trip.reroutes > 0 }
            assertEquals("bike", runtime.state.value.route!!.mode)
            assertEquals(goal, runtime.state.value.route!!.geometry.last())
        } finally { main { runtime.stop(close = true) } }
    }
    @Test fun alternativesAndRoomArrival() = runBlocking {
        permissions(); ready()
        val campus = CampusPackage.load(context.assets)
        val graph = kotlinx.serialization.json.Json.parseToJsonElement(context.assets.open("${CampusPackage.BASE}/network.json").bufferedReader().use { it.readText() })
        val targets = (graph as kotlinx.serialization.json.JsonObject).getValue("targets") as kotlinx.serialization.json.JsonObject
        val ids = targets.keys.filter { campus.byId.containsKey(it) }.shuffled(kotlin.random.Random(42))
        var found: Pair<String, String>? = null
        var attempts = 0
        Wayfind.load(context.assets).use { engine ->
            outer@ for (origin in ids.take(15)) for (destination in ids.takeLast(15)) {
                if (origin == destination) continue
                attempts++
                val routes = try { engine.route(RouteRequest(Endpoint.Target(origin), Endpoint.Target(destination))) } catch (_: Exception) { continue }
                if (routes.size > 1) { found = origin to destination; break@outer }
            }
        }
        File(context.getExternalFilesDir(null), "alternative-audit.txt").writeText("attempts=$attempts found=$found")
        val pair = checkNotNull(found) { "No valid alternative found in campus audit" }
        try {
            main { runtime.open(campus.byId.getValue(pair.second)); runtime.origin(campus.byId.getValue(pair.first)) }
            compose.waitUntil(20_000) { !runtime.state.value.busy && runtime.state.value.routes.size > 1 }
            shot("planner-alternatives")
            compose.onNodeWithTag("route-card:1").performClick(); assertEquals(1, runtime.state.value.selected)
            shot("planner-alternative-selected")
            compose.onNodeWithTag("route-card:0").performClick()
            shot("planner-map-before-tap")
            var tap: android.graphics.PointF? = null
            compose.activityRule.scenario.onActivity { activity ->
                fun find(view: View): MapView? {
                    if (view is MapView) return view
                    if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
                    return null
                }
                find(activity.window.decorView)?.let { view -> view.getMapAsync { map ->
                    tap = runtime.state.value.routes[1].geometry.map { map.projection.toScreenLocation(LatLng(it[1], it[0])) }
                        .firstOrNull { point -> point.x in 60f..(view.width - 60f) && point.y in (view.height * .28f)..(view.height * .65f) &&
                            map.queryRenderedFeatures(android.graphics.RectF(point.x-4, point.y-4, point.x+4, point.y+4), "route-alternatives", "route-chosen")
                                .firstOrNull()?.getNumberProperty("route")?.toInt() == 1 }
                } }
            }
            val point = checkNotNull(tap) { "No visible alternative segment for map tap" }
            compose.onRoot().performTouchInput { click(androidx.compose.ui.geometry.Offset(point.x, point.y)) }
            compose.waitUntil(5000) { runtime.state.value.selected == 1 }
            val room = campus.places.first { it.kind == "room" && it.parent == "教3" && it.floor == "6" }
            main { runtime.stop(close = true); runtime.open(room); runtime.origin(campus.byId.getValue("梅苑1栋")) }
            compose.waitUntil(20_000) { !runtime.state.value.busy && runtime.state.value.route != null }
            main { runtime.start(true, 20.0) }
            compose.waitUntil(15_000) { runtime.state.value.trip.update != null }
            main { runtime.debugCommand("arrive") }
            compose.waitUntil(15_000) { runtime.state.value.trip.phase == TripPhase.Arrived }
            shot("arrival-room")
            compose.onNodeWithText("${room.id} 在 6 楼").assertIsDisplayed()
        } finally { main { runtime.stop(close = true) } }
        Unit
    }
    @Test fun verifyEmulatorReplay() {
        org.junit.Assume.assumeTrue("Run with -e replay true and android/tools/replay.ps1", InstrumentationRegistry.getArguments().getString("replay") == "true")
        try {
            val bike = InstrumentationRegistry.getArguments().getString("mode") == "bike"
            plan(if (bike) "桃苑22栋" else "梅苑1栋", if (bike) "图书馆" else "教3")
            if (bike) { compose.onNodeWithText("骑行").performClick(); compose.waitUntil(20_000) { !runtime.state.value.busy } }
            val route = runtime.state.value.route!!
            File(context.getExternalFilesDir(null), "route-replay.json").writeText(Json.encodeToString(route))
            Thread.sleep(3000)
            main { runtime.start() }
            compose.waitUntil(30_000) { runtime.state.value.trip.update != null }
            compose.waitUntil(60_000) { (runtime.state.value.trip.update?.distance_travelled_m ?: 0.0) > 45 }
            shot("replay-${if (bike) "bike" else "walk"}-mid-route")
            compose.waitUntil(120_000) { runtime.state.value.trip.phase == TripPhase.Arrived }
            shot("replay-${if (bike) "bike" else "walk"}-arrival")
        } finally { main { runtime.stop(close = true) } }
    }
}
