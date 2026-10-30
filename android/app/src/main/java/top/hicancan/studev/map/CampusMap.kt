package top.hicancan.studev.map

import android.annotation.SuppressLint
import android.graphics.RectF
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.AndroidView
import com.google.gson.JsonObject
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
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.visibility
import org.maplibre.android.style.sources.GeoJsonSource
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.Place
import top.hicancan.studev.location.LocationStatus
import top.hicancan.studev.location.PlatformLocationEngine
import top.hicancan.studev.ui.theme.Tokens
import top.hicancan.studev.navigation.PlannerState

internal enum class FollowMode { None, Follow, Heading }
internal class CampusMapController(initial3d: Boolean = false, initialFollow: FollowMode = FollowMode.None) {
    internal var map: MapLibreMap? = null
    var follow by mutableStateOf(initialFollow)
        private set
    var threeD by mutableStateOf(initial3d)
        private set
    var bearing by mutableDoubleStateOf(0.0)
        internal set
    var navigationFollowing by mutableStateOf(true)
    var plannerTop by mutableIntStateOf(0)
    var plannerBottom by mutableIntStateOf(0)
    internal var routeGeneration = 0
    internal var routeSourceIds = emptyList<String>()
    internal var routeSnapshot: List<Any?>? = null
    internal var routeStyle: Style? = null
    private var highlightedId: String? = null
    private var centering = false
    private var cameraCommand = 0
    internal fun trackingChanged(mode: Int) {
        if (centering) return
        follow = when (mode) { CameraMode.TRACKING -> FollowMode.Follow; CameraMode.TRACKING_COMPASS -> FollowMode.Heading; else -> FollowMode.None }
    }
    fun north() { map?.animateCamera(CameraUpdateFactory.bearingTo(0.0), Tokens.Motion.camera) }
    fun zoomIn() { map?.animateCamera(CameraUpdateFactory.zoomIn(), Tokens.Motion.standard) }
    fun zoomOut() { map?.animateCamera(CameraUpdateFactory.zoomOut(), Tokens.Motion.standard) }
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
            .target(LatLng(fix.latitude, fix.longitude)).padding(0.0, 0.0, 0.0, 0.0).build()),
            Tokens.Motion.camera, object : MapLibreMap.CancelableCallback {
                override fun onFinish() {
                    if (command != cameraCommand) return
                    centering = false
                    component.setCameraMode(desired, 1L, null, null, null, null)
                }
                override fun onCancel() {
                    if (command != cameraCommand) return
                    centering = false
                    follow = FollowMode.None
                }
            })
    }
    fun toggle3d() {
        threeD = !threeD
        applyLayers()
        val ready = map ?: return
        val camera = CameraPosition.Builder(ready.cameraPosition)
            .tilt(if (threeD) 55.0 else 0.0)
            .zoom(if (threeD) maxOf(17.0, ready.cameraPosition.zoom) else ready.cameraPosition.zoom).build()
        ready.animateCamera(CameraUpdateFactory.newCameraPosition(camera), Tokens.Motion.camera)
    }
    internal fun applyLayers() {
        map?.style?.getLayer("campus-building")?.maxZoom = 24f
        map?.style?.getLayer("campus-building-3d")?.setProperties(visibility(if (threeD) Property.VISIBLE else Property.NONE))
    }
    internal fun highlight(place: Place?) {
        val source = map?.style?.getSourceAs<GeoJsonSource>("places") ?: return
        val id = place?.let { if (it.kind == "room") it.parent else it.id }
        if (highlightedId != id) highlightedId?.let { source.removeFeatureState(it) }
        highlightedId = id
        if (id != null) source.setFeatureState(id, JsonObject().apply { addProperty("selected", true) })
    }
    fun select(place: Place, campus: CampusPackage, density: Float) {
        stopFollow()
        val at = campus.position(place) ?: return
        val ready = map ?: return
        ready.animateCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(ready.cameraPosition)
            .target(LatLng(at[1], at[0])).zoom(maxOf(17.0, ready.cameraPosition.zoom))
            .tilt(if (threeD) 55.0 else 0.0)
            .padding(0.0, 96.0 * density, 0.0, 420.0 * density).build()), Tokens.Motion.camera)
    }
}

@SuppressLint("MissingPermission")
@Composable
internal fun CampusMap(
    controller: CampusMapController,
    campus: CampusPackage,
    selected: Place?,
    dark: Boolean,
    locationGranted: Boolean,
    onPlace: (Place) -> Unit,
    onLocationStatus: (LocationStatus) -> Unit,
    onMapError: (Boolean) -> Unit,
    routeState: PlannerState,
    onRoute: (Int) -> Unit,
    modifier: Modifier = Modifier,
    homeBottom: Double = 0.0,
) {
    val context = LocalContext.current
    val density = LocalDensity.current.density
    val holder = rememberMapViewLifecycle()
    val statusCallback by rememberUpdatedState(onLocationStatus)
    val errorCallback by rememberUpdatedState(onMapError)
    val placeCallback by rememberUpdatedState(onPlace)
    val currentSelection by rememberUpdatedState(selected)
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
        val failure = org.maplibre.android.maps.MapView.OnDidFailLoadingMapListener { errorCallback(true) }
        // GeoJSON parsing finishes after onStyleLoaded. Reapply state when the
        // map is ready so a cold deep link/restoration highlights its building.
        val finished = org.maplibre.android.maps.MapView.OnDidFinishLoadingMapListener {
            if (!holder.destroyed) controller.highlight(currentSelection)
        }
        holder.view.addOnDidFailLoadingMapListener(failure)
        holder.view.addOnDidFinishLoadingMapListener(finished)
        holder.view.getMapAsync { ready ->
            if (!holder.destroyed) {
                map = ready; controller.map = ready
                if (!holder.isRestored) ready.cameraPosition = CameraPosition.Builder()
                    .target(LatLng(32.1146, 118.9262)).zoom(15.6).build()
                ready.setMinZoomPreference(12.0); ready.setMaxZoomPreference(21.0)
                ready.addOnCameraMoveListener { controller.bearing = ready.cameraPosition.bearing }
                ready.addOnMoveListener(object : MapLibreMap.OnMoveListener {
                    override fun onMoveBegin(detector: MoveGestureDetector) {
                        controller.navigationFollowing = false
                        controller.stopFollow()
                    }
                    override fun onMove(detector: MoveGestureDetector) = Unit
                    override fun onMoveEnd(detector: MoveGestureDetector) = Unit
                })
                ready.addOnCameraMoveStartedListener { reason ->
                    if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) {
                        controller.stopFollow(); controller.navigationFollowing = false
                    }
                }
                ready.addOnMapClickListener { coordinate ->
                    if (loadedStyle == null || holder.destroyed) false else {
                        val point = ready.projection.toScreenLocation(coordinate)
                        val radius = 12 * density
                        if (currentRoute.open) {
                            val routeHit = ready.queryRenderedFeatures(RectF(point.x-radius, point.y-radius, point.x+radius, point.y+radius),
                                "route-alternatives", "route-chosen").firstOrNull()
                            if (routeHit != null && !currentRoute.active) routeCallback(routeHit.getNumberProperty("route").toInt())
                            return@addOnMapClickListener routeHit != null
                        }
                        val hit = ready.queryRenderedFeatures(RectF(point.x-radius, point.y-radius, point.x+radius, point.y+radius),
                            "campus-building", "campus-building-3d", "campus-building-label", "campus-place", "campus-place-label")
                            .firstNotNullOfOrNull { feature -> feature.getStringProperty("id")?.let(campus.byId::get) }
                        hit?.let(placeCallback)
                        hit != null
                    }
                }
            }
        }
        onDispose {
            holder.view.removeOnDidFailLoadingMapListener(failure)
            holder.view.removeOnDidFinishLoadingMapListener(finished)
            controller.map?.locationComponent?.removeOnCameraTrackingChangedListener(trackingListener)
            controller.map = null
        }
    }
    LaunchedEffect(map, dark) {
        val ready = map ?: return@LaunchedEffect
        loadedStyle = null; errorCallback(false)
        ready.setStyle(Style.Builder().fromJson(campus.style(dark))) { style ->
            if (!holder.destroyed) { loadedStyle = style; controller.applyLayers() }
        }
    }
    LaunchedEffect(map, loadedStyle, selected, routeState.open, homeBottom) {
        if (loadedStyle != null) {
            controller.highlight(selected)
            if (selected != null) controller.select(selected, campus, density)
            else if (!routeState.open) map?.let { ready ->
                val bottom = homeBottom * density
                if (ready.cameraPosition.padding?.getOrNull(3) != bottom) {
                    ready.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(ready.cameraPosition)
                        .tilt(if (controller.threeD) 55.0 else 0.0)
                        .padding(0.0, 80.0 * density, 0.0, bottom).build()))
                }
            }
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
