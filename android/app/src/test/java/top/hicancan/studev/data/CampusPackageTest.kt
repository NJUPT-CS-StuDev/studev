package top.hicancan.studev.data

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CampusPackageTest {
    private fun resource(path: String) = checkNotNull(javaClass.classLoader?.getResource(path)).readText()
    @Test fun bundledContractDecodesWithoutIgnoringFields() {
        val places = Json.decodeFromString<List<Place>>(resource("data/space/仙林/entities.json"))
        assertTrue(places.all { it.id.isNotBlank() })
        assertEquals(places.size, places.map { it.id }.toSet().size)
        assertTrue(places.all { it.use.isNotBlank() })
        val hours = Json.decodeFromString<Map<String, JsonObject>>(resource("data/hours.json"))
        assertTrue(hours.containsKey("仙林/图书馆"))
        val building = places.first { it.id == "仙林/教3" }
        assertEquals("building", building.kind)
        assertEquals("仙林", building.parent)
        assertEquals(2, building.centre!!.size)
        assertTrue(building.names.contains("教三"))
        val room = places.first { it.id == "仙林/教3-601" }
        assertEquals("仙林/教3/6", room.parent)
        assertEquals(2, room.centre!!.size)
        assertTrue(room.sources.isNotEmpty())
        val unnamed = places.first { it.id == "仙林/建筑/024" }
        assertEquals("未命名建筑", unnamed.displayName(places.associateBy { it.id }))
    }
    @Test fun allContractFieldsRoundTrip() {
        val json = """{"id":"教3-101","kind":"room","parent":"教3","names":["101"],"centre":[118.9,32.1],"levels":6,"houses":["服务"],"entrances":[{"at":[118.9,32.1],"source":"osm"}],"floor":"1","seats":40,"room_kinds":["教室"],"sources":["jwxt"],"use":"多媒体教室","routing":{"type":"target","id":"教3"}}"""
        val place = Json.decodeFromString<Place>(json)
        assertEquals(Json.parseToJsonElement(json), Json.parseToJsonElement(Json.encodeToString(place)))
    }
    @Test(expected = SerializationException::class) fun schemaDriftFailsLoudly() {
        Json.decodeFromString<Place>("""{"id":"a","kind":"room","parent":"b","names":[],"sources":[],"surprise":true}""")
    }
    @Test fun styleBindsNativeAssetsWithoutDamagingGlyphTokens() {
        for (theme in listOf("light", "dark")) {
            val raw = resource("data/space/仙林/style-$theme.json")
            val bound = StyleTokens.resolve(raw)
            assertFalse(bound.contains("{data}")); assertFalse(bound.contains("{assets}"))
            val json = Json.parseToJsonElement(bound).jsonObject
            assertEquals("pmtiles://asset://data/space/仙林/basemap.pmtiles", json.getValue("sources").jsonObject
                .getValue("basemap").jsonObject.getValue("url").jsonPrimitive.content)
            assertEquals("asset://map/fonts/{fontstack}/{range}.pbf", json.getValue("glyphs").jsonPrimitive.content)
            assertTrue(json.getValue("sources").jsonObject.containsKey("basemap"))
        }
    }
}
