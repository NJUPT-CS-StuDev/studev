package top.hicancan.studev.ai

import android.content.SharedPreferences
import java.lang.reflect.Proxy
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ModelPreferencesTest {
    @Test fun retiredBrowserProviderClearsItsCredentialsAndChoosesTheProvidedModel() {
        val values = mutableMapOf<String, Any>(
            "use" to "own", "runtime" to true, "base" to "https://retired.example/v1",
            "model" to "retired-model", "key" to "retired-test-key",
        )
        val prefs = preferences(values)

        assertEquals(false to Models.STARTING, Models.read(prefs))
        assertEquals(mapOf("use" to "free"), values)
        assertEquals(false to Models.STARTING, Models.read(prefs))
    }

    @Test fun ordinaryHttpsApiConfigurationSurvivesRemovalOfTheOldFlag() {
        val own = Own("https://api.example/v1", "own-model", "own-test-key")
        val values = mutableMapOf<String, Any>(
            "use" to "own", "runtime" to false, "base" to own.base, "model" to own.model, "key" to own.key,
        )

        assertEquals(true to own, Models.read(preferences(values)))
        assertEquals(mapOf("use" to "own", "base" to own.base, "model" to own.model, "key" to own.key), values)
        assertNull(Models.addressError(own.base))
        assertNotNull(Models.addressError("http://127.0.0.1:9316/v1"))
        assertNotNull(Models.addressError("http://localhost:9316/v1"))
    }

    @Test fun oldChatStillKeepsItsChosenBranchAndDropsRemoteMetadata() {
        fun message(role: String, text: String) = buildJsonObject { put("role", role); put("content", text) }
        val thread = ChatThread().append("", "question", message("user", "Question"))
            .append("question", "answer", message("assistant", "Answer"))
            .append("question", "alternate", message("assistant", "Alternate answer"))
        val chat = SavedChat("chat", "My chat", 42, thread)
        val old = JsonObject(chat.toJson() + mapOf(
            "forks" to JsonArray(listOf(JsonPrimitive("alternate"))),
            "runtimeModels" to JsonArray(listOf(JsonPrimitive("retired-model"))),
        ))

        val migrated = SavedChat.of(old)
        assertEquals(chat.toJson(), migrated.toJson())
        assertEquals(listOf("question", "alternate"), migrated.thread.path().map { it.id })
        assertEquals(listOf("question", "answer"), migrated.thread.choose("answer").path().map { it.id })
    }

    private fun preferences(values: MutableMap<String, Any>): SharedPreferences {
        fun editor(): SharedPreferences.Editor {
            val edits = mutableMapOf<String, String?>()
            val type = SharedPreferences.Editor::class.java
            return type.cast(Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { proxy, method, args ->
                when (method.name) {
                    "remove" -> { edits[args[0] as String] = null; proxy }
                    "putString" -> { edits[args[0] as String] = args[1] as String?; proxy }
                    "apply" -> { edits.forEach { (key, value) -> if (value == null) values.remove(key) else values[key] = value }; null }
                    else -> error("Unexpected edit: ${method.name}")
                }
            })
        }
        val type = SharedPreferences::class.java
        return type.cast(Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, method, args ->
            when (method.name) {
                "contains" -> values.containsKey(args[0] as String)
                "getString", "getBoolean" -> values[args[0] as String] ?: args[1]
                "edit" -> editor()
                else -> error("Unexpected preference read: ${method.name}")
            }
        })
    }
}
