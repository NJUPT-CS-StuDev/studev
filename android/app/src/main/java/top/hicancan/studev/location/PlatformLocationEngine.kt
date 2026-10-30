package top.hicancan.studev.location

import android.app.PendingIntent
import android.content.Context
import android.location.Location
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.*
import org.maplibre.android.location.engine.*
import top.hicancan.studev.navigation.NavFix

enum class LocationStatus { Waiting, Available, Disabled, Unavailable }

fun NavFix.location() = Location("studev").also {
    it.longitude = longitude; it.latitude = latitude; it.accuracy = accuracy.toFloat()
    it.elapsedRealtimeNanos = timestamp * 1_000_000; it.time = System.currentTimeMillis()
    it.speed = speed.toFloat(); heading?.let { heading -> it.bearing = heading.toFloat() }
}

/** MapLibre adapter; Activity lifecycle and the navigation service share the same source. */
class PlatformLocationEngine(context: Context, private val onStatus: (LocationStatus) -> Unit) : LocationEngine {
    private val source = CampusLocation.get(context)
    private val subscriptions = mutableMapOf<LocationEngineCallback<LocationEngineResult>, Job>()
    override fun getLastLocation(callback: LocationEngineCallback<LocationEngineResult>) {
        callback.onSuccess(LocationEngineResult.create(source.fix.value?.location()))
    }
    override fun requestLocationUpdates(request: LocationEngineRequest, callback: LocationEngineCallback<LocationEngineResult>, looper: Looper?) {
        removeLocationUpdates(callback)
        val handler = Handler(looper ?: Looper.getMainLooper())
        source.acquire(callback)
        subscriptions[callback] = CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            launch { source.status.collect { value -> handler.post { onStatus(value) } } }
            source.fix.collect { fix -> if (fix != null) handler.post { callback.onSuccess(LocationEngineResult.create(fix.location())) } }
        }
    }
    override fun removeLocationUpdates(callback: LocationEngineCallback<LocationEngineResult>) {
        subscriptions.remove(callback)?.cancel(); source.release(callback)
    }
    override fun requestLocationUpdates(request: LocationEngineRequest, pendingIntent: PendingIntent?) =
        throw UnsupportedOperationException("Use the callback subscription")
    override fun removeLocationUpdates(pendingIntent: PendingIntent?) = Unit
}
