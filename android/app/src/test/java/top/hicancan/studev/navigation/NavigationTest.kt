package top.hicancan.studev.navigation

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class NavigationTest {
    private fun maneuver(type: String, offset: Double, modifier: String = "ahead") = Maneuver(
        type, modifier, listOf(118.9, 32.1), 0.0, 0.0, offset, 100.0,
        "校园路", instruction = if (type == "arrive") "已到达教3，入口在您的左侧" else "沿校园路前行")
    private val route = CampusRoute("walk", listOf(listOf(118.9, 32.1), listOf(118.901, 32.1)),
        listOf(0.0, 100.0), 100.0, 80.0,
        listOf(RouteSegment(0, 1, 100.0, 80.0, 1, "校园路", false)),
        listOf(maneuver("depart", 0.0), maneuver("arrive", 100.0)), "校园路")
    private fun update(arrived: Boolean = false, off: Boolean = false) = NavigationUpdate(
        20.0, 80.0, 64.0, listOf(118.9002, 32.1), 2.0,
        ManeuverDistance(route.maneuvers[0], 0.0), ManeuverDistance(route.maneuvers[1], 80.0),
        listOf(VoicePrompt(1, "early", "前方到达教3")), off, arrived)
    @Test fun requestUsesSharedEndpointAndOptionsProtocol() {
        val request = RouteRequest(Endpoint.Position(listOf(118.9, 32.1)), Endpoint.Target("教3"), "bike", alternatives = 3)
        val objectValue = Json.parseToJsonElement(WayfindProtocol.request(request)).jsonObject
        assertEquals("position", objectValue.getValue("origin").jsonObject.getValue("type").jsonPrimitive.content)
        assertEquals("教3", objectValue.getValue("destination").jsonObject.getValue("id").jsonPrimitive.content)
        assertEquals(3, objectValue.getValue("alternatives").jsonPrimitive.int)
        assertEquals(100.0, objectValue.getValue("max_snap_distance_m").jsonPrimitive.double, 0.0)
        assertEquals(request, Json.decodeFromString<RouteRequest>(Json.encodeToString(request)))
    }
    @Test fun routeAndUpdateRetainNativeFields() {
        assertEquals(route, Json.decodeFromString<CampusRoute>(Json.encodeToString(route)))
        assertEquals(update(), Json.decodeFromString<NavigationUpdate>(Json.encodeToString(update())))
        assertEquals("校园路", route.via)
    }
    @Test fun persistedSessionRetainsTheRouteNeededForProcessRestart() {
        val record = PersistedNavigationSession(route, "教3", "walk", avoidSteps = true)
        assertEquals(record, Json.decodeFromString<PersistedNavigationSession>(Json.encodeToString(record)))
    }
    @Test fun fakeNavigatorDrivesBannerOffRouteAndArrivalState() {
        val values = ArrayDeque(listOf(update(), update(off = true), update(arrived = true)))
        val fake = object : NavigationSession {
            override fun update(fix: NavFix) = values.removeFirst()
            override fun close() = Unit
        }
        val fix = NavFix(118.9, 32.1, 5.0, null, 0)
        var state = TripState().accept(fake.update(fix))
        assertEquals(TripPhase.Navigating, state.phase)
        assertEquals("arrive", state.banner!!.maneuver.type)
        assertEquals(80.0, state.banner!!.distance_m, 0.0)
        state = state.accept(fake.update(fix))
        assertTrue(state.rerouting)
        state = state.accept(fake.update(fix))
        assertEquals(TripPhase.Arrived, state.phase)
        assertFalse(state.rerouting)
        assertEquals(state.update!!.current, state.banner)
    }
    @Test fun simulationHonorsOffsetsAndBoundedJitter() {
        val sampler = RouteSimulator(route)
        val mid = sampler.sample(50.0, 1000, false)
        assertEquals(118.9005, mid.longitude, 1e-7)
        assertEquals(90.0, mid.heading!!, 1e-4)
        repeat(100) {
            val noisy = sampler.sample(50.0, it.toLong())
            assertTrue(kotlin.math.abs(noisy.longitude - mid.longitude) < .00003)
            assertEquals(5.0, noisy.accuracy, 0.0)
        }
        assertEquals(route.geometry.last(), sampler.sample(1000.0, 1000, false).position)
    }
    @Test fun campusSnapErrorOffersPickingOrigin() {
        val message = NavigationRuntime.routeError(IllegalArgumentException("no usable edge within snap distance"), true)
        assertTrue(message.contains("100 米")); assertTrue(message.contains("选择"))
    }
    @Test fun swappingMyPositionIsReversible() {
        val place = top.hicancan.studev.data.Place("教3", "building", "仙林", listOf("教3"), sources = listOf("test"), use = "教学", routing = Endpoint.Target("教3"))
        val initial = PlannerState(open = true, destination = place)
        val reversed = initial.swapped()
        assertEquals(place, reversed.origin)
        assertNull(reversed.destination)
        assertTrue(reversed.destinationIsMyPosition)
        assertEquals("我的位置", reversed.destinationName)
        assertEquals(initial, reversed.swapped())
    }
}
