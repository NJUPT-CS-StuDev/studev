package top.hicancan.studev.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.Place
import top.hicancan.studev.data.PlacePreferences
import top.hicancan.studev.ui.theme.Tokens

private data class Category(val label: String, val icon: ImageVector, val pattern: Regex)
private val categories = listOf(
    Category("教学楼", Icons.Outlined.School, Regex("教学楼|^教[一二三四五六七八九0-9]")),
    Category("宿舍", Icons.Outlined.Bed, Regex("宿舍|苑.*[栋舍]|[栋舍].*苑")),
    Category("食堂", Icons.Outlined.Restaurant, Regex("食堂")),
    Category("图书馆", Icons.Outlined.LocalLibrary, Regex("图书馆")),
    Category("体育", Icons.Outlined.SportsBasketball, Regex("体育|运动|球场|操场|健身")),
    Category("超市", Icons.Outlined.Storefront, Regex("超市|便利店|便民商店")),
    Category("快递", Icons.Outlined.Inventory2, Regex("快递|速递|驿站")),
)

@Composable
internal fun SearchScreen(campus: CampusPackage, search: CampusSearch, preferences: PlacePreferences,
                          onBack: () -> Unit, onPlace: (Place) -> Unit, onMyPosition: (() -> Unit)? = null) {
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var results by remember { mutableStateOf<List<Place>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    val recent by preferences.recent.collectAsStateWithLifecycle(emptyList())
    val saved by preferences.saved.collectAsStateWithLifecycle(emptySet())
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(query, category, retry) {
        error = false
        val chosen = categories.find { it.label == category }
        if (chosen != null) {
            results = campus.places.filter { it.kind != "room" && chosen.pattern.containsMatchIn((it.names + it.id + it.kind).joinToString(" ")) }
            busy = false
        } else if (query.trim().length >= 2) {
            results = emptyList(); busy = true
            delay(Tokens.Motion.quick.toLong())
            try { results = search.search(query, campus) }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { error = true }
            finally { busy = false }
        } else { results = emptyList(); busy = false }
    }
    val choose: (Place) -> Unit = { keyboard?.hide(); onPlace(it) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            Row(Modifier.padding(horizontal = Tokens.Space.s.dp, vertical = Tokens.Space.s.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回地图") }
                OutlinedTextField(value = query, onValueChange = { query = it; category = null }, singleLine = true,
                    placeholder = { Text("搜索地点、楼栋或教室") },
                    modifier = Modifier.weight(1f).focusRequester(focus),
                    shape = RoundedCornerShape(Tokens.Radius.sheet.dp),
                    leadingIcon = { Icon(Icons.Outlined.Search, null) },
                    trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = ""; category = null }) { Icon(Icons.Outlined.Close, "清除搜索") } },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
                    colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow))
            }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth()) else HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            if (onMyPosition != null) TextButton(onClick = { keyboard?.hide(); onMyPosition() }, Modifier.fillMaxWidth().height(48.dp)) {
                Icon(Icons.Outlined.MyLocation, null); Spacer(Modifier.width(12.dp)); Text("使用我的位置作为起点")
            }
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = Tokens.Space.xl.dp)) {
                if (query.isEmpty() && category == null) {
                    item {
                        Text("探索仙林", Modifier.padding(Tokens.Space.xl.dp), style = MaterialTheme.typography.titleLarge)
                        Column(Modifier.padding(horizontal = Tokens.Space.l.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s.dp)) {
                            categories.chunked(4).forEach { row ->
                                Row(Modifier.fillMaxWidth()) {
                                    row.forEach { c ->
                                        Column(Modifier.weight(1f).clickable { keyboard?.hide(); category = c.label }
                                            .padding(vertical = Tokens.Space.s.dp), horizontalAlignment = Alignment.CenterHorizontally,
                                            verticalArrangement = Arrangement.spacedBy(Tokens.Space.s.dp)) {
                                            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                                                Icon(c.icon, null, Modifier.padding(Tokens.Space.m.dp).size(24.dp), tint = MaterialTheme.colorScheme.primary)
                                            }
                                            Text(c.label, style = MaterialTheme.typography.labelLarge)
                                        }
                                    }
                                    repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                                }
                            }
                        }
                        Row(Modifier.fillMaxWidth().padding(start = Tokens.Space.xl.dp, end = Tokens.Space.m.dp, top = Tokens.Space.xl.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text("最近搜索", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                            if (recent.isNotEmpty()) TextButton(onClick = { scope.launch { preferences.clearRecent() } }) { Text("清空") }
                        }
                    }
                    if (recent.isEmpty()) item { Text("搜索过的地点会留在这里", Modifier.padding(horizontal = Tokens.Space.xl.dp, vertical = Tokens.Space.l.dp),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(recent.mapNotNull(campus.byId::get), key = { "recent:${it.id}" }) { PlaceRow(it, campus, Icons.Outlined.History, choose) }
                    if (saved.isNotEmpty()) {
                        item { Text("我的收藏", Modifier.padding(Tokens.Space.xl.dp), style = MaterialTheme.typography.titleMedium) }
                        items(saved.mapNotNull(campus.byId::get), key = { "saved:${it.id}" }) { PlaceRow(it, campus, Icons.Outlined.StarOutline, choose) }
                    }
                } else if (error) item {
                    Column(Modifier.fillMaxWidth().padding(Tokens.Space.xl.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("搜索暂时不可用", style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = { retry++ }) { Text("重试") }
                    }
                } else if (!busy && results.isEmpty()) item {
                    Column(Modifier.fillMaxWidth().padding(Tokens.Space.xxl.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.m.dp)) {
                        Text(if (query.trim().length == 1) "再输入一个字，找到更准确的地点" else "没有找到相关地点", style = MaterialTheme.typography.titleMedium)
                        Text("试试楼栋简称，如「教3」，或地点名称「图书馆」。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    for ((label, group) in results.groupBy { if (it.kind == "room") "教室" else "地点" }.entries.sortedBy { if (it.key == "地点") 0 else 1 }) {
                        item(key = label) { Text("${category ?: label} · ${group.size}", Modifier.padding(horizontal = Tokens.Space.xl.dp, vertical = Tokens.Space.l.dp),
                            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        items(group, key = { it.id }) { PlaceRow(it, campus, if (it.kind == "room") Icons.Outlined.MeetingRoom else Icons.Outlined.LocationOn, choose) }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlaceRow(place: Place, campus: CampusPackage, icon: ImageVector, onPlace: (Place) -> Unit) {
    Row(Modifier.fillMaxWidth().testTag("place:${place.id}").clickable { onPlace(place) }.padding(horizontal = Tokens.Space.xl.dp, vertical = Tokens.Space.l.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.l.dp)) {
        Icon(icon, null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Tokens.Space.xs.dp)) {
            Text(place.id, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOf(place.kindLabel, campus.byId[place.parent]?.id ?: "仙林校区").joinToString(" · "),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.outline)
    }
}
