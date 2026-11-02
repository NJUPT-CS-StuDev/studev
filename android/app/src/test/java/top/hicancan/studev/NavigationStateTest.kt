package top.hicancan.studev

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import top.hicancan.studev.data.Place
import top.hicancan.studev.data.roomDisplayName
import top.hicancan.studev.navigation.PlannerState

class NavigationStateTest {
    @Test fun swappingRealPlacesAlsoSwapsTheirDisplayedNames() {
        val stream = checkNotNull(javaClass.classLoader?.getResourceAsStream("data/space/仙林/entities.json"))
        val places = stream.bufferedReader().use { Json.decodeFromString<List<Place>>(it.readText()) }
        val byId = places.associateBy { it.id }
        val origin = byId.getValue("仙林/教3")
        val destination = byId.getValue("仙林/教4-208")
        val state = PlannerState(origin = origin, destination = destination, originLabel = origin.displayName(byId), destinationLabel = roomDisplayName(destination.id, byId))
        val swapped = state.swapped()
        assertEquals(state.originName, swapped.destinationName)
        assertEquals(state.destinationName, swapped.originName)
        assertEquals("教4-208", state.destinationName)
        val myPosition = state.copy(origin = null, originLabel = null).swapped()
        assertTrue(myPosition.destinationIsMyPosition)
        assertEquals("我的位置", myPosition.destinationName)
    }
}
