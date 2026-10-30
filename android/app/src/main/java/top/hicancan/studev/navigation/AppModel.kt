package top.hicancan.studev.navigation

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.PlacePreferences
import top.hicancan.studev.search.CampusSearch

class AppModel(application: Application, private val state: SavedStateHandle) : AndroidViewModel(application) {
    private val _campus = MutableStateFlow<CampusPackage?>(null)
    val campus: StateFlow<CampusPackage?> = _campus
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error
    val preferences = PlacePreferences(application)
    val search = CampusSearch(application.assets)
    val selectedId = state.getStateFlow<String?>("place", null)
    init { load() }
    fun load() { viewModelScope.launch {
        _error.value = null
        try { _campus.value = CampusPackage.load(getApplication<Application>().assets) }
        catch (e: java.io.IOException) { _error.value = e.message ?: "无法读取校园数据" }
        catch (e: kotlinx.serialization.SerializationException) { _error.value = e.message ?: "校园数据格式有误" }
    } }
    fun select(id: String?) {
        state["place"] = id
        if (id != null) viewModelScope.launch { preferences.remember(id) }
    }
    override fun onCleared() { search.close() }
}
