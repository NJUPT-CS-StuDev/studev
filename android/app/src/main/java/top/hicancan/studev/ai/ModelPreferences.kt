package top.hicancan.studev.ai

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.URI

internal const val FREE_SERVICE = "hicancan"
internal const val FREE_MODEL = "免费额度"
private const val CATALOG = "catalog"

/** Missing IDs represent the built-in model; a configured selection carries no credentials. */
@Serializable internal data class ModelSelection(val provider: String? = null, val model: String? = null)

@Serializable internal data class OfferedModel(val id: String, val enabled: Boolean = true)

@Serializable internal data class ModelService(
    val id: String,
    val name: String,
    val base: String,
    val key: String,
    val enabled: Boolean = true,
    val models: List<OfferedModel> = emptyList(),
)

@Serializable internal data class ModelCatalog(
    val services: List<ModelService> = emptyList(),
    val preferred: ModelSelection = ModelSelection(),
) {
    fun service(id: String?) = services.firstOrNull { it.id == id }

    fun direct(selection: ModelSelection): Own? {
        val service = service(selection.provider) ?: return null
        if (!service.enabled || service.key.isBlank() || Models.addressError(service.base) != null) return null
        val model = service.models.firstOrNull { it.id == selection.model && it.enabled } ?: return null
        return Own(service.base, model.id, service.key)
    }

    fun forNewChat() = preferred.takeIf { it.provider == null || direct(it) != null } ?: ModelSelection()

    fun saving(service: ModelService): ModelCatalog = copy(services = if (services.any { it.id == service.id }) {
        services.map { if (it.id == service.id) service else it }
    } else services + service)
}

internal object ModelPreferences {
    private val json = Json { ignoreUnknownKeys = true }
    fun get(context: Context) = context.getSharedPreferences("ai_model", Context.MODE_PRIVATE)

    fun read(prefs: SharedPreferences): ModelCatalog {
        prefs.getString(CATALOG, null)?.let { return runCatching { json.decodeFromString<ModelCatalog>(it) }.getOrDefault(ModelCatalog()) }
        val base = prefs.getString("base", null).orEmpty().trim()
        val key = prefs.getString("key", null).orEmpty().trim()
        val model = prefs.getString("model", null).orEmpty().trim()
        // Import only the former direct HTTPS configuration. Retired browser credentials are discarded.
        val next = if (!prefs.getBoolean("runtime", false) && key.isNotEmpty() && model.isNotEmpty() && Models.addressError(base) == null) {
            val host = URI(base).host
            val source = ModelService("imported-api", if (host == "api.deepseek.com") "DeepSeek" else host, base, key, models = listOf(OfferedModel(model)))
            val preferred = if (prefs.getString("use", "free") == "own") ModelSelection(source.id, model) else ModelSelection()
            ModelCatalog(listOf(source), preferred)
        } else ModelCatalog()
        prefs.edit().putString(CATALOG, json.encodeToString(next)).remove("use").remove("base").remove("key").remove("model").remove("runtime").apply()
        return next
    }

    fun update(prefs: SharedPreferences, change: (ModelCatalog) -> ModelCatalog) {
        prefs.edit().putString(CATALOG, json.encodeToString(change(read(prefs)))).apply()
    }
}

@Composable internal fun rememberModelCatalog(prefs: SharedPreferences): State<ModelCatalog> {
    val catalog = remember(prefs) { mutableStateOf(ModelPreferences.read(prefs)) }
    DisposableEffect(prefs) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { changed, field ->
            if (field == CATALOG) catalog.value = ModelPreferences.read(changed)
        }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        catalog.value = ModelPreferences.read(prefs)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return catalog
}
