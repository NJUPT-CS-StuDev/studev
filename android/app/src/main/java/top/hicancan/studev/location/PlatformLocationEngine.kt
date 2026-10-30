package top.hicancan.studev.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import org.maplibre.android.location.engine.LocationEngine
import org.maplibre.android.location.engine.LocationEngineCallback
import org.maplibre.android.location.engine.LocationEngineRequest
import org.maplibre.android.location.engine.LocationEngineResult
import java.util.concurrent.TimeUnit

enum class LocationStatus { Waiting, Available, Disabled, Unavailable }

/** Foreground GPS + network provider adapter. MapLibre owns subscription lifetimes. */
class PlatformLocationEngine(
    private val context: Context,
    private val onStatus: (LocationStatus) -> Unit,
) : LocationEngine {
    private val manager = context.getSystemService(LocationManager::class.java)
    private val listeners = mutableMapOf<LocationEngineCallback<LocationEngineResult>, LocationListener>()

    private fun providers(): List<String> {
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) throw SecurityException("Location permission is required")
        return listOfNotNull(
            LocationManager.GPS_PROVIDER.takeIf { fine },
            LocationManager.NETWORK_PROVIDER,
        ).filter { it in manager.allProviders }
    }

    private fun reportProviders(providers: List<String>) {
        onStatus(when {
            providers.isEmpty() -> LocationStatus.Unavailable
            providers.none(manager::isProviderEnabled) -> LocationStatus.Disabled
            else -> LocationStatus.Waiting
        })
    }

    @SuppressLint("MissingPermission")
    override fun getLastLocation(callback: LocationEngineCallback<LocationEngineResult>) {
        try {
            val providers = providers()
            val latest = providers.filter(manager::isProviderEnabled)
                .mapNotNull(manager::getLastKnownLocation)
                .filter { SystemClock.elapsedRealtimeNanos() - it.elapsedRealtimeNanos < MAX_AGE_NANOS }
                                .reduceOrNull { best, fix ->
                    val difference = fix.elapsedRealtimeNanos - best.elapsedRealtimeNanos
                    when {
                        difference > TimeUnit.SECONDS.toNanos(10) -> fix
                        difference < -TimeUnit.SECONDS.toNanos(10) -> best
                        fix.accuracy < best.accuracy -> fix
                        else -> best
                    }
                }
            if (latest != null) {
                callback.onSuccess(LocationEngineResult.create(latest))
                onStatus(LocationStatus.Available)
            } else {
                reportProviders(providers)
                callback.onSuccess(LocationEngineResult.create(null as Location?))
            }
        } catch (error: SecurityException) {
            callback.onFailure(error)
        }
    }

    @SuppressLint("MissingPermission")
    override fun requestLocationUpdates(
        request: LocationEngineRequest,
        callback: LocationEngineCallback<LocationEngineResult>,
        looper: Looper?,
    ) {
        removeLocationUpdates(callback)
        val targetLooper = looper ?: Looper.getMainLooper()
        val handler = Handler(targetLooper)
        try {
            val providers = providers()
            reportProviders(providers)
            val listener = object : LocationListener {
                private var previous: Location? = null
                override fun onLocationChanged(location: Location) {
                    val old = previous
                    // Reject stale fixes and a recent, much less accurate network fix over GPS.
                    if (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos > MAX_AGE_NANOS) return
                    if (old != null && (location.elapsedRealtimeNanos <= old.elapsedRealtimeNanos ||
                        (location.elapsedRealtimeNanos - old.elapsedRealtimeNanos < TimeUnit.SECONDS.toNanos(10) &&
                            location.accuracy > old.accuracy * 2))) return
                    previous = Location(location)
                    callback.onSuccess(LocationEngineResult.create(location))
                    onStatus(LocationStatus.Available)
                }
                override fun onProviderEnabled(provider: String) = reportProviders(providers)
                override fun onProviderDisabled(provider: String) = reportProviders(providers)
                @Deprecated("Required on API 26–29")
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
            }
            listeners[callback] = listener
            // Register disabled providers too, so enabling GPS in Settings resumes updates.
            providers.forEach { provider ->
                manager.requestLocationUpdates(
                    provider, request.interval.coerceAtLeast(1_000),
                    request.displacement, listener, targetLooper,
                )
            }
            handler.post { if (listeners[callback] === listener) getLastLocation(callback) }
        } catch (error: Exception) {
            removeLocationUpdates(callback)
            handler.post { callback.onFailure(error) }
            onStatus(LocationStatus.Unavailable)
        }
    }

    override fun removeLocationUpdates(callback: LocationEngineCallback<LocationEngineResult>) {
        listeners.remove(callback)?.let(manager::removeUpdates)
    }

    @SuppressLint("MissingPermission")
    override fun requestLocationUpdates(request: LocationEngineRequest, pendingIntent: PendingIntent?) {
        requireNotNull(pendingIntent)
        providers().forEach { provider ->
            manager.requestLocationUpdates(provider, request.interval.coerceAtLeast(1_000), request.displacement, pendingIntent)
        }
    }

    override fun removeLocationUpdates(pendingIntent: PendingIntent?) {
        pendingIntent?.let(manager::removeUpdates)
    }

    companion object {
        private val MAX_AGE_NANOS = TimeUnit.MINUTES.toNanos(2)
    }
}
