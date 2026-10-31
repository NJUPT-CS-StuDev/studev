package top.hicancan.studev.map

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.Place
import top.hicancan.studev.data.PlacePreferences
import top.hicancan.studev.location.LocationStatus
import top.hicancan.studev.ui.theme.Tokens
import top.hicancan.studev.home.*

@Composable
internal fun MapControls(controller: CampusMapController, status: LocationStatus, locationGranted: Boolean,
                          mapError: Boolean, selected: Boolean, sheetMode: MapSheetState = MapSheetState.Collapsed,
                          onLocate: () -> Unit, homePeek: Dp = 0.dp) {
    Box(Modifier.fillMaxSize().safeDrawingPadding().padding(Tokens.Space.l.dp)) {
        if (!selected) Surface(Modifier.align(Alignment.TopStart).padding(end = 72.dp), shape = RoundedCornerShape(20.dp), shadowElevation = 2.dp) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("南邮 · 仙林校区", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text(DayMoment.at(CampusClock.now().hour).title, style = MaterialTheme.typography.titleMedium)
            }
        }
        Column(Modifier.align(Alignment.TopEnd).padding(top = if (selected) 72.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.m.dp),
            horizontalAlignment = Alignment.End) {
            MapButton(if (controller.threeD) "切换二维地图" else "切换三维地图", Icons.Outlined.Layers, controller::toggle3d,
                selected = controller.threeD, label = if (controller.threeD) "2D" else "3D")
            if (controller.bearing > 1.0 && controller.bearing < 359.0 || controller.follow == FollowMode.Heading) {
                Surface(shape = CircleShape, shadowElevation = Tokens.Elevation.control.dp) {
                    IconButton(onClick = controller::north, Modifier.size(48.dp)) {
                        Icon(Icons.Outlined.Navigation, "指向北方", Modifier.rotate(-controller.bearing.toFloat()), tint = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
        if (sheetMode != MapSheetState.Full) {
            Column(Modifier.align(Alignment.BottomEnd).padding(bottom = homePeek + 16.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.m.dp)) {
                Surface(shape = RoundedCornerShape(Tokens.Radius.control.dp), shadowElevation = Tokens.Elevation.control.dp) {
                    Column {
                        IconButton(onClick = controller::zoomIn, Modifier.size(48.dp)) { Icon(Icons.Outlined.Add, "放大地图") }
                        HorizontalDivider(Modifier.width(24.dp).align(Alignment.CenterHorizontally), color = MaterialTheme.colorScheme.outlineVariant)
                        IconButton(onClick = controller::zoomOut, Modifier.size(48.dp)) { Icon(Icons.Outlined.Remove, "缩小地图") }
                    }
                }
                MapButton(when (controller.follow) { FollowMode.None -> "定位"; FollowMode.Follow -> "跟随位置"; FollowMode.Heading -> "跟随朝向" },
                    when (controller.follow) { FollowMode.None -> Icons.Outlined.LocationSearching; FollowMode.Follow -> Icons.Outlined.MyLocation; FollowMode.Heading -> Icons.Outlined.Navigation },
                    onLocate, selected = controller.follow != FollowMode.None)
            }
            Column(Modifier.align(Alignment.BottomStart).padding(bottom = homePeek + 16.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s.dp)) {
                Surface(shape = RoundedCornerShape(Tokens.Radius.control.dp), color = MaterialTheme.colorScheme.surface.copy(alpha = .96f)) {
                    Row(Modifier.padding(horizontal = Tokens.Space.m.dp, vertical = Tokens.Space.s.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s.dp)) {
                        Icon(Icons.Outlined.School, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                        Text(if (locationGranted && status == LocationStatus.Available) "定位已就绪" else "探索校园", style = MaterialTheme.typography.labelLarge)
                    }
                }
                val message = when {
                    mapError -> "地图加载失败，请重新打开应用"
                    locationGranted && status == LocationStatus.Waiting && controller.follow != FollowMode.None -> "正在获取位置…"
                    locationGranted && status == LocationStatus.Disabled -> "系统定位已关闭"
                    locationGranted && status == LocationStatus.Unavailable -> "暂时无法定位"
                    else -> null
                }
                if (message != null) Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surface) {
                    Text(message, Modifier.padding(Tokens.Space.m.dp), style = MaterialTheme.typography.labelMedium)
                }
            }
            Surface(Modifier.align(Alignment.BottomStart).padding(bottom = homePeek), color = MaterialTheme.colorScheme.surface.copy(alpha = .9f), shape = MaterialTheme.shapes.small) {
                Text("© OpenStreetMap · Protomaps · njupt-data", Modifier.padding(horizontal = Tokens.Space.s.dp, vertical = Tokens.Space.xs.dp),
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun MapButton(description: String, icon: ImageVector, onClick: () -> Unit, selected: Boolean = false, label: String? = null) {
    Surface(onClick = onClick, shape = RoundedCornerShape(Tokens.Radius.control.dp), shadowElevation = Tokens.Elevation.control.dp,
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        contentColor = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface) {
        Column(Modifier.size(if (label == null) 48.dp else 56.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(icon, description, Modifier.size(24.dp))
            if (label != null) Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** Material's persistent sheet leaves the map interactive; three useful detail heights. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PlaceSheet(place: Place, campus: CampusPackage, preferences: PlacePreferences,
                        sheetMode: MapSheetState, onSheetModeChange: (MapSheetState) -> Unit,
                        onSearch: () -> Unit,
                        onClose: () -> Unit, onPlace: (Place) -> Unit, onRoute: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val saved by preferences.saved.collectAsStateWithLifecycle(emptySet())
    val height = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.height.toDp() }
    val state = rememberBottomSheetScaffoldState()
    val sheet = state.bottomSheetState
    var sheetReady by remember { mutableStateOf(false) }
    LaunchedEffect(place.id, sheetMode) {
        sheetReady = false
        if (sheetMode == MapSheetState.Full) sheet.expand() else sheet.partialExpand()
        sheetReady = true
    }
    LaunchedEffect(sheet) {
        snapshotFlow { sheet.currentValue }.collect { value ->
            if (!sheetReady) return@collect
            when (value) {
                SheetValue.Expanded -> if (sheetMode != MapSheetState.Full) onSheetModeChange(MapSheetState.Full)
                SheetValue.PartiallyExpanded -> if (sheetMode == MapSheetState.Full) onSheetModeChange(MapSheetState.Half)
                else -> Unit
            }
        }
    }
    BackHandler {
        if (sheetMode == MapSheetState.Full) onSheetModeChange(MapSheetState.Half)
        else if (sheetMode == MapSheetState.Half) onSheetModeChange(MapSheetState.Collapsed) else onClose()
    }
    BottomSheetScaffold(scaffoldState = state, containerColor = Color.Transparent,
         sheetPeekHeight = when (sheetMode) { MapSheetState.Collapsed -> 144.dp; MapSheetState.Half -> height * .52f; MapSheetState.Full -> 104.dp },
        sheetShape = RoundedCornerShape(topStart = Tokens.Radius.sheet.dp, topEnd = Tokens.Radius.sheet.dp),
        sheetContainerColor = MaterialTheme.colorScheme.surface,
        sheetShadowElevation = Tokens.Elevation.sheet.dp,
        sheetContent = {
             Column(Modifier.fillMaxWidth().height(height * .88f).navigationBarsPadding().verticalScroll(rememberScrollState())
                .padding(horizontal = Tokens.Space.xl.dp).padding(bottom = Tokens.Space.xxl.dp),
                verticalArrangement = Arrangement.spacedBy(Tokens.Space.l.dp)) {
                 Surface(onClick = { onSheetModeChange(if (sheetMode == MapSheetState.Collapsed) MapSheetState.Half else if (sheetMode == MapSheetState.Half) MapSheetState.Full else MapSheetState.Collapsed) },
                     modifier = Modifier.fillMaxWidth().height(24.dp), color = Color.Transparent) {
                     Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Surface(Modifier.width(38.dp).height(4.dp), shape = RoundedCornerShape(4.dp), color = MaterialTheme.colorScheme.outlineVariant) {} }
                 }
                Surface(onClick = onSearch, modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(18.dp)) {
                    Row(Modifier.padding(horizontal = Tokens.Space.l.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Tokens.Space.m.dp)) {
                        Icon(Icons.Outlined.Search, null, tint = MaterialTheme.colorScheme.primary)
                        Text("搜索地点、楼栋或教室", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (sheetMode != MapSheetState.Collapsed) {
                    Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tokens.Space.xs.dp)) {
                        Text(place.id, style = MaterialTheme.typography.headlineLarge)
                        Text(listOf(place.kindLabel, campus.byId[place.parent]?.id ?: "仙林校区").joinToString(" · "),
                            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = onClose, Modifier.size(48.dp)) { Icon(Icons.Outlined.Close, "关闭地点") }
                }
                Text("用途 · ${place.use}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                PlaceHours(place)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s.dp)) {
                    FilledTonalButton(onClick = onRoute, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Outlined.Directions, null, Modifier.size(18.dp)); Spacer(Modifier.width(Tokens.Space.xs.dp)); Text("路线")
                    }
                    OutlinedButton(onClick = { scope.launch { preferences.toggleSaved(place.id) } }, modifier = Modifier.weight(1f)) {
                        Icon(if (place.id in saved) Icons.Outlined.Star else Icons.Outlined.StarOutline, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(Tokens.Space.xs.dp)); Text(if (place.id in saved) "已收藏" else "收藏")
                    }
                    OutlinedButton(onClick = {
                        val link = android.net.Uri.Builder().scheme("https").authority("studev.hicancan.top").path("/map/")
                            .appendQueryParameter("place", place.id).build().toString()
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "${place.id} · 南邮仙林校区\n$link")
                        }, "分享地点"))
                    }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Outlined.Share, null, Modifier.size(18.dp)); Spacer(Modifier.width(Tokens.Space.xs.dp)); Text("分享")
                    }
                }
                 TextButton(onClick = { onSheetModeChange(if (sheetMode == MapSheetState.Collapsed) MapSheetState.Half else MapSheetState.Full) }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Text("地点详情"); Icon(Icons.Outlined.KeyboardArrowDown, null)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Text("地点信息", style = MaterialTheme.typography.titleMedium)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Tokens.Space.l.dp)) {
                    place.levels?.let { Fact(Icons.Outlined.Layers, "$it 层", "楼层", Modifier.weight(1f)) }
                    if (place.kind == "room") {
                        place.floor?.takeIf { it.isNotEmpty() }?.let { Fact(Icons.Outlined.Layers, "$it 楼", "所在楼层", Modifier.weight(1f)) }
                        place.seats?.let { Fact(Icons.Outlined.EventSeat, "$it 座", "座位", Modifier.weight(1f)) }
                    } else Fact(Icons.Outlined.DoorFront, "${place.entrances.size} 个", "出入口", Modifier.weight(1f))
                }
                if (place.kind == "room") {
                    campus.byId[place.parent]?.let { parent ->
                        OutlinedCard(onClick = { onPlace(parent) }, Modifier.fillMaxWidth()) {
                            Row(Modifier.fillMaxWidth().padding(Tokens.Space.l.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Apartment, null, tint = MaterialTheme.colorScheme.primary)
                                Text(parent.id, Modifier.weight(1f).padding(start = Tokens.Space.m.dp), style = MaterialTheme.typography.titleMedium)
                                Icon(Icons.AutoMirrored.Outlined.ArrowForward, "查看所在楼栋")
                            }
                        }
                    }
                    if (place.roomKinds.isNotEmpty()) Text(place.roomKinds.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (place.houses.isNotEmpty()) {
                    Text("楼内机构与服务", style = MaterialTheme.typography.titleMedium)
                    place.houses.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
                }
                if (place.names.size > 1) {
                    Text("也叫", style = MaterialTheme.typography.titleMedium)
                    Text(place.names.filter { it != place.id }.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                 Spacer(Modifier.height(Tokens.Space.l.dp))
                }
            }
        }) { }
}

@Composable
private fun Fact(icon: ImageVector, value: String, label: String, modifier: Modifier = Modifier) {
    Surface(modifier, shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.padding(Tokens.Space.l.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s.dp)) {
            Icon(icon, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
            Text(value, style = MaterialTheme.typography.titleLarge)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
