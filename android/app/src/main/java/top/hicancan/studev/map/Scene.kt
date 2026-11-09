package top.hicancan.studev.map

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import android.animation.ValueAnimator
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.animation.DecelerateInterpolator
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.geometry.LatLngQuad
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.expressions.Expression.*
import org.maplibre.android.style.layers.*
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.light.Position
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.style.sources.ImageSource
import org.maplibre.geojson.FeatureCollection
import top.hicancan.studev.app.Tokens
import top.hicancan.studev.world.Moment
import java.time.LocalDate
import kotlin.math.*

@Serializable data class ModelRoom(val id: String, val geometry: JsonObject)
@Serializable data class ModelCore(val kind: String, val geometry: JsonObject)
@Serializable data class ModelFloor(val level: Int, val plate: JsonObject, val cores: List<ModelCore>, val rooms: List<ModelRoom>)
@Serializable data class ModelBuilding(val id: String, val levels: Int, val height: Double, val geometry: JsonObject)
@Serializable data class ModelContext(val height: Double, val geometry: JsonObject)
@Serializable data class CampusModel(val buildings: List<ModelBuilding>, val context: List<ModelContext>, val floors: Map<String, ModelFloor>)

private typealias Ring = List<DoubleArray>
private fun polygons(geometry: JsonObject): List<List<Ring>> {
    fun ring(value: JsonElement): Ring = value.jsonArray.map { doubleArrayOf(it.jsonArray[0].jsonPrimitive.double, it.jsonArray[1].jsonPrimitive.double) }
    val coordinates = geometry.getValue("coordinates").jsonArray
    return if (geometry.getValue("type").jsonPrimitive.content == "Polygon") listOf(coordinates.map(::ring)) else coordinates.map { polygon -> polygon.jsonArray.map(::ring) }
}
private val LABEL_LAYERS = listOf("way-label", "water-label", "green-label", "surface-label", "sport-label", "context-label", "nearby-label")

data class Box2(val west: Double, val south: Double, val east: Double, val north: Double) { val centre get() = doubleArrayOf((west + east) / 2, (south + north) / 2) }
fun boundsOf(geometry: JsonObject): Box2 {
    val points = polygons(geometry).flatten().flatten()
    return Box2(points.minOf { it[0] }, points.minOf { it[1] }, points.maxOf { it[0] }, points.maxOf { it[1] })
}
private fun feature(geometry: JsonObject, properties: JsonObject = JsonObject(emptyMap())) = buildJsonObject { put("type", "Feature"); put("geometry", geometry); put("properties", properties) }
private fun collection(features: List<JsonObject>) = FeatureCollection.fromJson(buildJsonObject { put("type", "FeatureCollection"); put("features", JsonArray(features)) }.toString())
private fun inset(geometry: JsonObject, by: Double): JsonObject {
    fun shrink(ring: Ring): JsonElement {
        val count = maxOf(1, ring.size - 1)
        val x = ring.take(count).sumOf { it[0] } / count
        val y = ring.take(count).sumOf { it[1] } / count
        return JsonArray(ring.map { JsonArray(listOf(JsonPrimitive(x + (it[0] - x) * by), JsonPrimitive(y + (it[1] - y) * by))) })
    }
    val all = polygons(geometry)
    return buildJsonObject {
        put("type", "MultiPolygon")
        put("coordinates", JsonArray(all.map { polygon -> JsonArray(polygon.map(::shrink)) }))
    }
}
private fun principalBearing(geometry: JsonObject): Double {
    val ring = polygons(geometry).first().first()
    val cosine = cos(32.11 * PI / 180)
    var best = 0.0; var angle = 0.0
    for (i in 0 until ring.size - 1) {
        val dx = (ring[i + 1][0] - ring[i][0]) * cosine; val dy = ring[i + 1][1] - ring[i][1]
        if (dx * dx + dy * dy > best) { best = dx * dx + dy * dy; angle = atan2(dx, dy) * 180 / PI }
    }
    var bearing = angle - 90
    while (bearing > 90) bearing -= 180
    while (bearing < -90) bearing += 180
    return bearing
}
object Sun {
    /** Altitude and azimuth over the campus, in degrees. Same formula as the web's sun.ts. */
    fun at(date: LocalDate, minutes: Int): Pair<Double, Double> {
        val radian = PI / 180; val latitude = 32.11 * radian
        val n = date.dayOfYear.toDouble()
        val declination = 23.44 * sin(2 * PI * (284 + n) / 365) * radian
        val b = 2 * PI * (n - 81) / 364
        val equation = 9.87 * sin(2 * b) - 7.53 * cos(b) - 1.5 * sin(b)
        val hour = ((minutes + 4 * (118.92 - 120) + equation) / 4 - 180) * radian
        val altitude = asin(sin(latitude) * sin(declination) + cos(latitude) * cos(declination) * cos(hour))
        val azimuth = atan2(-sin(hour) * cos(declination), cos(latitude) * sin(declination) - sin(latitude) * cos(declination) * cos(hour))
        return altitude / radian to (azimuth / radian + 360) % 360
    }
}
private fun mix(a: Color, b: Color, t: Float) = Color(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t)
private fun hex(color: Color) = color.toArgb()
data class RoomPaint(val id: String, val tier: String, val label: String, val named: Boolean)

/** The campus scene. A flat map is this scene seen from straight above; there is no second mode. */
class Scene(private val map: MapLibreMap, private val style: Style, val model: CampusModel) {
    val buildings = model.buildings.associateBy { it.id }
    var night by androidx.compose.runtime.mutableFloatStateOf(0f); private set
    var openBuilding: String? = null; private set
    var openFloor: Int? = null; private set
    private var level = 0.0
    var flatten = 1f; private set
    var roomTop = 0.0; private set
    private var animator: ValueAnimator? = null
    private val day = Tokens.Scene.Day; private val dusk = Tokens.Scene.Night
    private fun ground() = mix(day.ground, dusk.ground, night); private fun campus() = mix(day.campus, dusk.campus, night)
    private fun modelColor() = mix(day.model, dusk.model, night)
    private val shadowW = 1024; private val shadowH = 1260
    private val north = 32.128; private val south = 32.102; private val west = 118.912; private val east = 118.938
    private val shadow = Bitmap.createBitmap(shadowW, shadowH, Bitmap.Config.ARGB_8888)
    private val shadowSource = ImageSource("shadow", LatLngQuad(LatLng(north, west), LatLng(north, east), LatLng(south, east), LatLng(south, west)), shadow)
    private var lastSun = ""
    init {
        style.addSource(shadowSource)
        style.addLayerBelow(RasterLayer("shadow", "shadow").withProperties(rasterOpacity(.16f), rasterFadeDuration(0f)), "context")
        for (id in listOf("sel", "selshell", "selcore", "selrooms")) style.addSource(GeoJsonSource(id))
        fun extrusion(id: String, source: String) = FillExtrusionLayer(id, source).withProperties(visibility(Property.NONE), fillExtrusionHeight(1f), fillExtrusionVerticalGradient(false))
        style.addLayer(extrusion("sel-lower", "sel")); style.addLayer(extrusion("sel-slab", "sel"))
        style.addLayer(extrusion("sel-rooms", "selrooms").withProperties(fillExtrusionColor(get("c"))))
        style.addLayer(extrusion("sel-core", "selcore").withProperties(fillExtrusionColor(hex(Color(0xFFE3E5E8)))))
        style.addLayer(extrusion("sel-upper", "selshell"))
    }
    fun destroy() { animator?.cancel() }
    private var modelled: Models.Index? = null
    /** Puts the baked model in; forms stay as the tap target and the plain stand-ins go. */
    fun showModels(loaded: Models.Loaded) {
        modelled = loaded.index
        setFormsFilter(openBuilding)
        style.addLayerAbove(org.maplibre.android.style.layers.CustomLayer("models", Models.host(loaded.bytes, loaded.index.origin[0], loaded.index.origin[1], loaded.index.scale)), "plain")
        look()
        map.triggerRepaint()
    }
    private fun setFormsFilter(open: String?) {
        val other = neq(get("building"), literal(open ?: ""))
        (style.getLayer("forms") as? FillExtrusionLayer)?.setFilter(if (open != null) other else literal(true))
        val drawn = modelled?.buildings?.keys.orEmpty().toTypedArray()
        (style.getLayer("plain") as? FillExtrusionLayer)?.setFilter(all(other, not(`in`(get("building"), literal(drawn)))))
    }
    private fun look() {
        val index = modelled ?: return
        val open = openBuilding?.takeIf(::hasFloors)
        val skip = open?.let { index.buildings[it] }
        val fade = mix(mix(day.model, dusk.model, night), campus(), .72f)
        Models.look(skip?.get(0) ?: -1, skip?.get(1) ?: 0, flatten, night, if (open != null) 1f else 0f, fade.red, fade.green, fade.blue)
        map.triggerRepaint()
    }
    fun hasFloors(id: String) = model.floors.keys.any { it.startsWith("$id/") }
    fun floorsOf(id: String) = model.floors.filterKeys { it.startsWith("$id/") }.values.map { it.level }.sorted()
    fun roomsOf(id: String, floor: Int) = model.floors["$id/$floor"]?.rooms.orEmpty()
    fun coresOf(id: String, floor: Int) = model.floors["$id/$floor"]?.cores.orEmpty()
    fun centreOf(id: String) = buildings[id]?.let { boundsOf(it.geometry).centre }
    private fun set(layer: String, vararg properties: PropertyValue<*>) { style.getLayer(layer)?.setProperties(*properties) }
    /** The light of a moment. A chosen appearance holds it at day or night; "system" follows the sun. */
    fun moment(at: Moment, appearance: String) {
        val (altitude, azimuth) = Sun.at(at.date, if (appearance == "light" && Sun.at(at.date, at.min).first < 8) 720 else at.min)
        val value = if (appearance == "dark") 1f else if (appearance == "light") 0f else if (altitude >= 8) 0f else if (altitude <= -5) 1f else ((8 - altitude) / 13).toFloat()
        if (abs(value - night) > .005f || lastSun.isEmpty()) { night = value; paintGround(); paintBuildings() }
        val key = "${at.date}:${at.min / 10}:$appearance"
        if (key != lastSun) { lastSun = key; drawShadows(altitude, azimuth) }
    }
    private fun paintGround() {
        set("bg", backgroundColor(hex(ground()))); set("campus", fillColor(hex(campus())))
        set("surfaces", fillColor(hex(mix(day.surface, dusk.surface, night)))); set("greens", fillColor(hex(mix(day.green, dusk.green, night))))
        set("sports", fillColor(hex(mix(day.sport, dusk.sport, night)))); set("waters", fillColor(hex(mix(day.water, dusk.water, night))))
        set("roads", lineColor(hex(mix(day.road, dusk.road, night)))); set("paths", lineColor(hex(mix(day.path, dusk.path, night))))
        set("context", fillExtrusionColor(hex(mix(day.context, dusk.context, night))))
        for (layer in LABEL_LAYERS) set(layer, textColor(hex(mix(day.label, dusk.label, night))), textHaloColor(hex(mix(day.halo, dusk.halo, night))))
        set("sel-lower", fillExtrusionColor(hex(modelColor()))); set("sel-upper", fillExtrusionColor(hex(modelColor())))
        set("sel-slab", fillExtrusionColor(hex(mix(day.slab, dusk.slab, night))))
    }
    /** The forms carry their own colours, dimmed as the night comes on. */
    private fun paintBuildings() {
        val base = modelColor()
        val open = openBuilding?.let(::hasFloors) == true
        val own = toRgba(toColor(get("color")))
        val dim = literal(1 - night * .78f)
        val lit = if (night < .01f) toColor(get("color")) else rgba(product(at(literal(0), own), dim), product(at(literal(1), own), dim), product(at(literal(2), own), dim), literal(1))
        if (open) {
            val faded = hex(mix(base, campus(), .72f))
            set("plain", fillExtrusionColor(faded))
            look()
            return
        }
        set("plain", fillExtrusionColor(lit))
        look()
    }
    private fun drawShadows(altitude: Double, azimuth: Double) {
        shadow.eraseColor(android.graphics.Color.TRANSPARENT)
        fun merc(lat: Double) = ln(tan(PI / 4 + lat * PI / 360))
        fun x(lon: Double) = ((lon - west) / (east - west) * shadowW).toFloat()
        fun y(lat: Double) = ((merc(north) - merc(lat)) / (merc(north) - merc(south)) * shadowH).toFloat()
        if (altitude > 1.5) {
            val length = 1 / tan(max(altitude, 7.0) * PI / 180)
            val turn = azimuth * PI / 180
            val dLon = -sin(turn) * length / (111320 * cos(32.11 * PI / 180)); val dLat = -cos(turn) * length / 110574
            val canvas = Canvas(shadow)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.BLACK }
            for ((geometry, height) in model.context.map { it.geometry to it.height } + model.buildings.map { it.geometry to it.height }) for (polygon in polygons(geometry)) {
                val edge = polygon.first()
                val dx = dLon * height; val dy = dLat * height
                canvas.drawPath(Path().apply { edge.forEachIndexed { i, p -> if (i == 0) moveTo(x(p[0] + dx), y(p[1] + dy)) else lineTo(x(p[0] + dx), y(p[1] + dy)) }; close() }, paint)
                for (i in 0 until edge.size - 1) canvas.drawPath(Path().apply {
                    moveTo(x(edge[i][0]), y(edge[i][1])); lineTo(x(edge[i + 1][0]), y(edge[i + 1][1])); lineTo(x(edge[i + 1][0] + dx), y(edge[i + 1][1] + dy)); lineTo(x(edge[i][0] + dx), y(edge[i][1] + dy)); close()
                }, paint)
            }
        }
        shadowSource.setImage(shadow)
        val strength = if (altitude <= 1.5) 0f else min(.2f, (.05 + altitude / 60).toFloat())
        val opacity = if (openBuilding?.let(::hasFloors) == true) 0f else if (night > .55f) strength * .9f else strength
        set("shadow", rasterOpacity(opacity))
        style.light?.let { light ->
            light.anchor = Property.ANCHOR_MAP
            light.position = Position(1.25f, azimuth.toFloat(), max(16f, min(34f, (90 - max(altitude, 10.0)).toFloat())))
            light.color = if (altitude < 14 && altitude > 0) "#FFE3C4" else "#FFFFFF"
            light.intensity = if (night > .55f || altitude <= 0) .26f else .2f
        }
    }
    private fun setFlatten(value: Float) {
        flatten = value
        look()
        for (layer in listOf("forms", "plain")) set(layer, fillExtrusionHeight(product(get("top"), literal(value))), fillExtrusionBase(product(get("base"), literal(value))))
        set("context", fillExtrusionHeight(product(coalesce(toNumber(get("height_m")), product(toNumber(coalesce(get("levels"), literal(0))), literal(3.4))), literal(value))))
    }
    private fun paintLevel(lift: Double, lid: Float) {
        val shape = buildings.getValue(openBuilding!!)
        val floorHeight = shape.height / shape.levels
        val wall = max(1.3, floorHeight * .42)
        val base = level
        set("sel-lower", fillExtrusionHeight(max(.01, base).toFloat()))
        set("sel-slab", fillExtrusionBase(base.toFloat()), fillExtrusionHeight((base + .18).toFloat()))
        set("sel-rooms", fillExtrusionBase((base + .18).toFloat()), fillExtrusionHeight((base + .18 + wall).toFloat()))
        set("sel-core", fillExtrusionBase((base + .18).toFloat()), fillExtrusionHeight((base + .18 + wall * .5).toFloat()))
        roomTop = base + .18 + wall
        if (lid > 0f) set("sel-upper", fillExtrusionBase((base + floorHeight + lift).toFloat()), fillExtrusionHeight(max(base + floorHeight + lift + .01, shape.height + lift).toFloat()), fillExtrusionOpacity(lid))
        set("sel-upper", visibility(if (lid > .01f) Property.VISIBLE else Property.NONE))
    }
    private fun animate(ms: Long, frame: (Float) -> Unit) {
        animator?.cancel()
        animator = ValueAnimator.ofFloat(0f, 1f).apply { duration = ms; interpolator = DecelerateInterpolator(1.5f); addUpdateListener { frame(it.animatedValue as Float) }; start() }
    }
    private fun showSelection(on: Boolean) {
        for (layer in listOf("sel-lower", "sel-slab", "sel-rooms", "sel-core")) set(layer, visibility(if (on) Property.VISIBLE else Property.NONE))
        if (!on) set("sel-upper", visibility(Property.NONE))
    }
    /** Opens a building at a floor: the part above lifts away and the campus sinks. */
    fun enter(id: String, floor: Int, paints: List<RoomPaint>, padding: IntArray, tilt: Double, focus: List<JsonObject>, instant: Boolean) {
        val shape = buildings[id] ?: return
        val same = openBuilding == id
        openBuilding = id; openFloor = floor
        val target = (floor - 1) * shape.height / shape.levels
        setFormsFilter(id)
        paintBuildings()
        val data = model.floors["$id/$floor"]
        style.getSourceAs<GeoJsonSource>("selshell")?.setGeoJson(collection(listOf(feature(shape.geometry))))
        style.getSourceAs<GeoJsonSource>("sel")?.setGeoJson(collection(listOf(feature(data?.plate ?: shape.geometry))))
        style.getSourceAs<GeoJsonSource>("selcore")?.setGeoJson(collection(data?.cores.orEmpty().map { feature(it.geometry) }))
        paintRooms(paints)
        showSelection(true)
        when {
            instant -> { level = target; paintLevel(0.0, 0f); setFlatten(.14f) }
            same -> { val from = level; animate(380) { level = from + (target - from) * it; paintLevel(0.0, 0f) } }
            else -> { level = target; paintLevel(0.0, 1f); val start = flatten; animate(780) { paintLevel(it * 22.0, 1 - it); setFlatten(start + (.14f - start) * it) } }
        }
        fly(shape.geometry, padding, tilt, focus, instant)
    }
    fun paintRooms(paints: List<RoomPaint>) {
        val building = openBuilding ?: return; val floor = openFloor ?: return
        val palette = if (night > .55f) Tokens.Scene.Room.Night.let { mapOf("long" to it.long, "mid" to it.mid, "short" to it.short, "busy" to it.busy, "other" to it.other, "picked" to it.picked) }
            else Tokens.Scene.Room.Day.let { mapOf("long" to it.long, "mid" to it.mid, "short" to it.short, "busy" to it.busy, "other" to it.other, "picked" to it.picked) }
        val byId = paints.associateBy { it.id }
        fun css(color: Color) = "rgb(${(color.red * 255).roundToInt()},${(color.green * 255).roundToInt()},${(color.blue * 255).roundToInt()})"
        style.getSourceAs<GeoJsonSource>("selrooms")?.setGeoJson(collection(roomsOf(building, floor).map { room ->
            feature(inset(room.geometry, .97), buildJsonObject { put("id", room.id); put("c", css(palette.getValue(byId[room.id]?.tier ?: "other"))) })
        }))
    }
    private fun fly(geometry: JsonObject, padding: IntArray, tilt: Double, focus: List<JsonObject>, instant: Boolean) {
        val boxes = focus.ifEmpty { listOf(geometry) }.map(::boundsOf)
        val bounds = LatLngBounds.from(boxes.maxOf { it.north }, boxes.maxOf { it.east }, boxes.minOf { it.south }, boxes.minOf { it.west })
        val bearing = principalBearing(geometry)
        val shown = if (tilt > 0) min(tilt, 44.0) else 0.0
        val camera = map.getCameraForLatLngBounds(bounds, padding, bearing, shown)
        val zoom = (camera?.zoom ?: 18.0).coerceIn(18.1, 19.1)
        // The fitted camera names the middle of the bounds; shift it so they sit in the part of the screen the panels leave free.
        val middle = camera?.target ?: map.cameraPosition.target ?: return
        val latitude = Math.toRadians(middle.latitude)
        val metresPerDp = 40075016.686 * kotlin.math.cos(latitude) / (512 * 2.0.pow(zoom))
        val lift = (padding[3] - padding[1]) / 2.0 / android.content.res.Resources.getSystem().displayMetrics.density * metresPerDp / kotlin.math.cos(Math.toRadians(shown))
        val heading = Math.toRadians(bearing)
        val centre = LatLng(middle.latitude - lift * kotlin.math.cos(heading) / 111320, middle.longitude - lift * kotlin.math.sin(heading) / (111320 * kotlin.math.cos(latitude)))
        val target = CameraPosition.Builder().target(centre).zoom(zoom).bearing(bearing).tilt(shown).build()
        if (instant) map.moveCamera(CameraUpdateFactory.newCameraPosition(target)) else map.animateCamera(CameraUpdateFactory.newCameraPosition(target), 1050)
    }
    fun exit() {
        if (openBuilding == null) return
        openBuilding = null; openFloor = null
        showSelection(false)
        setFormsFilter(null)
        paintBuildings()
        val start = flatten
        animate(520) { setFlatten(start + (1 - start) * it) }
    }
    fun focus(at: DoubleArray, instant: Boolean) {
        val target = CameraPosition.Builder().target(LatLng(at[1], at[0])).zoom(max(map.cameraPosition.zoom, 17.4)).build()
        if (instant) map.moveCamera(CameraUpdateFactory.newCameraPosition(target)) else map.animateCamera(CameraUpdateFactory.newCameraPosition(target), 900)
    }
    private fun pitchLimit() = if (openBuilding != null) 44.0 else 60.0
    /** Turn the camera directly under a finger; bearing is unbounded, pitch stays within what the scene can show. */
    fun steer(turn: Double, lean: Double) {
        val camera = map.cameraPosition
        map.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(camera).bearing(camera.bearing + turn).tilt((camera.tilt + lean).coerceIn(0.0, pitchLimit())).build()))
    }
    /** Turn by `by` degrees over `ms`, as the ball's first-run hint does. */
    fun nudge(by: Double, ms: Int) {
        val camera = map.cameraPosition
        map.animateCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(camera).bearing(camera.bearing + by).build()), ms)
    }
    /** Back to north, seen from straight above; from there, back to the raised view. */
    fun square() {
        val camera = map.cameraPosition
        val upright = camera.tilt < 4 && min(camera.bearing, 360 - camera.bearing) < 1
        map.animateCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(camera).bearing(0.0).tilt(if (upright) min(52.0, pitchLimit()) else 0.0).build()), 800)
    }
    fun hitRoom(point: android.graphics.PointF): String? = if (openBuilding?.let(::hasFloors) == true) map.queryRenderedFeatures(point, "sel-rooms").firstOrNull()?.getStringProperty("id") else null
    private val outlines by lazy { model.buildings.associate { it.id to polygons(it.geometry) } }
    /**
     * Which building a tap lands on, read from the footprints: Android cannot query a transparent layer, and
     * a barely visible one veils the models on some GPUs. A tilted building stands above its footprint,
     * so look straight down the screen from the tap, as far as that building is tall.
     */
    fun hitBuilding(point: android.graphics.PointF, density: Float): String? {
        val camera = map.cameraPosition
        val perMetre = density / map.projection.getMetersPerPixelAtLatitude(camera.target?.latitude ?: 32.11)
        val rise = kotlin.math.sin(Math.toRadians(camera.tilt)) * perMetre
        var down = 0f
        while (down <= 40 * rise) {
            val at = map.projection.fromScreenLocation(android.graphics.PointF(point.x, point.y + down))
            val hit = outlines.entries.firstOrNull { (id, rings) -> id != openBuilding && rings.any { inside(it, at.longitude, at.latitude) } }?.key
            if (hit != null && down <= (buildings[hit]?.height ?: 0.0) * rise + 6 * density) return hit
            down += 6 * density
        }
        return null
    }
    /** Polygons as lists of rings of lon, lat; holes follow their outer ring. */
    private fun polygons(geometry: JsonObject): List<List<List<DoubleArray>>> {
        val coordinates = geometry.getValue("coordinates").jsonArray
        fun polygon(rings: JsonArray) = rings.map { ring -> ring.jsonArray.map { point -> point.jsonArray.let { doubleArrayOf(it[0].jsonPrimitive.double, it[1].jsonPrimitive.double) } } }
        return if (geometry.getValue("type").jsonPrimitive.content == "MultiPolygon") coordinates.map { polygon(it.jsonArray) } else listOf(polygon(coordinates))
    }
    private fun inside(rings: List<List<DoubleArray>>, x: Double, y: Double): Boolean {
        var odd = false
        for (ring in rings) for (i in ring.indices) {
            val a = ring[i]; val b = ring[(i + 1) % ring.size]
            if ((a[1] > y) != (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) odd = !odd
        }
        return odd
    }
    fun hitOpenFloor(point: android.graphics.PointF) = openBuilding?.let(::hasFloors) == true && map.queryRenderedFeatures(point, "sel-lower", "sel-slab").isNotEmpty()
}
