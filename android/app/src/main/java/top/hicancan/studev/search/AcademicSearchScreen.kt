package top.hicancan.studev.search

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import top.hicancan.studev.campus.*
import top.hicancan.studev.data.Place

@Composable fun AcademicSearchScreen(engine: AcademicSearch, initialQuery: String, findPlaces: suspend (String) -> List<Place>, onPlace: (String) -> Unit, onScreen: (String, String) -> Unit) {
    val context = LocalContext.current
    var query by rememberSaveable(initialQuery) { mutableStateOf(initialQuery) }
    var results by remember { mutableStateOf<List<AcademicResult>>(emptyList()) }
    var places by remember { mutableStateOf<List<Place>>(emptyList()) }
    var placesOnly by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(query, engine, placesOnly) {
        results = emptyList(); places = emptyList(); error = null
        if (query.trim().length < 2) { busy = false; return@LaunchedEffect }
        busy = true
        try { delay(250); if (placesOnly) places = findPlaces(query) else results = engine.search(query) }
        catch (e: CancellationException) { throw e }
        catch (_: Exception) { error = "搜索数据暂时无法读取，请稍后重试" }
        finally { busy = false }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 20.dp).testTag("academic-search")) {
        OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().testTag("search-query"), label = { Text("搜索校园通知、资料、地点…") }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) })
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(!placesOnly, { placesOnly = false }, { Text("通知与资料") }); FilterChip(placesOnly, { placesOnly = true }, { Text("地点") })
            AssistChip({ onScreen("timetable", query) }, { Text("课表") }); AssistChip({ onScreen("rooms", query) }, { Text("教室") })
        }
        when {
            busy -> { LinearProgressIndicator(Modifier.fillMaxWidth()); Supporting("正在搜索…", Modifier.padding(vertical = 12.dp)) }
            error != null -> EmptyCard("暂时无法搜索", error!!)
            query.trim().length < 2 -> EmptyCard("学校的事，搜一下", "输入至少两个字，查通知、办事指南和学习资料。地点与教室也可以直接查询。")
            results.isEmpty() && places.isEmpty() -> EmptyCard("没有找到相关内容", "换个关键词试试，或选择上方的查询入口。")
            else -> Supporting("按相关度排列 · ${if (placesOnly) places.size else results.size} 条结果")
        }
        LazyColumn(Modifier.weight(1f).testTag(if (busy) "search-loading" else "search-results"), contentPadding = PaddingValues(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(places, key = { "place:${it.id}" }) { place -> OutlinedCard({ onPlace(place.id) }, Modifier.fillMaxWidth()) {
                ListItem(headlineContent = { Text(place.id) }, supportingContent = { Text(listOf(place.kindLabel, place.parent).joinToString(" · ")) })
            } }
            items(results, key = { it.id }) { result -> OutlinedCard({
                val uri = Uri.parse(result.url)
                if (uri.scheme in listOf("https", "http")) runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            }, Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Text(result.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f)); Icon(Icons.AutoMirrored.Outlined.OpenInNew, "打开原文", Modifier.size(18.dp)) }
                    if (result.snippet.isNotBlank()) Supporting(result.snippet.replace(Regex("<[^>]+>"), ""), maxLines = 3)
                    Supporting(result.source.ifBlank { Uri.parse(result.url).host.orEmpty() })
                }
            } }
        }
    }
}
