package top.hicancan.studev.search

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import top.hicancan.studev.campus.*
import top.hicancan.studev.data.Place

@Composable
fun AcademicSearchScreen(engine: AcademicSearch, initialQuery: String, findPlaces: suspend (String) -> List<Place>,
                         onPlace: (String) -> Unit, initialScope: String = "web", byId: Map<String, Place> = emptyMap(),
                         onScreen: (String, String) -> Unit) {
    val context = LocalContext.current
    val keyboard = LocalSoftwareKeyboardController.current
    var query by rememberSaveable(initialQuery) { mutableStateOf(initialQuery) }
    var scope by rememberSaveable(initialScope) { mutableStateOf(initialScope) }
    var sort by rememberSaveable { mutableStateOf("relevance") }
    var years by rememberSaveable { mutableIntStateOf(0) }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var source by rememberSaveable { mutableStateOf<String?>(null) }
    var limit by remember { mutableIntStateOf(30) }
    var page by remember { mutableStateOf<AcademicPage?>(null) }
    var places by remember { mutableStateOf<List<Place>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    val list = rememberLazyListState()
    val requestKey = listOf(query.trim(), scope, sort, years.toString(), category, source).joinToString("\u001f")
    var displayedKey by remember { mutableStateOf("") }
    LaunchedEffect(requestKey) { limit = 30; list.scrollToItem(0) }
    LaunchedEffect(requestKey, limit, retry, engine) {
        if (displayedKey != requestKey) { page = null; places = emptyList() }
        error = null
        if (query.trim().length < 2) { busy = false; return@LaunchedEffect }
        busy = true
        try {
            delay(220)
            if (scope == "places") places = findPlaces(query) else page = engine.page(query, scope, sort, years, category, source, limit)
            displayedKey = requestKey
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { error = "搜索数据暂时无法读取。请联网后重试；已下载的数据可离线使用。"; displayedKey = requestKey }
        finally { busy = false }
    }
    val loading = query.trim().length >= 2 && (busy || displayedKey != requestKey)
    val currentPage = page.takeIf { displayedKey == requestKey }
    val currentPlaces = places.takeIf { displayedKey == requestKey }.orEmpty()
    fun open(url: String) {
        keyboard?.hide()
        val uri = Uri.parse(url)
        if (uri.scheme !in listOf("https", "http")) return
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            .onFailure { Toast.makeText(context, "无法打开链接，请检查是否安装浏览器", Toast.LENGTH_SHORT).show() }
    }
    val quickQueries = when (scope) {
        "community" -> listOf("校园网", "宿舍", "选课", "开发环境")
        "materials" -> listOf("高等数学", "大学物理", "数据结构", "概率论")
        "places" -> listOf("图书馆", "教3", "食堂", "快递")
        else -> listOf("转专业", "奖学金", "校园卡", "计算机等级")
    }
    Column(Modifier.fillMaxSize().imePadding().testTag("academic-search")) {
        OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag("search-query"),
            placeholder = { Text(when (scope) { "materials" -> "搜索课程、试卷和复习资料"; "community" -> "搜索校园生活与办事指南"; "places" -> "搜索地点、楼栋或教室"; else -> "搜索学校通知、附件和办事信息" }) },
            singleLine = true, shape = RoundedCornerShape(28.dp), leadingIcon = { Icon(Icons.Outlined.Search, null) },
            trailingIcon = { if (query.isNotEmpty()) IconButton({ query = "" }) { Icon(Icons.Outlined.Close, "清空搜索") } },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
            colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow, unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant))
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("web" to "网站搜索", "community" to "社区", "materials" to "资料", "places" to "地点").forEach { (key, label) ->
                FilterChip(scope == key, { scope = key; category = null; source = null; years = 0; sort = "relevance" }, { Text(label) }, modifier = Modifier.testTag("search-scope-$key"))
            }
            AssistChip({ keyboard?.hide(); onScreen("timetable", query) }, { Text("查课程") })
            AssistChip({ keyboard?.hide(); onScreen("rooms", query) }, { Text("空教室") })
        }
        if (scope != "places" && query.trim().length >= 2) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (scope == "web") {
                SearchMenu(if (sort == "relevance") "相关度" else "最新优先", listOf("relevance" to "相关度", "date_desc" to "最新优先"), "search-sort") { sort = it }
                SearchMenu(if (years == 0) "全部时间" else "近${years}年", listOf("0" to "全部时间", "1" to "近一年", "3" to "近三年", "5" to "近五年"), "search-date") { years = it.toInt() }
                val sources = currentPage?.sources.orEmpty().filter { it.first !in repositorySourceIds }
                SearchMenu(sources.find { it.first == source }?.second ?: "全部来源", listOf("" to "全部来源") + sources, "search-source") { source = it.ifEmpty { null } }
            }
            SearchMenu(searchCategoryLabels[category] ?: "全部类型", listOf("" to "全部类型") + searchCategoryLabels.toList(), "search-category") { category = it.ifEmpty { null } }
        }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 6.dp))
        LazyColumn(Modifier.weight(1f).testTag(if (loading) "search-loading" else "search-results"), state = list,
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            when {
                query.trim().length < 2 -> item {
                    Column(Modifier.padding(vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text(when (scope) { "community" -> "校园经验，搜一下"; "materials" -> "复习资料，从这里找"; "places" -> "校园地点，随手查"; else -> "学校的事，搜一下" }, style = MaterialTheme.typography.headlineSmall)
                        Supporting("输入至少两个字。网站通知、社区经验和课程资料可分别搜索。")
                        quickQueries.chunked(2).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            row.forEach { text -> SuggestionChip({ query = text; keyboard?.hide() }, { Text(text) }) }
                        } }
                    }
                }
                error != null -> item { EmptyCard("暂时无法搜索", error!!, "重试") { retry++ } }
                loading && currentPage == null && currentPlaces.isEmpty() -> items(3) {
                    Column(Modifier.fillMaxWidth().padding(vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        listOf(.45f, .9f, .75f).forEach { width -> Box(Modifier.fillMaxWidth(width).height(14.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(4.dp))) }
                    }
                }
                else -> {
                    val count = if (scope == "places") currentPlaces.size else currentPage?.total ?: 0
                    item { Supporting(if (count == 0) "没有找到相关内容，换个关键词或搜索范围试试。" else "找到 $count 条相关结果" + if (scope != "places" && count > (currentPage?.results?.size ?: 0)) " · 已显示 ${currentPage?.results?.size ?: 0} 条" else "", Modifier.padding(bottom = 10.dp)) }
                    if (scope == "places") items(currentPlaces, key = { "place:${it.id}" }) { place ->
                        ListItem(headlineContent = { Text(place.displayName(byId)) }, supportingContent = { Text(listOfNotNull(place.kindLabel, byId[place.parent]?.displayName(byId)).joinToString(" · ")) }, modifier = Modifier.clickable { keyboard?.hide(); onPlace(place.id) })
                    } else items(currentPage?.results.orEmpty(), key = { it.id }) { result ->
                        Column(Modifier.fillMaxWidth().clickable { open(result.url) }.padding(vertical = 12.dp).testTag("search-result-${result.id}"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Supporting(listOfNotNull(searchCategoryLabels[result.category], result.source.ifBlank { Uri.parse(result.url).host.orEmpty() }, result.section.takeIf { it.isNotBlank() }, result.date.takeIf { it.isNotBlank() }).joinToString(" · "))
                            Text(highlightSearchText(result.title, result.matchedTerms), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                            if (result.snippet.isNotBlank()) Text(highlightSearchText(result.snippet, result.matchedTerms), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(13.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(result.url, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            if (result.attachments.isNotEmpty()) {
                                Supporting("${result.attachments.size} 个附件")
                                result.attachments.take(3).forEach { attachment -> TextButton({ open(attachment.url) }, contentPadding = PaddingValues(0.dp)) {
                                    Icon(Icons.Outlined.AttachFile, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(attachment.name, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                } }
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    if (scope != "places" && (currentPage?.total ?: 0) > (currentPage?.results?.size ?: 0)) item {
                        if (limit < 200) OutlinedButton({ limit = (limit + 20).coerceAtMost(200) }, enabled = !loading, modifier = Modifier.fillMaxWidth().testTag("search-more")) { Text(if (loading) "正在加载…" else "显示更多结果") }
                        else Supporting("已显示前 200 条，请用来源、类型或时间缩小范围。")
                    }
                }
            }
        }
    }
}

@Composable private fun SearchMenu(label: String, options: List<Pair<String, String>>, tag: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        TextButton({ expanded = true }, modifier = Modifier.testTag(tag)) { Text(label, maxLines = 1); Icon(Icons.Outlined.ArrowDropDown, null, Modifier.size(18.dp)) }
        DropdownMenu(expanded, { expanded = false }) { options.forEach { (id, name) -> DropdownMenuItem(text = { Text(name) }, onClick = { expanded = false; onSelect(id) }) } }
    }
}

@Composable private fun highlightSearchText(text: String, terms: List<String>) = buildAnnotatedString {
    append(text)
    val highlight = SpanStyle(background = MaterialTheme.colorScheme.secondaryContainer, fontWeight = FontWeight.SemiBold)
    terms.distinct().filter { it.length >= 2 }.sortedByDescending { it.length }.forEach { term ->
        var start = text.indexOf(term, ignoreCase = true)
        while (start >= 0) { addStyle(highlight, start, start + term.length); start = text.indexOf(term, start + term.length, ignoreCase = true) }
    }
}
