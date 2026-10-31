package top.hicancan.studev.data

import java.io.File
import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Test
import top.hicancan.studev.navigation.Endpoint

class DisplayNameParityTest {
    private val json = Json

    @Test fun kotlinMatchesWebDisplayNameVectors() {
        val root = generateSequence(File(checkNotNull(System.getProperty("user.dir"))).canonicalFile) { it.parentFile }
            .map { File(it, "src/campus/map/model/displayName.golden.json") }
            .first { it.isFile }
        val cases = json.parseToJsonElement(root.readText()).jsonObject.getValue("cases").jsonArray
        for (entry in cases) {
            val item = entry.jsonObject
            val place = item.getValue("place").jsonObject.toPlace()
            val parents = item.getValue("parents").jsonArray.map { it.jsonObject.toPlace() }.associateBy { it.id }
            assertEquals(item.getValue("expected").jsonPrimitive.content, place.displayName(parents))
        }
    }

    private fun JsonObject.toPlace() = Place(
        id = getValue("id").jsonPrimitive.content,
        kind = getValue("kind").jsonPrimitive.content,
        parent = get("parent")?.jsonPrimitive?.content ?: "",
        names = get("names")?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList(),
        sources = emptyList(),
        use = "",
        routing = Endpoint.Target(getValue("id").jsonPrimitive.content),
        category = get("category")?.jsonPrimitive?.contentOrNull,
    )
}
