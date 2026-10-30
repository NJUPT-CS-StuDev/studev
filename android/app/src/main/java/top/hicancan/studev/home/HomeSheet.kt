package top.hicancan.studev.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import top.hicancan.studev.BuildConfig
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.Place
import top.hicancan.studev.navigation.metres
import java.time.LocalDateTime

fun categoryIcon(category: String?) = when (category) {
    "食堂" -> Icons.Outlined.Restaurant; "图书馆" -> Icons.Outlined.LocalLibrary
    "教学楼" -> Icons.Outlined.School; "超市" -> Icons.Outlined.ShoppingBag
    "快递" -> Icons.Outlined.Inventory2; "打印" -> Icons.Outlined.Print
    "体育" -> Icons.Outlined.SportsBasketball; "校医院" -> Icons.Outlined.LocalHospital
    "宿舍" -> Icons.Outlined.Apartment; else -> Icons.Outlined.Place
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HomeSheet(campus: CampusPackage, position: List<Double>?, peek: Dp,
                       onSearch: () -> Unit, onPlace: (Place) -> Unit, onRoute: (Place) -> Unit) {
    val now = CampusClock.now()
    val moment = DayMoment.at(now.hour)
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var debugMenu by remember { mutableStateOf(false) }
    val state = rememberBottomSheetScaffoldState()
    val scope = rememberCoroutineScope()
    val height = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.height.toDp() }
    val categories = remember(campus) { listOf("食堂", "图书馆", "教学楼", "超市", "快递", "打印", "体育", "校医院")
        .filter { c -> campus.places.any { it.category == c } } }
    val ranked = remember(campus, position, now, category) { HomeRecommendations.rank(campus.places, now, position, category) }
    BackHandler(category != null || state.bottomSheetState.currentValue == SheetValue.Expanded) {
        if (category != null) category = null else scope.launch { state.bottomSheetState.partialExpand() }
    }
    BottomSheetScaffold(scaffoldState = state, containerColor = Color.Transparent,
        sheetPeekHeight = peek, sheetContainerColor = MaterialTheme.colorScheme.surface,
        sheetShape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), sheetShadowElevation = 8.dp,
        sheetContent = {
            Column(Modifier.fillMaxWidth().height(height * .82f).navigationBarsPadding()) {
                Surface(onClick = onSearch, modifier = Modifier.padding(horizontal = 20.dp).fillMaxWidth().testTag("home-search"),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(18.dp)) {
                    Row(Modifier.height(54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Outlined.Search, null, tint = MaterialTheme.colorScheme.primary)
                        Text("搜索地点、楼栋或教室", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
                    }
                }
                LazyRow(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(categories) { c ->
                        Column(Modifier.width(64.dp).testTag("category:$c").clickable { category = if (category == c) null else c },
                            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            Surface(shape = CircleShape, color = if (category == c) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.primaryContainer) {
                                Icon(categoryIcon(c), null, Modifier.padding(12.dp).size(23.dp), tint = if (category == c) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.primary)
                            }
                            Text(c, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
                Row(Modifier.fillMaxWidth().padding(start = 22.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (category != null) IconButton(onClick = { category = null }, modifier = Modifier.size(36.dp)) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回热门推荐") }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(category?.let { "附近$it" } ?: "热门推荐", style = MaterialTheme.typography.titleLarge)
                        Text((if (category == null) moment.subtitle else "${ranked.size} 个地点 · 按距离排序") + if (position == null) " · 距校区中心" else " · 距我", style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (BuildConfig.DEBUG) Box {
                        IconButton(onClick = { debugMenu = true }) { Icon(Icons.Outlined.MoreHoriz, "演示时间") }
                        DropdownMenu(expanded = debugMenu, onDismissRequest = { debugMenu = false }) {
                            listOf("实时" to null, "早晨 07:40" to 7, "午餐 12:00" to 12, "晚间 20:00" to 20, "深夜 23:00" to 23).forEach { (label, hour) ->
                                DropdownMenuItem(text = { Text(label) }, onClick = {
                                    CampusClock.setDebugTime(hour?.let { LocalDateTime.now().withHour(it).withMinute(if (it == 7) 40 else 0) }); debugMenu = false
                                })
                            }
                        }
                    }
                }
                LazyColumn(Modifier.weight(1f).padding(top = 8.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
                    if (ranked.isEmpty()) item { Text("暂无符合当前时段的地点，试试上方分类", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(ranked, key = { it.place.id }) { item ->
                        Row(Modifier.fillMaxWidth().testTag("recommend:${item.place.id}").clickable { onPlace(item.place) }.padding(horizontal = 22.dp, vertical = 13.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                            Surface(shape = RoundedCornerShape(15.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                                Icon(categoryIcon(item.place.category), null, Modifier.padding(14.dp).size(24.dp), tint = MaterialTheme.colorScheme.primary)
                            }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(item.place.id, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(item.status.state.label, style = MaterialTheme.typography.labelMedium,
                                        color = if (item.status.state in listOf(OpenState.Open, OpenState.Closing)) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(metres(item.distance), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Text(item.place.use, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            IconButton(onClick = { onRoute(item.place) }, Modifier.testTag("recommend-route:${item.place.id}")) { Icon(Icons.Outlined.Directions, "前往${item.place.id}", tint = MaterialTheme.colorScheme.primary) }
                        }
                        HorizontalDivider(Modifier.padding(start = 88.dp, end = 22.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))
                    }
                    item { Text(if (position == null) "距离以校区中心为起点 · 开启定位可查看附近" else "距离为直线距离 · 路线以实际规划为准",
                        Modifier.padding(22.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }) { }
}

