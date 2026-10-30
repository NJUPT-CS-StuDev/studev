package top.hicancan.studev.map

import android.annotation.SuppressLint
import android.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.location.LocationComponentActivationOptions
import org.maplibre.android.location.LocationComponentOptions
import org.maplibre.android.location.OnLocationCameraTransitionListener
import org.maplibre.android.location.engine.LocationEngineRequest
import org.maplibre.android.location.modes.CameraMode
import org.maplibre.android.location.modes.RenderMode
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import top.hicancan.studev.location.LocationStatus
import top.hicancan.studev.location.PlatformLocationEngine

/** UI-only camera commands; routing and query logic belongs in the shared kernels. */
internal class CampusMapController {
    internal var map: MapLibreMap? = null
    internal var recenterPending = false

    fun zoomIn() { map?.animateCamera(CameraUpdateFactory.zoomIn()) }
    fun zoomOut() { map?.animateCamera(CameraUpdateFactory.zoomOut()) }
    fun recenter() {
        recenterPending = true
        applyRecenter()
    }
    @SuppressLint("MissingPermission")
    internal fun applyRecenter() {
        val component = map?.locationComponent ?: return
        if (component.isLocationComponentActivated && component.isLocationComponentEnabled && recenterPending) {
            component.setCameraMode(CameraMode.TRACKING, object : OnLocationCameraTransitionListener {
                override fun onLocationCameraTransitionFinished(cameraMode: Int) {
                    component.zoomWhileTracking(17.5)
                }
                override fun onLocationCameraTransitionCanceled(cameraMode: Int) = Unit
            })
            recenterPending = false
        }
    }
}

@SuppressLint("MissingPermission")
@Composable
internal fun CampusMap(
    controller: CampusMapController,
    dark: Boolean,
    locationGranted: Boolean,
    onLocationStatus: (LocationStatus) -> Unit,
    onMapError: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val holder = rememberMapViewLifecycle()
    val statusCallback by rememberUpdatedState(onLocationStatus)
    val errorCallback by rememberUpdatedState(onMapError)
    val engine = remember(context) { PlatformLocationEngine(context.applicationContext) { statusCallback(it) } }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var loadedStyle by remember { mutableStateOf<Style?>(null) }

    DisposableEffect(holder, controller) {
        val failure = org.maplibre.android.maps.MapView.OnDidFailLoadingMapListener { errorCallback(true) }
        holder.view.addOnDidFailLoadingMapListener(failure)
        holder.view.getMapAsync { ready ->
            if (!holder.destroyed) {
                map = ready
                controller.map = ready
                // MapView restores the camera before getMapAsync. Only seed a new map.
                if (!holder.isRestored) {
                    ready.cameraPosition = CameraPosition.Builder()
                        .target(LatLng(32.115, 118.925)).zoom(16.0).build()
                }
                ready.setMinZoomPreference(12.0)
                ready.setMaxZoomPreference(21.0)
            }
        }
        onDispose {
            holder.view.removeOnDidFailLoadingMapListener(failure)
            controller.map = null
        }
    }

    LaunchedEffect(map, dark) {
        val ready = map ?: return@LaunchedEffect
        loadedStyle = null
        errorCallback(false)
        ready.setStyle(Style.Builder().fromJson(CampusStyle.load(context, dark))) { style ->
            if (!holder.destroyed) loadedStyle = style
        }
    }

    LaunchedEffect(map, loadedStyle, locationGranted) {
        val ready = map ?: return@LaunchedEffect
        val style = loadedStyle ?: return@LaunchedEffect
        val component = ready.locationComponent
        if (locationGranted) {
            try {
                component.activateLocationComponent(
                    LocationComponentActivationOptions.builder(context, style)
                        .useDefaultLocationEngine(false)
                        .locationEngine(engine)
                        .locationEngineRequest(LocationEngineRequest.Builder(1_000)
                            .setFastestInterval(1_000).setDisplacement(0f)
                            .setPriority(LocationEngineRequest.PRIORITY_HIGH_ACCURACY).build())
                        .locationComponentOptions(LocationComponentOptions.builder(context)
                            .accuracyColor(Color.rgb(46, 119, 207)).accuracyAlpha(0.15f)
                            .foregroundTintColor(Color.rgb(33, 112, 219))
                            .bearingTintColor(Color.rgb(33, 112, 219)).build())
                        .build(),
                )
                component.isLocationComponentEnabled = true
                component.renderMode = RenderMode.COMPASS
                controller.applyRecenter()
            } catch (_: SecurityException) {
                statusCallback(LocationStatus.Unavailable)
            }
        } else if (component.isLocationComponentActivated) {
            component.isLocationComponentEnabled = false
        }
    }

    AndroidView(factory = { holder.view }, modifier = modifier)
}
