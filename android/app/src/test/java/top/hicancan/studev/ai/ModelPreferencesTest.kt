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

        assertEquals(ModelCatalog(), ModelPreferences.read(prefs))
        assertEquals(setOf("catalog"), values.keys)
        assertFalse(values.getValue("catalog").toString().contains("retired-test-key"))
        assertEquals(ModelCatalog(), ModelPreferences.read(prefs))
    }

    @Test fun ordinaryHttpsApiConfigurationSurvivesRemovalOfTheOldFlag() {
        val own = Own("https://api.example/v1", "own-model", "own-test-key")
        val values = mutableMapOf<String, Any>(
            "use" to "own", "runtime" to false, "base" to own.base, "model" to own.model, "key" to own.key,
        )

        val prefs = preferences(values)
        val kept = ModelPreferences.read(prefs)
        val selected = kept.preferred
        assertEquals(own, kept.direct(selected))
        assertEquals("api.example", kept.service(selected.provider)?.name)
        assertEquals(setOf("catalog"), values.keys)
        assertEquals(selected, ModelPreferences.read(prefs).preferred)
        assertEquals(own, ModelPreferences.read(prefs).direct(selected))
        assertNull(Models.addressError(own.base))
        assertNotNull(Models.addressError("http://127.0.0.1:9316/v1"))
        assertNotNull(Models.addressError("http://localhost:9316/v1"))
    }

    @Test fun oldChatStillKeepsItsChosenBranchAndDropsRemoteMetadata() {
        fun message(role: String, text: String) = buildJsonObject { put("role", role); put("content", text) }
        val thread = ChatThread().append("", "question", message("user", "Question"))
            .append("question", "answer", message("assistant", "Answer"))
            .append("question", "alternate", message("assistant", "Alternate answer"))
        val pick = ModelSelection("service-id", "model-id")
        val chat = SavedChat("chat", "My chat", 42, thread, pick)
        val old = JsonObject(chat.toJson() + mapOf(
            "forks" to JsonArray(listOf(JsonPrimitive("alternate"))),
            "runtimeModels" to JsonArray(listOf(JsonPrimitive("retired-model"))),
        ))

        val migrated = SavedChat.of(old)
        assertEquals(pick, migrated.selection)
        assertEquals(chat.toJson(), migrated.toJson())
        assertEquals(listOf("question", "alternate"), migrated.thread.path().map { it.id })
        assertEquals(listOf("question", "answer"), migrated.thread.choose("answer").path().map { it.id })
    }

    @Test fun aDisabledOrRemovedChoiceNeverResolvesToAnotherService() {
        val choice = ModelSelection("selected", "same-model")
        val service = ModelService("selected", "First", "https://first.example/v1", "first-key", models = listOf(OfferedModel("same-model")))
        val other = service.copy(id = "other", name = "Second", base = "https://second.example/v1", key = "second-key")
        val catalog = ModelCatalog(listOf(service, other), choice)
        assertEquals("first-key", catalog.direct(choice)?.key)
        assertNull(catalog.saving(service.copy(enabled = false)).direct(choice))
        assertNull(catalog.saving(service.copy(models = listOf(OfferedModel("same-model", enabled = false)))).direct(choice))
        assertNull(catalog.copy(services = listOf(other)).direct(choice))
        assertEquals(choice, catalog.preferred)
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
            })!!
        }
        val type = SharedPreferences::class.java
        return type.cast(Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, method, args ->
            when (method.name) {
                "contains" -> values.containsKey(args[0] as String)
                "getString", "getBoolean" -> values[args[0] as String] ?: args[1]
                "edit" -> editor()
                else -> error("Unexpected preference read: ${method.name}")
            }
        })!!
    }
}
