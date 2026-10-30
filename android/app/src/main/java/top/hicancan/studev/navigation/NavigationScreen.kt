package top.hicancan.studev.navigation

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.DirectionsWalk
import androidx.compose.material.icons.automirrored.outlined.DirectionsBike
import androidx.compose.material.icons.automirrored.outlined.VolumeOff
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import top.hicancan.studev.BuildConfig
import top.hicancan.studev.map.CampusMapController
import top.hicancan.studev.ui.theme.Tokens
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/** Distinct silhouettes for all wayfind modifiers, stairs and arrival; no font arrows. */
@Composable
internal fun ManeuverIcon(kind: String, modifier: String, size: Int = 40) {
    val ink = LocalContentColor.current
    val description = maneuverLabel(kind, modifier)
    Canvas(Modifier.size(size.dp).semantics { contentDescription = description }) {
        val scale = this.size.width / 40
        fun path(vararg points: Pair<Float, Float>) = Path().apply {
            points.forEachIndexed { i, p -> if (i == 0) moveTo(p.first * scale, p.second * scale) else lineTo(p.first * scale, p.second * scale) }
        }
        fun line(vararg points: Pair<Float, Float>) = drawPath(path(*points), ink,
            style = Stroke(4 * scale, cap = StrokeCap.Round, join = StrokeJoin.Round))
        when (kind) {
            "stairs" -> { line(5f to 34f, 5f to 26f, 15f to 26f, 15f to 18f, 25f to 18f, 25f to 10f, 35f to 10f) }
            "arrive" -> {
                line(10f to 35f, 10f to 6f)
                drawPath(path(10f to 6f, 32f to 6f, 27f to 14f, 32f to 22f, 10f to 22f).apply { close() }, ink)
            }
            else -> {
                val left = modifier.contains("left")
                fun x(v: Float) = if (left) 40 - v else v
                when {
                    modifier.startsWith("sharp") -> {
                        line(x(13f) to 35f, x(13f) to 16f, x(19f) to 10f, x(30f) to 23f)
                        line(x(20f) to 23f, x(30f) to 23f, x(30f) to 13f)
                    }
                    modifier.startsWith("slight") -> {
                        line(x(15f) to 35f, x(15f) to 23f, x(31f) to 7f)
                        line(x(19f) to 7f, x(31f) to 7f, x(31f) to 19f)
                    }
                    modifier == "left" || modifier == "right" -> {
                        line(x(13f) to 35f, x(13f) to 14f, x(33f) to 14f)
                        line(x(25f) to 6f, x(33f) to 14f, x(25f) to 22f)
                    }
                    else -> { line(20f to 35f, 20f to 6f); line(9f to 17f, 20f to 6f, 31f to 17f) }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NavigationScreen(state: PlannerState, runtime: NavigationRuntime, controller: CampusMapController,
                              locationGranted: Boolean, requestLocation: () -> Unit, pick: (Boolean) -> Unit) {
    var steps by rememberSaveable { mutableStateOf(false) }
    var debug by remember { mutableStateOf(false) }
    var exit by remember { mutableStateOf(false) }
    var pendingSimulation by remember { mutableStateOf(false) }
    var pendingSpeed by remember { mutableDoubleStateOf(1.0) }
    val density = LocalDensity.current.density
    val windowHeight = LocalWindowInfo.current.containerSize.height
    var now by remember { mutableLongStateOf(android.os.SystemClock.elapsedRealtime()) }
    LaunchedEffect(state.active) {
        while (state.active) { now = android.os.SystemClock.elapsedRealtime(); kotlinx.coroutines.delay(1000) }
    }
    val notification = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        runtime.start(pendingSimulation, pendingSpeed)
        if (!allowed) runtime.notice("通知未获允许，锁屏时可返回应用查看导航。")
    }
    fun start(simulate: Boolean = false, speed: Double = 1.0) {
        if (!locationGranted) { requestLocation(); return }
        pendingSimulation = simulate; pendingSpeed = speed
        if (Build.VERSION.SDK_INT >= 33) notification.launch(Manifest.permission.POST_NOTIFICATIONS)
        else runtime.start(simulate, speed)
    }
    BackHandler { if (steps) steps = false else if (state.active) exit = true else runtime.stop(close = true) }
    if (exit) AlertDialog(onDismissRequest = { exit = false }, title = { Text("退出导航？") },
        text = { Text("位置跟随与语音指引将停止。") },
        confirmButton = { TextButton(onClick = { exit = false; runtime.stop() }) { Text("退出导航") } },
        dismissButton = { TextButton(onClick = { exit = false }) { Text("继续导航") } })

    Box(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
        if (state.active) {
            val banner = state.trip.banner
            Surface(Modifier.align(Alignment.TopCenter).fillMaxWidth().testTag("navigation-banner"),
                shape = RoundedCornerShape(Tokens.Radius.card.dp), shadowElevation = 4.dp,
                color = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                        ManeuverIcon(banner?.maneuver?.type ?: "continue", banner?.maneuver?.modifier ?: "ahead", 56)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(banner?.let { metres(it.distance_m) } ?: "正在定位", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                            Text(banner?.maneuver?.instruction ?: "沿规划路线前行", style = MaterialTheme.typography.titleMedium)
                        }
                    }
                    val route = state.route
                    val following = route?.maneuvers?.firstOrNull { it.offset_m > (banner?.maneuver?.offset_m ?: Double.MAX_VALUE) + .1 }
                    if (banner != null && banner.distance_m <= 60 && following != null && following.offset_m - banner.maneuver.offset_m <= 60) {
                        HorizontalDivider(color = LocalContentColor.current.copy(alpha = .25f))
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            ManeuverIcon(following.type, following.modifier, 22)
                            Text("随后 ${following.instruction}", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    val folded = banner?.maneuver?.following_actions?.firstOrNull()
                    if (banner != null && banner.distance_m <= 60 && folded != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        ManeuverIcon(folded.kind, folded.modifier, 22)
                        Text("随后${actionLabel(folded)}", style = MaterialTheme.typography.bodyMedium)
                    }
                    if (!state.simulating) {
                        val quality = when {
                            state.fix == null || now - state.fix.timestamp > 15_000 -> "定位信号较弱，正在等待更新"
                            state.fix.accuracy > 50 -> "定位精度较低，请结合周围环境前行"
                            else -> null
                        }
                        quality?.let { Text(it, style = MaterialTheme.typography.labelMedium) }
                    }
                    if (state.notice == "重新规划路线") Text("重新规划路线", Modifier.testTag("navigation-notice"), style = MaterialTheme.typography.labelLarge)
                }
            }
            Column(Modifier.align(Alignment.BottomEnd).padding(bottom = 160.dp), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.End) {
                if (BuildConfig.DEBUG && state.simulating) Box {
                    FilledTonalIconButton(onClick = { debug = true }, Modifier.size(48.dp)) { Icon(Icons.Outlined.MoreHoriz, "调试菜单") }
                    DropdownMenu(debug, { debug = false }) {
                        DropdownMenuItem(text = { Text("暂停 / 继续模拟") }, onClick = { debug = false; runtime.debugCommand("pause") })
                        DropdownMenuItem(text = { Text("模拟偏航") }, onClick = { debug = false; runtime.debugCommand("detour") })
                        DropdownMenuItem(text = { Text("模拟到达") }, onClick = { debug = false; runtime.debugCommand("arrive") })
                    }
                }
                FilledTonalIconButton(onClick = runtime::mute, Modifier.size(48.dp)) {
                    Icon(if (state.muted) Icons.AutoMirrored.Outlined.VolumeOff else Icons.AutoMirrored.Outlined.VolumeUp, if (state.muted) "开启语音" else "静音")
                }
                if (!controller.navigationFollowing) FilledTonalButton(onClick = { controller.navigationFollowing = true }) {
                    Icon(Icons.Outlined.MyLocation, null); Spacer(Modifier.width(6.dp)); Text("回到当前位置")
                }
            }
            Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth(), shape = RoundedCornerShape(24.dp), shadowElevation = 3.dp) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    val update = state.trip.update
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${minutes(update?.eta_s ?: state.route!!.duration_s)} 分钟", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
                            val eta = LocalTime.now().plusSeconds((update?.eta_s ?: state.route!!.duration_s).toLong()).format(DateTimeFormatter.ofPattern("HH:mm"))
                            Text("${metres(update?.distance_remaining_m ?: state.route!!.distance_m)} · $eta 到达", style = MaterialTheme.typography.bodyMedium)
                        }
                        OutlinedButton(onClick = { runtime.stop() }) { Text("退出") }
                    }
                    if (state.simulating) Text("模拟导航 · ${if (state.mode == "bike") "骑行" else "步行"}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else if (state.trip.phase == TripPhase.Arrived) {
            Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth().testTag("arrival-card"), shape = RoundedCornerShape(24.dp), shadowElevation = 3.dp) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Icon(Icons.Outlined.CheckCircle, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.tertiary)
                    Text("已到达 ${state.destinationName}", style = MaterialTheme.typography.headlineMedium)
                    Text(state.route?.maneuvers?.lastOrNull()?.instruction ?: "已到达目的地附近")
                    state.destination?.floor?.let { Text("${state.destinationName} 在 $it 楼", style = MaterialTheme.typography.titleMedium) }
                    Button(onClick = { runtime.stop(close = true) }, Modifier.fillMaxWidth()) { Text("完成") }
                }
            }
        } else {
            Surface(Modifier.align(Alignment.TopCenter).fillMaxWidth().onGloballyPositioned {
                controller.plannerTop = (it.boundsInRoot().bottom + 24 * density).toInt()
            }, shape = RoundedCornerShape(20.dp), shadowElevation = 4.dp) {
                Column(Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { runtime.stop(close = true) }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "关闭路线规划") }
                        Column(Modifier.weight(1f)) {
                            EndpointField(state.origin?.id ?: "我的位置", "起点", true) { pick(true) }
                            HorizontalDivider(Modifier.padding(start = 22.dp), color = MaterialTheme.colorScheme.outlineVariant)
                            EndpointField(state.destinationName, "终点", false) { pick(false) }
                        }
                        IconButton(onClick = runtime::swap) { Icon(Icons.Outlined.SwapVert, "交换起终点") }
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val modeColors = FilterChipDefaults.filterChipColors(selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                            selectedLabelColor = MaterialTheme.colorScheme.primary, selectedLeadingIconColor = MaterialTheme.colorScheme.primary)
                        FilterChip(state.mode == "walk", { runtime.mode("walk") }, { Text("步行") }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.DirectionsWalk, null, Modifier.size(18.dp)) }, modifier = Modifier.weight(1f), colors = modeColors)
                        FilterChip(state.mode == "bike", { runtime.mode("bike") }, { Text("骑行") }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.DirectionsBike, null, Modifier.size(18.dp)) }, modifier = Modifier.weight(1f), colors = modeColors)
                        if (BuildConfig.DEBUG) Box {
                            IconButton(onClick = { debug = true }) { Icon(Icons.Outlined.MoreHoriz, "调试菜单") }
                            DropdownMenu(debug, { debug = false }) {
                                DropdownMenuItem(text = { Text("模拟走一遍") }, onClick = { debug = false; start(true) }, enabled = state.route != null)
                                DropdownMenuItem(text = { Text("模拟走一遍 · 20 倍速") }, onClick = { debug = false; start(true, 20.0) }, enabled = state.route != null)
                                DropdownMenuItem(text = { Text("导出路线供 adb 回放") }, onClick = { debug = false; runtime.exportRoute() }, enabled = state.route != null)
                            }
                        }
                    }
                    if (state.mode == "walk") Row(Modifier.fillMaxWidth().height(36.dp).clickable { runtime.avoidSteps(!state.avoidSteps) }.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(state.avoidSteps, null, Modifier.size(24.dp)); Spacer(Modifier.width(8.dp))
                        Text("避开楼梯", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth().testTag("route-planner").onGloballyPositioned {
                controller.plannerBottom = (windowHeight - it.boundsInRoot().top + 24 * density).toInt()
            }, shape = RoundedCornerShape(24.dp), shadowElevation = 3.dp) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    when {
                        state.busy -> Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            CircularProgressIndicator(Modifier.size(24.dp)); Text("正在规划路线")
                        }
                        state.error != null -> {
                            Text(state.error, style = MaterialTheme.typography.bodyLarge)
                            Row {
                                TextButton(onClick = { pick(!state.destinationIsMyPosition) }) { Text(if (state.destinationIsMyPosition) "选择终点" else "选择起点") }
                                TextButton(onClick = { if (!locationGranted) requestLocation() else runtime.plan() }) { Text(if (!locationGranted) "开启定位" else "重试") }
                            }
                        }
                        state.route != null -> {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(if (state.routes.size > 1) "${state.routes.size} 条可选路线" else "推荐路线", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                                TextButton(onClick = { steps = true }) { Text("路线详情"); Icon(Icons.Outlined.ChevronRight, null, Modifier.size(18.dp)) }
                            }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                state.routes.forEachIndexed { index, route ->
                                    val selected = index == state.selected
                                    Surface(onClick = { runtime.choose(index) }, Modifier.weight(1f).testTag("route-card:$index"),
                                        shape = RoundedCornerShape(12.dp), color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
                                        border = if (selected) androidx.compose.foundation.BorderStroke(1.5.dp, MaterialTheme.colorScheme.primary) else null) {
                                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            Text("${minutes(route.duration_s)} 分钟", style = MaterialTheme.typography.titleLarge, color = if (selected) MaterialTheme.colorScheme.primary else LocalContentColor.current)
                                            Text(metres(route.distance_m), style = MaterialTheme.typography.bodyMedium)
                                            Text("经${route.via}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    }
                                }
                            }
                            Button(onClick = { start() }, Modifier.fillMaxWidth().height(52.dp)) {
                                Icon(Icons.Outlined.Navigation, null, Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)); Text("开始导航")
                            }
                        }
                    }
                }
            }
        }
        state.notice?.let { notice ->
            if (notice != "重新规划路线") Surface(Modifier.align(Alignment.Center).padding(24.dp).testTag("navigation-notice"), shape = RoundedCornerShape(16.dp), shadowElevation = 4.dp,
                color = MaterialTheme.colorScheme.inverseSurface, contentColor = MaterialTheme.colorScheme.inverseOnSurface) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(notice, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    IconButton(onClick = { runtime.notice(null) }) { Icon(Icons.Outlined.Close, "关闭提示") }
                }
            }
            LaunchedEffect(notice) { if (notice == "重新规划路线") { kotlinx.coroutines.delay(3500); if (runtime.state.value.notice == notice) runtime.notice(null) } }
        }
    }
    val stepRoute = state.route
    if (steps && stepRoute != null) ModalBottomSheet(onDismissRequest = { steps = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.90f).testTag("route-steps")) {
            Row(Modifier.padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${state.origin?.id ?: "我的位置"} → ${state.destinationName}", style = MaterialTheme.typography.titleLarge)
                    Text("${minutes(stepRoute.duration_s)} 分钟 · ${metres(stepRoute.distance_m)} · ${if (state.mode == "bike") "骑行" else "步行"}", Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { steps = false }) { Icon(Icons.Outlined.Close, "关闭路线详情") }
            }
            LazyColumn(contentPadding = PaddingValues(horizontal = 24.dp, vertical = 12.dp)) {
                itemsIndexed(stepRoute.maneuvers) { index, maneuver ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) { Box(Modifier.padding(10.dp)) { ManeuverIcon(maneuver.type, maneuver.modifier, 28) } }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(maneuver.instruction, style = MaterialTheme.typography.bodyLarge)
                            if (index < stepRoute.maneuvers.lastIndex) Text(metres(maneuver.distance_to_next_m), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (index < stepRoute.maneuvers.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}

private fun actionLabel(action: ManeuverAction) = maneuverLabel(action.kind, action.modifier) + (action.way_name?.let { "进入$it" } ?: "")

@Composable
private fun EndpointField(value: String, label: String, origin: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(onClick = onClick).testTag(if (origin) "route-origin" else "route-destination"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Surface(Modifier.size(8.dp), shape = CircleShape, color = if (origin) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error) { }
        Text(value, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
