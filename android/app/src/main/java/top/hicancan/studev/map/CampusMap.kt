package top.hicancan.studev.map

import android.annotation.SuppressLint
import android.graphics.RectF
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.AndroidView
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.gestures.MoveGestureDetector
import org.maplibre.android.location.LocationComponentActivationOptions
import org.maplibre.android.location.LocationComponentOptions
import org.maplibre.android.location.OnCameraTrackingChangedListener
import org.maplibre.android.location.engine.LocationEngineRequest
import org.maplibre.android.location.modes.CameraMode
import org.maplibre.android.location.modes.RenderMode
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import top.hicancan.studev.location.LocationStatus
import top.hicancan.studev.location.PlatformLocationEngine
import top.hicancan.studev.app.Tokens
import top.hicancan.studev.navigation.PlannerState

internal enum class FollowMode { None, Follow, Heading }
internal class CampusMapController(initial3d: Boolean = false, initialFollow: FollowMode = FollowMode.None) {
    internal var map: MapLibreMap? = null
    var follow by mutableStateOf(initialFollow)
        private set
    var threeD by mutableStateOf(initial3d)
    var bearing by mutableDoubleStateOf(0.0)
        internal set
    var navigationFollowing by mutableStateOf(true)
    var plannerTop by mutableIntStateOf(0)
    var plannerBottom by mutableIntStateOf(0)
    internal var routeGeneration = 0
    internal var routeSourceIds = emptyList<String>()
    internal var routeSnapshot: List<Any?>? = null
    internal var routeStyle: Style? = null
    private var centering = false
    private var cameraCommand = 0
    internal fun trackingChanged(mode: Int) {
        if (centering) return
        follow = when (mode) { CameraMode.TRACKING -> FollowMode.Follow; CameraMode.TRACKING_COMPASS -> FollowMode.Heading; else -> FollowMode.None }
    }
    fun stopFollow() { follow = FollowMode.None; applyFollow() }
    fun cycleFollow() {
        follow = when (follow) { FollowMode.None -> FollowMode.Follow; FollowMode.Follow -> FollowMode.Heading; FollowMode.Heading -> FollowMode.None }
        applyFollow()
    }
    @SuppressLint("MissingPermission")
    internal fun applyFollow() {
        val component = map?.locationComponent ?: return
        if (!component.isLocationComponentActivated || !component.isLocationComponentEnabled) return
        val desired = when (follow) {
            FollowMode.None -> CameraMode.NONE
            FollowMode.Follow -> CameraMode.TRACKING
            FollowMode.Heading -> CameraMode.TRACKING_COMPASS
        }
        val ready = map ?: return
        val command = ++cameraCommand
        val fix = component.lastKnownLocation
        if (desired == CameraMode.NONE || fix == null) {
            centering = false
            ready.cancelTransitions()
            component.setCameraMode(desired)
            return
        }
        // Own initial centering: switching MapLibre tracking modes during its
        // transition can leave the camera between the old center and the fix.
        // Native follow takes over only once our cancellable animation settles.
        centering = true
        component.cameraMode = CameraMode.NONE
        ready.animateCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(ready.cameraPosition)
            .target(LatLng(fix.latitude, fix.longitude))
            .tilt(if (threeD) 55.0 else 0.0)
            .padding(0.0, 0.0, 0.0, 0.0).build()),
            Tokens.Motion.camera, object : MapLibreMap.CancelableCallback {
                override fun onFinish() {
                    if (command != cameraCommand) return
                    centering = false
                    component.setCameraMode(desired, 1L, null, null, if (threeD) 55.0 else 0.0, null)
                }
                override fun onCancel() {
                    if (command != cameraCommand) return
                    centering = false
                    follow = FollowMode.None
                }
            })
    }
}

@SuppressLint("MissingPermission")
@Composable
internal fun CampusMap(
    controller: CampusMapController,
    styleJson: String,
    dark: Boolean,
    locationGranted: Boolean,
    onLocationStatus: (LocationStatus) -> Unit,
    onReady: (MapLibreMap, Style) -> Unit,
    onTap: (android.graphics.PointF) -> Boolean,
    onCamera: () -> Unit,
    routeState: PlannerState,
    onRoute: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val density = LocalDensity.current.density
    val holder = rememberMapViewLifecycle()
    val statusCallback by rememberUpdatedState(onLocationStatus)
    val readyCallback by rememberUpdatedState(onReady)
    val tapCallback by rememberUpdatedState(onTap)
    val cameraCallback by rememberUpdatedState(onCamera)
    val currentRoute by rememberUpdatedState(routeState)
    val routeCallback by rememberUpdatedState(onRoute)
    val engine = remember(context) { PlatformLocationEngine(context.applicationContext) { statusCallback(it) } }
    val trackingListener = remember(controller) { object : OnCameraTrackingChangedListener {
        override fun onCameraTrackingChanged(currentMode: Int) { controller.trackingChanged(currentMode) }
        override fun onCameraTrackingDismissed() = Unit
    } }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var loadedStyle by remember { mutableStateOf<Style?>(null) }
    val brand = if (dark) Tokens.Color.Dark.brand else Tokens.Color.Light.brand
    DisposableEffect(holder, controller) {
        holder.view.getMapAsync { ready ->
            if (!holder.destroyed) {
                map = ready; controller.map = ready
                if (!holder.isRestored) ready.cameraPosition = CameraPosition.Builder()
                    .target(LatLng(32.1131, 118.9286)).zoom(15.75).tilt(52.0).bearing(-24.0).build()
                ready.setMinZoomPreference(13.5); ready.setMaxZoomPreference(21.0)
                ready.uiSettings.isAttributionEnabled = false; ready.uiSettings.isLogoEnabled = false; ready.uiSettings.isCompassEnabled = false
                ready.addOnCameraMoveListener { controller.bearing = ready.cameraPosition.bearing; cameraCallback() }
                ready.addOnCameraIdleListener { cameraCallback() }
                ready.addOnMoveListener(object : MapLibreMap.OnMoveListener {
                    override fun onMoveBegin(detector: MoveGestureDetector) {
                        controller.navigationFollowing = false
                        controller.stopFollow()
                    }
                    override fun onMove(detector: MoveGestureDetector) = Unit
                    override fun onMoveEnd(detector: MoveGestureDetector) = Unit
                })
                ready.addOnMapClickListener { coordinate ->
                    if (loadedStyle == null || holder.destroyed) return@addOnMapClickListener false
                    val point = ready.projection.toScreenLocation(coordinate)
                    if (currentRoute.open) {
                        val radius = 12 * density
                        val routeHit = ready.queryRenderedFeatures(RectF(point.x-radius, point.y-radius, point.x+radius, point.y+radius), "route-alternatives", "route-chosen").firstOrNull()
                        if (routeHit != null && !currentRoute.active) routeCallback(routeHit.getNumberProperty("route").toInt())
                        return@addOnMapClickListener routeHit != null
                    }
                    tapCallback(point)
                }
            }
        }
        onDispose {
            controller.map?.locationComponent?.removeOnCameraTrackingChangedListener(trackingListener)
            controller.map = null
        }
    }
    LaunchedEffect(map, styleJson) {
        val ready = map ?: return@LaunchedEffect
        loadedStyle = null
        ready.setStyle(Style.Builder().fromJson(styleJson)) { style ->
            if (!holder.destroyed) { loadedStyle = style; readyCallback(ready, style) }
        }
    }
    LaunchedEffect(map, loadedStyle, locationGranted, routeState.active) {
        val ready = map ?: return@LaunchedEffect
        val style = loadedStyle ?: return@LaunchedEffect
        val component = ready.locationComponent
        controller.routes(routeState, dark, density, fit = false)
        if (locationGranted) {
            try {
                component.removeOnCameraTrackingChangedListener(trackingListener)
                component.activateLocationComponent(LocationComponentActivationOptions.builder(context, style)
                    .useDefaultLocationEngine(false).locationEngine(if (routeState.active) null else engine)
                    .locationEngineRequest(LocationEngineRequest.Builder(1_000).setFastestInterval(1_000)
                        .setDisplacement(0f).setPriority(LocationEngineRequest.PRIORITY_HIGH_ACCURACY).build())
                    .locationComponentOptions(LocationComponentOptions.builder(context)
                        .accuracyColor(brand.toArgb()).accuracyAlpha(0.15f)
                        .foregroundTintColor(if (routeState.active) null else brand.toArgb())
                        .gpsDrawable(top.hicancan.studev.R.drawable.ic_location_course)
                        .apply { if (routeState.active) layerAbove("route-endpoint-labels") }
                        .bearingTintColor(brand.toArgb()).build()).build())
                component.isLocationComponentEnabled = true
                component.renderMode = RenderMode.COMPASS
                if (routeState.active) component.cameraMode = CameraMode.NONE else controller.applyFollow()
                component.addOnCameraTrackingChangedListener(trackingListener)
            } catch (_: SecurityException) { statusCallback(LocationStatus.Unavailable) }
        } else if (component.isLocationComponentActivated) {
            component.isLocationComponentEnabled = false; controller.stopFollow()
        }
    }
    LaunchedEffect(map, loadedStyle, routeState.routes, routeState.selected, routeState.open, dark, controller.plannerTop, controller.plannerBottom) {
        if (loadedStyle != null) controller.routes(routeState, dark, density, fit = true)
    }
    LaunchedEffect(routeState.active) { if (routeState.active) controller.navigationFollowing = true }
    LaunchedEffect(map, loadedStyle, routeState.fix, routeState.trip.phase, controller.navigationFollowing) {
        if (loadedStyle != null && routeState.trip.phase != top.hicancan.studev.navigation.TripPhase.Planning) controller.navigationPosition(routeState, density)
    }
    AndroidView(factory = { holder.view }, modifier = modifier)
}
