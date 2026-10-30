package top.hicancan.studev.data

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CampusPackageTest {
    private fun resource(path: String) = checkNotNull(javaClass.classLoader?.getResource(path)).readText()
    @Test fun bundledContractDecodesWithoutIgnoringFields() {
        val places = Json.decodeFromString<List<Place>>(resource("data/space/仙林/places.json"))
        assertTrue(places.all { it.id.isNotBlank() && it.names.isNotEmpty() })
        val building = places.first { it.id == "教3" }
        assertEquals("building", building.kind)
        assertEquals("仙林", building.parent)
        assertEquals(6, building.levels)
        assertEquals(2, building.centre!!.size)
        assertTrue(building.entrances.all { it.at.size == 2 && it.source.isNotBlank() })
        val room = places.first { it.kind == "room" && it.parent == "教3" }
        assertNotNull(room.seats)
        assertNull(room.centre)
        assertTrue(room.sources.isNotEmpty())
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
            assertEquals("asset://map/sprites/$theme", json.getValue("sprite").jsonPrimitive.content)
            assertEquals("asset://data/space/仙林/places.geojson", json.getValue("sources").jsonObject
                .getValue("places").jsonObject.getValue("data").jsonPrimitive.content)
        }
    }
}
