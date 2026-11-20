package top.hicancan.studev.ai

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class NativeCallsTest {
    @Test fun dsmlWithExtraBarsAndSpacesIsReadAsTheCallItSpells() {
        for (marker in listOf("<｜DSML｜", "<｜｜DSML｜｜", "< | | DSML | | ")) {
            val close = marker.replaceFirst("<", "</")
            val text = "${marker}function_calls>${marker}invoke name=\"read\">${marker}parameter name=\"id\" string=\"true\">a.md${close}parameter>${marker}parameter name=\"ids\" string=\"false\">[\"x\"]${close}parameter>${close}invoke>${close}function_calls>"
            val call = nativeCalls(text).single().getValue("function").jsonObject
            assertEquals("read", call.getValue("name").jsonPrimitive.content)
            assertEquals(buildJsonObject { put("id", "a.md"); put("ids", buildJsonArray { add("x") }) }, Json.parseToJsonElement(call.getValue("arguments").jsonPrimitive.content))
        }
        assertTrue(nativeCalls("<｜DSML｜function_calls>").isEmpty())
    }
}
