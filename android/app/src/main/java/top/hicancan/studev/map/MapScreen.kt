package top.hicancan.studev.map

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import top.hicancan.studev.app.*
import top.hicancan.studev.app.AcademicState
import top.hicancan.studev.data.*
import top.hicancan.studev.location.*
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.navigation.*
import top.hicancan.studev.app.marks
import top.hicancan.studev.world.*
import java.time.DayOfWeek
import kotlin.math.*

private const val RULER_START = 7 * 60
private const val RULER_END = 22 * 60

private class LabelInfo(val id: String, val text: String, val at: DoubleArray, val height: Double, val minZoom: Double, val priority: Int, val teach: Boolean, val place: Boolean)
private class Placed(val key: String, val text: String, val count: Int?, val x: Int, val y: Int, val kind: String, val tap: (() -> Unit)?)

/** Pick a moment, unfold campus, building, floor and room. */
@Composable fun MapScreen(route: Route, state: AcademicState, settings: PersonalSettings, campus: CampusPackage, now: Moment, runtime: NavigationRuntime, onPick: () -> Unit) {
    val context = LocalContext.current
    val density = LocalDensity.current.density
    val dark = isSystemInDarkTheme()
    val navigation by runtime.state.collectAsStateWithLifecycle()
    val controller = remember { CampusMapController() }
    val model by produceState<CampusModel?>(null, campus) {
        value = withContext(Dispatchers.IO) { Json { ignoreUnknownKeys = true }.decodeFromString<CampusModel>(context.assets.open("${CampusPackage.BASE}/model.json").bufferedReader().use { it.readText() }) }
    }
    var scene by remember { mutableStateOf<Scene?>(null) }
    var cameraTick by remember { mutableIntStateOf(0) }
    var mapRef by remember { mutableStateOf<MapLibreMap?>(null) }
    var snap by remember { mutableIntStateOf(0) }
    var closed by remember { mutableStateOf(false) }
    LaunchedEffect(route.place, route.nav) { if (route.place != null || route.nav != null) closed = false }
    var dragPeek by remember { mutableStateOf<Float?>(null) }
    var picker by remember { mutableStateOf<Boolean?>(null) }
    var campusOpen by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf(LocationStatus.Waiting) }
    val (access, requestLocation) = rememberLocationPermission { }
    val moment = route.moment?.let { Moment(it.first, it.second) } ?: now
    val isNow = route.moment == null
    val rooms = state.rooms
    val reader = remember(state.periods) { if (state.periods.isEmpty()) null else RoomReader(state.periods) }
    var day by remember { mutableStateOf<RoomDay?>(null) }
    LaunchedEffect(moment.date, state.repository, rooms) {
        day = rooms?.let { index -> state.repository?.let { repo -> runCatching { repo.roomDay(index.term, moment.date.toString()) }.getOrNull() } }
    }
    val classrooms = remember(rooms) { rooms?.rooms.orEmpty().filter(RoomReader::classroom) }
    val roomById = remember(rooms) { rooms?.rooms.orEmpty().associateBy { it.id } }
    val freeBy = remember(day, moment.min, classrooms, reader) {
        val out = mutableMapOf<String, Pair<Int, Int>>()
        for (room in classrooms) {
            val key = "${room.campus}/${room.building}"
            val (free, total) = out[key] ?: (0 to 0)
            out[key] = (free + if (day != null && reader?.at(day, room.id, moment.min)?.busy == false) 1 else 0) to (total + 1)
        }
        out as Map<String, Pair<Int, Int>>
    }
    val selected = route.place?.let(campus.byId::get)
    fun buildingOf(place: Place?): Place? { var current = place; while (current != null && current.kind != "building") current = campus.byId[current.parent]; return current }
    val openBuilding = buildingOf(selected)
    val picked = selected?.takeIf { it.kind == "room" }
    val buildingId = openBuilding?.id
    val floors = remember(scene, buildingId) { if (buildingId != null) scene?.floorsOf(buildingId).orEmpty() else emptyList() }
    val inBuilding = remember(classrooms, buildingId) { classrooms.filter { "${it.campus}/${it.building}" == buildingId } }
    val bestFloor = floors.maxByOrNull { level -> inBuilding.count { it.floor.toIntOrNull() == level && reader?.at(day, it.id, moment.min)?.busy == false } }
    val floor = picked?.floor?.toIntOrNull() ?: route.floor?.takeIf { it in floors } ?: bestFloor
    val paints = remember(scene, buildingId, floor, day, moment.min, picked?.id) {
        val active = scene
        if (active == null || buildingId == null || floor == null) emptyList() else active.roomsOf(buildingId, floor).map { row ->
            val place = campus.byId[row.id]
            val room = roomById[row.id]
            RoomPaint(row.id, if (row.id == picked?.id) "picked" else if (room != null && RoomReader.classroom(room) && day != null) reader!!.at(day, row.id, moment.min).tier else "other",
                place?.title ?: place?.names?.firstOrNull() ?: row.id.substringAfterLast('-'), place?.title != null)
        }
    }
    LaunchedEffect(scene, freeBy) { scene?.setTint(freeBy.mapValues { (_, value) -> value.first.toFloat() / max(1, value.second) }) }
    LaunchedEffect(scene, moment, settings.theme) { scene?.moment(moment, settings.theme) }
    val screenDp = androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp
    val padding = remember(density, picked != null, screenDp) { intArrayOf((28 * density).toInt(), (70 * density).toInt(), (64 * density).toInt(), ((if (picked != null) screenDp * .62f + 30 else 280f) * density).toInt()) }
    var entered by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(scene, buildingId, floor, picked?.id, route.nav, paints) {
        val active = scene ?: return@LaunchedEffect
        if (route.nav != null) { if (entered != null) { active.exit(); entered = null }; return@LaunchedEffect }
        if (buildingId != null && floor != null && active.hasFloors(buildingId)) {
            val key = "$buildingId/$floor/${picked?.id}"
            if (entered != key) {
                val rows = active.roomsOf(buildingId, floor)
                val focus = (if (picked != null) rows.filter { it.id == picked.id } else rows).map { it.geometry }
                active.enter(buildingId, floor, paints, padding, mapRef?.cameraPosition?.tilt ?: 52.0, focus, entered == null)
                entered = key
            } else active.paintRooms(paints)
        } else {
            if (entered != null) { active.exit(); entered = null }
            (selected?.centre?.toDoubleArray() ?: buildingId?.let(active::centreOf))?.let { active.focus(it, false) }
        }
    }
    LaunchedEffect(route.nav, campus) {
        route.nav?.let(campus.byId::get)?.let { target -> runtime.open(target); if (!access.granted) requestLocation() }
    }
    LaunchedEffect(navigation.open) { if (!navigation.open) route.nav = null }
    val labels = remember(model, scene) {
        val active = model ?: return@remember emptyList<LabelInfo>()
        buildList {
            for (building in active.buildings) {
                val place = campus.byId[building.id]; val name = place?.names?.firstOrNull() ?: continue
                val dorm = place.category == "宿舍" || Regex("苑\\d").containsMatchIn(name)
                add(LabelInfo(building.id, name, boundsOf(building.geometry).centre, building.height, if (building.id in classrooms.map { "${it.campus}/${it.building}" }) 14.5 else if (dorm) 16.9 else 15.7, if (building.id in freeBy) 0 else if (dorm) 3 else 1, building.id in freeBy, false))
            }
            for (place in campus.places) {
                if (place.kind != "place" || place.centre == null || place.names.isEmpty() || place.category in setOf("停车场", "学院", "宿舍", "公交站")) continue
                add(LabelInfo(place.id, place.names.first(), place.centre.toDoubleArray(), 0.0, 17.7, 4, false, true))
            }
        }.sortedBy { it.priority }
    }
    Box(Modifier.fillMaxSize().background(Ink.sunken)) {
        var canvas by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
        Box(Modifier.fillMaxSize().onSizeChanged { canvas = it }) {
            CampusMap(controller, campus.style, (scene?.night ?: 0f) > .55f, access.granted, onLocationStatus = { status = it },
                onReady = { map: MapLibreMap, style: Style -> mapRef = map; model?.let { scene?.destroy(); scene = Scene(map, style, it) } },
                onTap = { point ->
                    val active = scene
                    val room = active?.hitRoom(point)
                    val building = active?.hitBuilding(point)
                    when {
                        room != null -> { route.place = room; route.floor = null; snap = 1; true }
                        building != null && campus.byId.containsKey(building) -> { route.place = building; route.floor = null; snap = 0; true }
                        active?.hitOpenFloor(point) == true -> true
                        route.place != null -> { route.place = null; route.floor = null; snap = 0; true }
                        else -> false
                    }
                },
                onCamera = { cameraTick++ }, routeState = navigation, onRoute = runtime::choose, modifier = Modifier.fillMaxSize())
            LaunchedEffect(model, mapRef) { val map = mapRef; val data = model; if (map != null && data != null && scene == null) map.style?.let { scene = Scene(map, it, data) } }
            // Labels are placed over the model at their real height, so they stay on the roofs when the view tilts.
            val placed = remember(cameraTick, scene, labels, freeBy, paints, canvas) {
                val map = mapRef; val active = scene
                if (map == null || active == null || canvas.width == 0) emptyList() else buildList<Placed> {
                    val camera = map.cameraPosition
                    val zoom = camera.zoom
                    val pitch = camera.tilt * PI / 180
                    val perMetre = density * 512 * 2.0.pow(zoom) / (40075016.686 * cos(32.11 * PI / 180))
                    val distance = .5 * canvas.height / tan(36.87 * PI / 360)
                    val centre = map.projection.toScreenLocation(camera.target ?: LatLng(32.113, 118.928))
                    fun project(at: DoubleArray, metres: Double): Pair<Float, Float> {
                        val point = map.projection.toScreenLocation(LatLng(at[1], at[0]))
                        val rise = metres * perMetre
                        val scale = distance / max(1.0, distance - rise * cos(pitch))
                        return (centre.x + (point.x - centre.x) * scale).toFloat() to (centre.y + (point.y - centre.y) * scale - rise * sin(pitch) * scale).toFloat()
                    }
                    val open = active.openBuilding?.let(active::hasFloors) == true
                    val taken = mutableListOf<FloatArray>()
                    for (label in labels) {
                        if (zoom < label.minZoom || (open && (label.id == active.openBuilding || label.place))) continue
                        val (x, y) = project(label.at, if (open) label.height * active.flatten else label.height)
                        if (x < -40 || x > canvas.width + 40 || y < 0 || y > canvas.height) continue
                        val w = (label.text.length * (if (label.teach) 13 else 11) + if (label.teach) 40 else 8) * density
                        val h = (if (label.teach) 26 else 16) * density
                        val box = floatArrayOf(x - w / 2, y - h / 2 - 6, x + w / 2, y + h / 2 + 2)
                        if (taken.any { box[0] < it[2] && it[0] < box[2] && box[1] < it[3] && it[1] < box[3] }) continue
                        taken += box
                        add(Placed(label.id, label.text, if (label.teach) freeBy[label.id]?.first ?: 0 else null, x.toInt(), y.toInt(), if (label.teach) "teach" else if (label.priority >= 3) "minor" else "plain") { route.place = label.id; route.floor = null; snap = 0 })
                    }
                    if (open && floor != null) {
                        val building = active.openBuilding!!
                        for (paint in paints) {
                            val row = active.roomsOf(building, floor).firstOrNull { it.id == paint.id } ?: continue
                            val box = boundsOf(row.geometry)
                            val a = map.projection.toScreenLocation(LatLng(box.south, box.west)); val b = map.projection.toScreenLocation(LatLng(box.north, box.east))
                            if (paint.tier != "picked" && (hypot(a.x - b.x, a.y - b.y) / density * .62 < 20 || zoom < 17.4)) continue
                            val (x, y) = project(box.centre, active.roomTop)
                            add(Placed(paint.id, paint.label, null, x.toInt(), y.toInt(), "room-${paint.tier}", null))
                        }
                        for (core in active.coresOf(building, floor)) {
                            val box = boundsOf(core.geometry)
                            val a = map.projection.toScreenLocation(LatLng(box.south, box.west)); val b = map.projection.toScreenLocation(LatLng(box.north, box.east))
                            if (hypot(a.x - b.x, a.y - b.y) / density * .62 < 22 || zoom < 17.4) continue
                            val (x, y) = project(box.centre, active.roomTop)
                            add(Placed(core.kind + box.west, mapOf("stairs" to "楼梯", "wc" to "卫生间", "lift" to "电梯")[core.kind].orEmpty(), null, x.toInt(), y.toInt(), "core", null))
                        }
                    }
                }
            }
            val mark = marks()
            val nightScene = (scene?.night ?: 0f) > .55f
            SystemBarIcons(light = nightScene, restoreLight = dark)
            placed.forEach { item -> key(item.key) { MapLabel(item, nightScene, mark.free) } }
        }
        if (navigation.open) {
            NavigationScreen(navigation, runtime, controller, access.granted, requestLocation, pick = { origin -> picker = origin })
        } else {
            Row(Modifier.align(Alignment.TopStart).statusBarsPadding().padding(start = 12.dp, top = 12.dp, end = 60.dp).height(40.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Ink.paper).border(1.dp, Ink.line, RoundedCornerShape(8.dp)), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(46.dp).fillMaxHeight().clickable { campusOpen = true }, contentAlignment = Alignment.Center) { Plain("仙林", 13.sp, weight = FontWeight.SemiBold) }
                Box(Modifier.fillMaxHeight().width(1.dp).background(Ink.line))
                Box(Modifier.weight(1f).fillMaxHeight().clickable { route.scope = "place"; route.tab = "search" }.padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) { Plain("搜地点或教室", 14.sp, Ink.faint) }
            }
            Column(Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 12.dp, end = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val bearing = cameraTick.let { mapRef?.cameraPosition?.bearing ?: 0.0 }
                val needle = marks().now
                val faint = Ink.faint
                val pitch = cameraTick.let { mapRef?.cameraPosition?.tilt ?: 52.0 }
                MapBall(bearing, pitch, Ink.paper, faint.copy(alpha = .7f), needle, Modifier.size(44.dp).pointerInput(Unit) { detectDragGestures { _, drag -> scene?.steer(-drag.x / density * .9, -drag.y / density * .5) } }.clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) { scene?.square() }.testTag("tilt"))
                if (floors.isNotEmpty()) Column(Modifier.clip(RoundedCornerShape(8.dp)).background(Ink.paper).border(1.dp, Ink.line, RoundedCornerShape(8.dp))) {
                    floors.reversed().forEach { level ->
                        val on = level == floor
                        val free = inBuilding.any { it.floor.toIntOrNull() == level && day != null && reader?.at(day, it.id, moment.min)?.busy == false }
                        Box(Modifier.size(36.dp, 34.dp).background(if (on) Ink.text else Color.Transparent).clickable { route.place = buildingId; route.floor = level }, contentAlignment = Alignment.Center) {
                            Plain(level.toString(), 13.sp, if (on) Ink.paper else Ink.muted, if (on) FontWeight.SemiBold else FontWeight.Normal)
                            if (free && !on) Box(Modifier.align(Alignment.TopEnd).padding(6.dp).size(4.dp).clip(RoundedCornerShape(2.dp)).background(marks().free))
                        }
                    }
                }
                Box(Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)).background(Ink.paper).border(1.dp, Ink.line, RoundedCornerShape(8.dp)).clickable { if (access.granted) controller.cycleFollow() else requestLocation() }, contentAlignment = Alignment.Center) {
                    Plain("◎", 18.sp, if (controller.follow != FollowMode.None) Ink.brand else Ink.text)
                }
            }
            val base = when { picked != null -> 430; selected != null -> if (buildingId != null && floors.isNotEmpty()) 230 else 260; else -> 190 }
            if (closed) Row(Modifier.align(Alignment.BottomStart).padding(12.dp).height(36.dp).clip(RoundedCornerShape(8.dp)).background(Ink.paper).border(1.dp, Ink.line, RoundedCornerShape(8.dp)).clickable { closed = false; snap = 0 }.padding(horizontal = 12.dp).testTag("open-sheet"), verticalAlignment = Alignment.CenterVertically) {
                Plain(hm(moment.min), 14.sp, weight = FontWeight.SemiBold)
                Plain("  空教室", 13.sp, Ink.muted)
            } else BoxWithConstraints(Modifier.fillMaxSize()) {
                val full = maxHeight - 90.dp
                val target = when (snap) { 2 -> full; 1 -> maxOf(base.dp, maxHeight * .56f); else -> base.dp }
                val animated by animateDpAsState(target, label = "sheet")
                val shown = dragPeek?.let { with(LocalDensity.current) { it.toDp() } } ?: animated
                Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(shown).clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp)).background(Ink.paper)) {
                    var startPeek by remember { mutableFloatStateOf(0f) }
                    val targetPx = with(LocalDensity.current) { target.toPx() }
                    Box(Modifier.fillMaxWidth().height(18.dp).pointerInput(snap, base) {
                        detectDragGestures(onDragStart = { startPeek = targetPx; dragPeek = targetPx }, onDragEnd = {
                            val moved = (dragPeek ?: startPeek) - startPeek
                            if (abs(moved) > 6) snap = if (moved > 0) min(2, snap + 1) else max(0, snap - 1)
                            dragPeek = null
                        }, onDragCancel = { dragPeek = null }) { change, amount -> change.consume(); dragPeek = max(150 * density, (dragPeek ?: startPeek) - amount.y) }
                    }.pointerInput(snap) { detectTapGestures { snap = if (snap > 0) 0 else 1 } }, contentAlignment = Alignment.Center) {
                        Box(Modifier.size(32.dp, 3.dp).clip(RoundedCornerShape(2.dp)).background(Ink.line))
                    }
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 4.dp)) {
                            Plain(hm(moment.min), 19.sp, weight = FontWeight.SemiBold)
                            Plain("‹", 15.sp, Ink.faint, modifier = Modifier.clickable { route.moment = moment.date.minusDays(1) to moment.min }.padding(horizontal = 6.dp))
                            Plain((if (moment.date == now.date) "今天" else WEEKDAYS[moment.date.dayOfWeek.value]) + " " + dateLabel(moment.date) + (state.holidays[moment.date]?.let { " · $it" } ?: ""), 13.sp, Ink.muted, maxLines = 1)
                            Plain("›", 15.sp, Ink.faint, modifier = Modifier.clickable { route.moment = moment.date.plusDays(1) to moment.min }.padding(horizontal = 6.dp))
                            Spacer(Modifier.weight(1f))
                            Plain(if (isNow) "现在" else "回到现在", 12.5.sp, if (isNow) Ink.muted else Ink.brand, modifier = Modifier.clickable { route.moment = null })
                            Plain("✕", 15.sp, Ink.faint, modifier = Modifier.clickable { route.place = null; route.floor = null; snap = 0; closed = true }.padding(start = 10.dp, top = 4.dp, bottom = 4.dp).testTag("close-sheet"))
                        }
                        Ruler(state.periods, moment, now) { route.moment = moment.date to it }
                    }
                    Box(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                        Panel(route, state, campus, selected, openBuilding, picked, floor, floors, inBuilding, classrooms, roomById, day, moment, reader, freeBy, runtime, scene) { snap = it }
                    }
                }
            }
        }
    }
    picker?.let { origin ->
        var query by remember { mutableStateOf("") }
        PlainSheet(if (origin) "从哪里出发" else "到哪里", { picker = null }) {
            top.hicancan.studev.timetable.SearchField(query, "搜地点或教室", Modifier.padding(vertical = 8.dp)) { query = it }
            val hits = remember(query) { if (query.isBlank()) emptyList() else campus.places.filter { place -> place.kind != "floor" && place.kind != "campus" && (place.names + place.id).any { it.contains(query.trim(), true) } }.take(40) }
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                if (origin) item { KeyRow(null, "我的位置", onClick = { runtime.origin(null); picker = null }) }
                items(hits, key = { it.id }) { place -> KeyRow(null, if (place.kind == "room") Names.room(place.id) else place.displayName(campus.byId), place.category, onClick = { if (origin) runtime.origin(place) else runtime.destination(place); picker = null }) }
            }
        }
    }
    if (campusOpen) PlainSheet("校区", { campusOpen = false }) {
        KeyRow(null, "仙林", "${model?.buildings?.size ?: ""} 栋楼", trailing = { Plain("当前", 12.5.sp, Ink.muted) })
        KeyRow(null, "三牌楼", "地图资料收集中")
        KeyRow(null, "锁金", "地图资料收集中")
    }
}

/** The status bar sits on the scene here, so its icons follow the scene's light rather than the theme's. */
@Composable private fun SystemBarIcons(light: Boolean, restoreLight: Boolean) {
    val view = androidx.compose.ui.platform.LocalView.current
    val window = (view.context as? android.app.Activity)?.window ?: return
    DisposableEffect(light, restoreLight) {
        val bars = androidx.core.view.WindowCompat.getInsetsController(window, view)
        bars.isAppearanceLightStatusBars = !light
        onDispose { bars.isAppearanceLightStatusBars = !restoreLight }
    }
}

@Composable private fun MapLabel(item: Placed, night: Boolean, free: Color) {
    val text = when {
        item.kind == "teach" -> Ink.text
        item.kind == "room-picked" -> Ink.paper
        item.kind == "room-long" -> if (night) Color(0xFF052A23) else Color.White
        item.kind.startsWith("room-busy") || item.kind == "room-other" -> if (night) Color(0xFF7D8186) else Color(0xFF7E8389)
        item.kind.startsWith("room") -> if (night) Color(0xFFC9F4EA) else Color(0xFF0B5C4C)
        item.kind == "core" || item.kind == "minor" -> Color(0xFF8A8E94)
        else -> if (night) Color(0xFFC4C7CB) else Color(0xFF46494E)
    }
    val base = Modifier.layout { measurable, constraints ->
        val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
        layout(0, 0) { placeable.place(IntOffset(item.x - placeable.width / 2, item.y - placeable.height / 2)) }
    }.then(when (item.kind) {
        "teach" -> Modifier.clip(RoundedCornerShape(6.dp)).background(Ink.paper).border(1.dp, Ink.line, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp)
        "room-picked" -> Modifier.clip(RoundedCornerShape(5.dp)).background(Ink.text).padding(horizontal = 7.dp, vertical = 3.dp)
        else -> Modifier
    }).then(if (item.tap != null) Modifier.clickable(onClick = item.tap) else Modifier)
    Row(base) {
        val size = when { item.kind == "teach" || item.kind == "room-picked" -> 12.sp; item.kind == "core" -> 9.5.sp; item.kind.startsWith("room") || item.kind == "minor" -> 10.5.sp; else -> 11.5.sp }
        Plain(item.text, size, text, if (item.kind == "teach" || item.kind == "room-picked") FontWeight.SemiBold else FontWeight.Medium, maxLines = 1)
        item.count?.let { Plain(" $it", 12.sp, if (it > 0) free else Ink.faint, FontWeight.SemiBold) }
    }
}

@Composable private fun Ruler(periods: List<TeachingPeriod>, moment: Moment, now: Moment, onChange: (Int) -> Unit) {
    val mark = marks(); val ink = Ink.text; val sunken = Ink.sunken
    var width by remember { mutableIntStateOf(1) }
    fun pick(x: Float) = (((RULER_START + (x / width).coerceIn(0f, 1f) * (RULER_END - RULER_START)) / 5).roundToInt() * 5)
    val percent = { minutes: Int -> ((minutes.coerceIn(RULER_START, RULER_END) - RULER_START).toFloat() / (RULER_END - RULER_START)) }
    Box(Modifier.fillMaxWidth().height(38.dp).onSizeChanged { width = it.width }
        .pointerInput(Unit) { detectTapGestures { onChange(pick(it.x)) } }
        .pointerInput(Unit) { detectDragGestures { change, _ -> change.consume(); onChange(pick(change.position.x)) } }
        .drawBehind {
            val top = 9.dp.toPx(); val bar = 8.dp.toPx()
            drawRect(sunken, Offset(0f, top), androidx.compose.ui.geometry.Size(size.width, bar))
            for (period in periods) {
                val start = percent(clock(period.start)) * size.width; val end = percent(clock(period.end)) * size.width
                drawRect(ink.copy(alpha = .14f), Offset(start, top), androidx.compose.ui.geometry.Size(end - start, bar))
            }
            if (moment.date == now.date) drawRect(mark.now, Offset(percent(now.min) * size.width - 1, 5.dp.toPx()), androidx.compose.ui.geometry.Size(1.5.dp.toPx(), 16.dp.toPx()))
            drawRect(ink, Offset(percent(moment.min) * size.width - 1.5.dp.toPx(), 3.dp.toPx()), androidx.compose.ui.geometry.Size(3.dp.toPx(), 20.dp.toPx()))
        }) {
        listOf(8, 10, 12, 14, 16, 18, 20).forEach { hour ->
            val fraction = percent(hour * 60)
            Box(Modifier.fillMaxHeight().fillMaxWidth(fraction)) { Plain(hour.toString(), 10.5.sp, Ink.faint, modifier = Modifier.align(Alignment.BottomEnd).offset(x = 6.dp, y = (-2).dp)) }
        }
    }
}

@Composable private fun Panel(route: Route, state: AcademicState, campus: CampusPackage, selected: Place?, building: Place?, picked: Place?, floor: Int?, floors: List<Int>, inBuilding: List<Room>, classrooms: List<Room>, roomById: Map<String, Room>,
                              day: RoomDay?, moment: Moment, reader: RoomReader?, freeBy: Map<String, Pair<Int, Int>>, runtime: NavigationRuntime, scene: Scene?, onSnap: (Int) -> Unit) {
    val mark = marks()
    fun openRoom(id: String) { route.place = id; route.floor = null; onSnap(1) }
    if (reader == null) return
    if (picked != null && building != null) {
        val room = roomById[picked.id]
        val current = if (room != null && RoomReader.classroom(room)) reader.at(day, picked.id, moment.min) else null
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
            item {
                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.Top) {
                    Plain(picked.title?.let { "$it ${picked.names.firstOrNull().orEmpty()}" } ?: Names.room(picked.id), 20.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                }
                Plain(listOfNotNull("${building.names.firstOrNull().orEmpty()} $floor 层", room?.seats?.let { "$it 座" }, room?.kinds?.firstOrNull()?.removePrefix("仙林")).joinToString(" · "), 13.5.sp, Ink.muted)
                if (current != null) {
                    if (day == null) Plain("这一天没有排课数据", 14.sp, Ink.muted, modifier = Modifier.padding(vertical = 12.dp))
                    else if (current.busy) Plain((if (current.current != null) "上课中" else "有人用") + "，到 ${hm(current.until)}", 14.sp, Ink.text, modifier = Modifier.padding(vertical = 12.dp))
                    else Plain(if (current.minutes > 0) "空闲，到 ${hm(current.until)}，还能待 ${durationText(current.minutes)}" else "空闲，今天没课了", 14.sp, mark.free, FontWeight.Medium, modifier = Modifier.padding(vertical = 12.dp))
                    if (day != null) PeriodStrip(state.periods, current, moment.min)
                }
                Row(Modifier.padding(top = 12.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (current != null) ActionButton("这间的课表", modifier = Modifier.weight(1f)) { route.timetable("room", picked.id, at = moment.date) }
                    ActionButton("去这里", go = true, modifier = Modifier.weight(1f)) { route.nav = picked.id }
                }
            }
            items(current?.occupants.orEmpty(), key = { it.occupant.id + it.start }) { row ->
                Row(Modifier.fillMaxWidth().topHairline(Ink.line).clickable { route.timetable("course", Names.course(row.occupant.course)) }.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Plain("${hm(row.start)}–${hm(row.end)}", 13.5.sp, if (row === current?.current) Ink.text else Ink.muted, if (row === current?.current) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.width(88.dp))
                    Column { Plain(Names.course(row.occupant.course) + if (row.occupant.kind == "exam") " · 考试" else "", 13.5.sp); Plain((row.occupant.teachers + row.occupant.classes.take(2)).joinToString(" "), 12.sp, Ink.faint, maxLines = 1) }
                }
            }
            if (current != null && day != null && current.occupants.isEmpty()) item { Plain("今天没有排课", 14.sp, Ink.faint, modifier = Modifier.padding(14.dp)) }
        }
        return
    }
    if (building != null && (inBuilding.isNotEmpty() || floors.isNotEmpty())) {
        val inFloor = inBuilding.filter { floor == null || it.floor.toIntOrNull() == floor }
        val free = inFloor.map { it to reader.at(day, it.id, moment.min) }.filter { day != null && !it.second.busy }.sortedByDescending { it.second.minutes }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
            item {
                Row(Modifier.padding(top = 8.dp)) {
                    Plain(building.names.firstOrNull().orEmpty() + (floor?.let { " $it 层" } ?: ""), 20.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                }
                Plain(if (inFloor.isNotEmpty()) "${free.size} / ${inFloor.size} 间空闲" + (if (floor != null) " · 全楼 ${freeBy[building.id]?.first ?: 0} 间" else "") else "楼层布局", 13.5.sp, Ink.muted, modifier = Modifier.padding(vertical = 10.dp))
            }
            if (inFloor.isNotEmpty()) items(free, key = { it.first.id }) { (room, status) -> RoomRow(room, status) { openRoom(room.id) } }
            else if (floor != null) items(scene?.roomsOf(building.id, floor).orEmpty(), key = { it.id }) { row ->
                val place = campus.byId[row.id]
                KeyRow(null, place?.title ?: place?.names?.firstOrNull() ?: row.id, place?.names?.firstOrNull().takeIf { place?.title != null }, onClick = { openRoom(row.id) })
            }
            if (inFloor.isNotEmpty() && free.isEmpty()) item { Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) { Plain("这一层此刻没有空教室", 14.sp, Ink.faint) } }
        }
        return
    }
    if (selected != null) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
            item {
                Row(Modifier.padding(top = 8.dp)) {
                    Plain(selected.displayName(campus.byId), 20.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                }
                selected.category?.let { Plain(it, 13.5.sp, Ink.muted) }
                selected.hours?.let { hours ->
                    val today = hours.week[moment.date.dayOfWeek.value.toString()].orEmpty()
                    val open = today.any { clock(it[0]) <= moment.min && moment.min < (clock(it[1]).takeIf { end -> end > clock(it[0]) } ?: (clock(it[1]) + 1440)) }
                    Plain((if (open) "营业中" else "已关闭") + " · 今日 " + (today.joinToString(" · ") { "${it[0]}–${it[1]}" }.ifEmpty { "不开放" }), 14.sp, if (open) mark.free else Ink.muted, modifier = Modifier.padding(vertical = 12.dp))
                }
                ActionButton("去这里", go = true, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) { route.nav = selected.id }
                selected.hours?.let { hours -> DayOfWeek.entries.forEach { day ->
                    Row(Modifier.fillMaxWidth().topHairline(Ink.line).padding(vertical = 5.dp)) {
                        Plain(WEEKDAYS[day.value], 13.sp, Ink.muted, modifier = Modifier.weight(1f))
                        Plain(hours.week[day.value.toString()].orEmpty().joinToString("、") { "${it[0]}–${it[1]}" }.ifEmpty { "不开放" }, 13.sp, Ink.muted)
                    }
                } }
            }
        }
        return
    }
    if (day == null) { Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain("这一天没有排课数据", 14.sp, Ink.faint) }; return }
    val free = classrooms.map { it to reader.at(day, it.id, moment.min) }.filter { !it.second.busy }.sortedWith(compareBy({ if (it.second.minutes >= 60) 0 else 1 }, { -it.second.minutes }))
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        item { Plain("${free.size} 间空教室，能待得久的在前", 13.5.sp, Ink.muted, modifier = Modifier.padding(vertical = 10.dp)) }
        items(free.take(40), key = { it.first.id }) { (room, status) -> RoomRow(room, status) { openRoom(room.id) } }
    }
}

@Composable private fun RoomRow(room: Room, state: RoomState, onClick: () -> Unit) {
    val free = marks().free
    Row(Modifier.fillMaxWidth().topHairline(Ink.line).clickable(onClick = onClick).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(3.dp, 28.dp).clip(RoundedCornerShape(2.dp)).background(free.copy(alpha = when (state.tier) { "long" -> 1f; "mid" -> .55f; else -> .25f })))
        Column(Modifier.weight(1f)) { Plain(Names.room(room.id), 14.5.sp, weight = FontWeight.Medium); Plain(room.seats?.let { "$it 座" } ?: "座位未知", 12.5.sp, Ink.muted) }
        Plain(if (state.minutes > 0) "到 ${hm(state.until)}" else "今天没课了", 12.5.sp, Ink.muted)
    }
}

@Composable private fun PeriodStrip(periods: List<TeachingPeriod>, state: RoomState, min: Int) {
    val busy = marks().exam; val free = marks().free; val now = marks().now
    val gaps = setOf(5, 9)
    Column {
        Row(Modifier.fillMaxWidth().height(22.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            periods.forEach { period ->
                val taken = state.occupants.any { period.period in it.occupant.periods.first()..it.occupant.periods.last() }
                val current = clock(period.start) <= min && min <= clock(period.end)
                Box(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(if (taken) busy.copy(alpha = .72f) else free.copy(alpha = .11f)).then(if (current) Modifier.border(1.5.dp, now, RoundedCornerShape(2.dp)) else Modifier))
                if (period.period in gaps) Spacer(Modifier.weight(.35f))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 3.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            periods.forEach { period ->
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { Plain(period.period.toString(), 10.sp, Ink.faint) }
                if (period.period in gaps) Spacer(Modifier.weight(.35f))
            }
        }
    }
}
