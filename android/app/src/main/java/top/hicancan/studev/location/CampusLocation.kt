package top.hicancan.studev.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.*
import android.location.*
import android.os.*
import android.view.Surface
import android.view.WindowManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import top.hicancan.studev.navigation.NavFix
import kotlin.math.*

/** One provider subscription, shared by the map and foreground service. No Play Services. */
class CampusLocation private constructor(private val context: Context) : SensorEventListener {
    private val manager = context.getSystemService(LocationManager::class.java)
    private val sensors = context.getSystemService(SensorManager::class.java)
    private var thread: HandlerThread? = null
    private val owners = mutableSetOf<Any>()
    private val _fix = MutableStateFlow<NavFix?>(null)
    val fix = _fix.asStateFlow()
    private val _status = MutableStateFlow(LocationStatus.Waiting)
    val status = _status.asStateFlow()
    private var last: Location? = null
    private var filtered: Location? = null
    private var compass: Double? = null
    private var lastHeadingEmission = 0L
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) = accept(location)
        override fun onProviderEnabled(provider: String) = report()
        override fun onProviderDisabled(provider: String) = report()
        @Deprecated("API 26") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }
    private fun report() {
        val enabled = if (Build.VERSION.SDK_INT >= 28) manager.isLocationEnabled else manager.allProviders.any { manager.isProviderEnabled(it) }
        _status.value = when {
            !enabled -> LocationStatus.Disabled
            _fix.value?.let { SystemClock.elapsedRealtime() - it.timestamp in 0..30_000 } == true -> LocationStatus.Available
            else -> LocationStatus.Waiting
        }
    }
    @Synchronized @SuppressLint("MissingPermission")
    fun acquire(owner: Any) {
        val first = owners.isEmpty()
        if (!owners.add(owner) || !first) return
        val worker = thread ?: HandlerThread("campus-location").apply { start() }.also { thread = it }
        last = null; filtered = null
        val handler = Handler(worker.looper)
        handler.post {
            try {
                val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                val providers = listOfNotNull(LocationManager.GPS_PROVIDER.takeIf { fine }, LocationManager.NETWORK_PROVIDER)
                    .filter { it in manager.allProviders }
                report()
                providers.mapNotNull { manager.getLastKnownLocation(it) }.sortedBy { it.elapsedRealtimeNanos }.forEach(::accept)
                providers.forEach { manager.requestLocationUpdates(it, 1000L, 0f, listener, worker.looper) }
                sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let {
                    sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_UI, handler)
                }
            } catch (_: SecurityException) { _status.value = LocationStatus.Unavailable }
        }
    }
    @Synchronized fun release(owner: Any) {
        owners.remove(owner)
        if (owners.isNotEmpty()) return
        val worker = thread ?: return
        Handler(worker.looper).post {
            manager.removeUpdates(listener); sensors.unregisterListener(this)
        }
    }
    private fun accept(raw: Location) {
        if (!raw.hasAccuracy() || !raw.accuracy.isFinite() || raw.accuracy < 0 ||
            SystemClock.elapsedRealtimeNanos() - raw.elapsedRealtimeNanos > 30_000_000_000L) return
        val old = last
        if (old != null) {
            val elapsed = (raw.elapsedRealtimeNanos - old.elapsedRealtimeNanos) / 1e9
            if (elapsed <= 0) return
            if (elapsed < 10 && old.provider == LocationManager.GPS_PROVIDER && old.accuracy <= 20 &&
                raw.provider != LocationManager.GPS_PROVIDER && raw.accuracy > old.accuracy) return
            if (elapsed < 5 && raw.accuracy > old.accuracy * 2) return
        }
        last = Location(raw)
        val prior = filtered
        val result = Location(raw)
        if (prior != null && raw.elapsedRealtimeNanos - prior.elapsedRealtimeNanos < 10_000_000_000L) {
            val alpha = (prior.accuracy.pow(2) / (prior.accuracy.pow(2) + raw.accuracy.pow(2))).coerceIn(.35f, .85f)
            result.longitude = prior.longitude + alpha * (raw.longitude - prior.longitude)
            result.latitude = prior.latitude + alpha * (raw.latitude - prior.latitude)
        }
        val dt = prior?.let { (raw.elapsedRealtimeNanos - it.elapsedRealtimeNanos) / 1e9 } ?: 0.0
        val distance = prior?.distanceTo(result)?.toDouble() ?: 0.0
        val reportedSpeed = if (raw.hasSpeed()) raw.speed.toDouble() else 0.0
        val inferredSpeed = if (dt > 0 && distance > max(4.0, raw.accuracy.toDouble())) distance / dt else 0.0
        val speed = if (reportedSpeed > .1) reportedSpeed else inferredSpeed
        val course = when {
            reportedSpeed >= .8 && raw.hasBearing() -> raw.bearing.toDouble()
            speed >= .8 && prior != null && distance > max(2.0, raw.accuracy * .35) -> prior.bearingTo(result).toDouble()
            speed >= .8 -> _fix.value?.heading ?: compass
            else -> compass
        }
        filtered = result
        _fix.value = NavFix(result.longitude, result.latitude, raw.accuracy.toDouble(),
            course?.let { (it + 360) % 360 }, raw.elapsedRealtimeNanos / 1_000_000, speed)
        _status.value = LocationStatus.Available
    }
    override fun onSensorChanged(event: SensorEvent) {
        if (event.accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE) return
        val matrix = FloatArray(9); val remapped = FloatArray(9); val angles = FloatArray(3)
        SensorManager.getRotationMatrixFromVector(matrix, event.values)
        @Suppress("DEPRECATION") val rotation = context.getSystemService(WindowManager::class.java).defaultDisplay.rotation
        val axes = when (rotation) {
            Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
            Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
            Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
            else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
        }
        SensorManager.remapCoordinateSystem(matrix, axes.first, axes.second, remapped)
        SensorManager.getOrientation(remapped, angles)
        val at = filtered ?: return
        val declination = GeomagneticField(at.latitude.toFloat(), at.longitude.toFloat(), at.altitude.toFloat(), System.currentTimeMillis()).declination
        val heading = (Math.toDegrees(angles[0].toDouble()) + declination + 360) % 360
        val previous = compass ?: heading
        compass = (previous + ((heading - previous + 540) % 360 - 180) * .18 + 360) % 360
        _fix.value?.takeIf { it.speed < .8 }?.let { fix ->
            val elapsed = SystemClock.elapsedRealtime()
            val difference = fix.heading?.let { abs((compass!! - it + 540) % 360 - 180) } ?: 360.0
            if (elapsed - lastHeadingEmission >= 250 && difference >= 1.0) {
                lastHeadingEmission = elapsed
                _fix.value = fix.copy(heading = compass)
            }
        }
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    companion object {
        // get() retains only applicationContext, never an Activity.
        @SuppressLint("StaticFieldLeak")
        @Volatile private var instance: CampusLocation? = null
        fun get(context: Context): CampusLocation = instance ?: synchronized(this) {
            instance ?: CampusLocation(context.applicationContext).also { instance = it }
        }
    }
}
