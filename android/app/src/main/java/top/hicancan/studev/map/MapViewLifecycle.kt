package top.hicancan.studev.map

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.os.Bundle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.savedstate.compose.LocalSavedStateRegistryOwner
import org.maplibre.android.MapLibre
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView

/** One native view per composition, with balanced lifecycle calls even on early disposal. */
@Suppress("OVERRIDE_DEPRECATION", "DEPRECATION") // Forward memory callbacks on API 26–34 too.
internal class MapViewLifecycle(context: Context, savedState: Bundle?) :
    DefaultLifecycleObserver, ComponentCallbacks2 {
    val view: MapView
    val isRestored = savedState?.isEmpty == false
    private var started = false
    private var resumed = false
    var destroyed = false
        private set

    init {
        MapLibre.getInstance(context)
        view = MapView(context, MapLibreMapOptions.createFromAttributes(context)
            .localIdeographFontFamily("sans-serif")
            .attributionEnabled(false)
            .logoEnabled(false)
            .compassEnabled(false))
        view.onCreate(savedState)
    }

    override fun onStart(owner: LifecycleOwner) {
        if (!destroyed && !started) { view.onStart(); started = true }
    }
    override fun onResume(owner: LifecycleOwner) {
        if (!destroyed && !resumed) { view.onResume(); resumed = true }
    }
    override fun onPause(owner: LifecycleOwner) {
        if (resumed) { view.onPause(); resumed = false }
    }
    override fun onStop(owner: LifecycleOwner) {
        onPause(owner)
        if (started) { view.onStop(); started = false }
    }
    override fun onDestroy(owner: LifecycleOwner) {
        if (destroyed) return
        onStop(owner)
        view.onDestroy()
        destroyed = true
    }
    fun saveState() = Bundle().also { if (!destroyed) view.onSaveInstanceState(it) }
    override fun onLowMemory() { if (!destroyed) view.onLowMemory() }
    override fun onTrimMemory(level: Int) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) onLowMemory()
    }
    override fun onConfigurationChanged(newConfig: Configuration) = Unit
}

@Composable
internal fun rememberMapViewLifecycle(): MapViewLifecycle {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val registry = LocalSavedStateRegistryOwner.current.savedStateRegistry
    val key = "campus-map"
    val holder = remember(context, registry) {
        MapViewLifecycle(context, registry.consumeRestoredStateForKey(key))
    }
    DisposableEffect(holder, owner, registry) {
        registry.registerSavedStateProvider(key, holder::saveState)
        context.registerComponentCallbacks(holder)
        owner.lifecycle.addObserver(holder)
        onDispose {
            registry.unregisterSavedStateProvider(key)
            owner.lifecycle.removeObserver(holder)
            context.unregisterComponentCallbacks(holder)
            holder.onDestroy(owner)
        }
    }
    return holder
}
