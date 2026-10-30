package top.hicancan.studev.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import java.io.IOException

private val Context.placeStore by preferencesDataStore("places")
class PlacePreferences(context: Context) {
    private val store = context.applicationContext.placeStore
    private val recentKey = stringPreferencesKey("recent")
    private val savedKey = stringSetPreferencesKey("saved")
    private val data = store.data.catch { if (it is IOException) emit(androidx.datastore.preferences.core.emptyPreferences()) else throw it }
    val recent = data.map { prefs -> prefs[recentKey]?.let { Json.decodeFromString<List<String>>(it) } ?: emptyList() }
    val saved = data.map { it[savedKey] ?: emptySet() }
    suspend fun remember(id: String) { store.edit { prefs ->
        val old = prefs[recentKey]?.let { Json.decodeFromString<List<String>>(it) } ?: emptyList()
        prefs[recentKey] = Json.encodeToString((listOf(id) + old.filter { it != id }).take(12))
    } }
    suspend fun clearRecent() { store.edit { it.remove(recentKey) } }
    suspend fun toggleSaved(id: String) { store.edit { prefs ->
        val old = prefs[savedKey] ?: emptySet()
        prefs[savedKey] = if (id in old) old - id else old + id
    } }
}
