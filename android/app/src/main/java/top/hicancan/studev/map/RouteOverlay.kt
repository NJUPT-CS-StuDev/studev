package top.hicancan.studev.map

import androidx.compose.ui.graphics.toArgb
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.location.LocationComponentConstants.FOREGROUND_LAYER
import org.maplibre.android.style.expressions.Expression.*
import org.maplibre.android.style.layers.*
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.*
import top.hicancan.studev.location.location
import top.hicancan.studev.navigation.PlannerState
import top.hicancan.studev.ui.theme.Tokens

internal fun CampusMapController.routes(state: PlannerState, dark: Boolean, density: Float, fit: Boolean) {
    val ready = map ?: return
    val style = ready.style ?: return
    val routes = if (state.open) state.routes else emptyList()
    val snapshot = listOf(state.open, routes, state.selected, state.origin?.id, state.destinationName, dark)
    if (routeStyle !== style || routeSnapshot != snapshot) {
        val features = routes.mapIndexed { index, route ->
            Feature.fromGeometry(LineString.fromLngLats(route.geometry.map { Point.fromLngLat(it[0], it[1]) })).also {
                it.addNumberProperty("route", index)
            }
        }
        val endpoints = state.route?.takeIf { state.open }?.let { route ->
            listOf(route.geometry.first() to (state.origin?.id ?: "起点"), route.geometry.last() to state.destinationName)
                .map { (point, label) -> Feature.fromGeometry(Point.fromLngLat(point[0], point[1])).also { it.addStringProperty("label", label) } }
        } ?: emptyList()
        // A generation owns its source IDs. Late worker results for the previous plan must
        // never replace the data of a new plan that happens to reuse the same layer names.
        for (id in listOf("route-alternatives", "route-casing", "route-chosen", "route-endpoints", "route-endpoint-labels")) style.removeLayer(id)
        routeSourceIds.forEach { style.removeSource(it) }
        val sourceId = "navigation-routes-${++routeGeneration}"
        val endpointId = "navigation-endpoints-$routeGeneration"
        routeSourceIds = listOf(sourceId, endpointId)
        routeStyle = style; routeSnapshot = snapshot
        fun addOverlay(layer: Layer) {
            if (style.getLayer(FOREGROUND_LAYER) != null) style.addLayerBelow(layer, FOREGROUND_LAYER)
            else style.addLayer(layer)
        }
        run {
            style.addSource(GeoJsonSource(sourceId, FeatureCollection.fromFeatures(features)))
            addOverlay(LineLayer("route-alternatives", sourceId).withProperties(
                lineWidth(6f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
            addOverlay(LineLayer("route-casing", sourceId).withProperties(
                lineWidth(10f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
            addOverlay(LineLayer("route-chosen", sourceId).withProperties(
                lineWidth(6f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND)))
            style.addSource(GeoJsonSource(endpointId, FeatureCollection.fromFeatures(endpoints)))
            addOverlay(CircleLayer("route-endpoints", endpointId).withProperties(
                circleRadius(8f), circleColor("#ffffff"), circleStrokeWidth(3f)))
            addOverlay(SymbolLayer("route-endpoint-labels", endpointId).withProperties(
                textField(get("label")), textSize(13f), textOffset(arrayOf(0f, -1.5f)),
                textFont(arrayOf("Noto Sans Medium")),
                textColor("#202124"), textHaloColor("#ffffff"), textHaloWidth(2f), textAllowOverlap(true)))
        }
        val main = if (dark) Tokens.Color.Dark.route else Tokens.Color.Light.route
        val casing = if (dark) Tokens.Color.Dark.routeCasing else Tokens.Color.Light.routeCasing
        val alternative = if (dark) Tokens.Color.Dark.routeAlternative else Tokens.Color.Light.routeAlternative
        style.getLayerAs<LineLayer>("route-alternatives")!!.apply {
            setFilter(neq(get("route"), literal(state.selected))); setProperties(lineColor(alternative.toArgb()))
        }
        style.getLayerAs<LineLayer>("route-casing")!!.apply {
            setFilter(eq(get("route"), literal(state.selected))); setProperties(lineColor(casing.toArgb()))
        }
        style.getLayerAs<LineLayer>("route-chosen")!!.apply {
            setFilter(eq(get("route"), literal(state.selected))); setProperties(lineColor(main.toArgb()))
        }
        style.getLayerAs<CircleLayer>("route-endpoints")!!.setProperties(circleStrokeColor(main.toArgb()))
    }
    if (fit && routes.isNotEmpty() && !state.active) {
        stopFollow()
        val bounds = LatLngBounds.Builder().includes(routes.flatMap { it.geometry }.map { LatLng(it[1], it[0]) }).build()
        // A second fit may have the same destination as a canceled in-flight animation.
        // Resolve it immediately, so MapLibre's cached animation target cannot skip the new fit.
        ready.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(ready.cameraPosition)
            .bearing(0.0).tilt(0.0).padding(0.0, 0.0, 0.0, 0.0).build()))
        ready.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, 0.0, 0.0,
            (36 * density).toInt(), controllerPadding(plannerTop, 260, density),
            (36 * density).toInt(), controllerPadding(plannerBottom, 300, density)))
    }
}

private fun controllerPadding(measured: Int, fallback: Int, density: Float) = if (measured > 0) measured else (fallback * density).toInt()

internal fun CampusMapController.navigationPosition(state: PlannerState, density: Float) {
    val fix = state.fix ?: return
    val ready = map ?: return
    val at = state.trip.update?.takeUnless { it.off_route }?.matched_position ?: fix.position
    val matched = fix.copy(longitude = at[0], latitude = at[1])
    val component = ready.locationComponent
    if (component.isLocationComponentActivated && component.isLocationComponentEnabled) {
        component.renderMode = org.maplibre.android.location.modes.RenderMode.GPS
        component.forceLocationUpdate(matched.location())
    }
    if (state.trip.phase == top.hicancan.studev.navigation.TripPhase.Arrived) {
        ready.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(ready.cameraPosition)
            .target(LatLng(at[1], at[0])).bearing(0.0).tilt(0.0).zoom(18.0)
            .padding(0.0, 80.0 * density, 0.0, 320.0 * density).build()))
        return
    }
    if (navigationFollowing && state.active) ready.animateCamera(CameraUpdateFactory.newCameraPosition(
        CameraPosition.Builder(ready.cameraPosition).target(LatLng(at[1], at[0]))
            .bearing(fix.heading ?: ready.cameraPosition.bearing).tilt(50.0).zoom(18.5)
            .padding(0.0, 140.0 * density, 0.0, 190.0 * density).build()), if (fix.speed < .8) 250 else 850)
}
