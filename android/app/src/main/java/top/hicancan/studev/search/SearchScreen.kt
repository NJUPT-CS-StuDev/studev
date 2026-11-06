package top.hicancan.studev.search

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import top.hicancan.studev.account.PLATFORM_ORIGIN
import top.hicancan.studev.app.*
import top.hicancan.studev.campus.AcademicState
import top.hicancan.studev.campus.CampusModel
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.TeachingMeeting
import top.hicancan.studev.timetable.SearchField
import top.hicancan.studev.world.Names
import top.hicancan.studev.world.WEEKDAYS

private const val PAGE = 10
private val ENTITIES = setOf("courses", "teachers", "classes", "teaching-classes", "exams", "rooms", "places")
private val OTHERS = listOf("njupt-general-free-exams", "njupt-survival-guide")
private class Channel(val id: String, val label: String, val sources: List<String> = emptyList(), val excluded: List<String> = emptyList(), val dated: Boolean = false)
/** Same channels as campus.config.ts. */
private val CHANNELS = listOf(
    Channel("all", "全部", excluded = listOf("teaching-classes", "exams")),
    Channel("academic", "教务", listOf("courses", "teachers", "classes", "teaching-classes", "exams")),
    Channel("place", "地点", listOf("rooms", "places")),
    Channel("notice", "通知", excluded = ENTITIES.toList() + OTHERS, dated = true),
    Channel("material", "考试资料", listOf(OTHERS[0])),
    Channel("community", "社区", listOf(OTHERS[1])),
)
private val LABELS = mapOf("courses" to "课程", "teachers" to "老师", "classes" to "班级", "teaching-classes" to "教学班", "exams" to "考试安排", "rooms" to "教室", "places" to "地点")
private val EXAMPLES = listOf("操作系统", "周浩", "B240402", "教4-309", "一食堂", "奖学金", "高等数学", "校园网")
private data class Hit(val raw: JsonObject) {
    fun text(key: String) = raw[key]?.jsonPrimitive?.contentOrNull
    val id get() = text("id").orEmpty()
    val source get() = text("source").orEmpty()
    val title get() = text("title").orEmpty()
    val url get() = text("url").orEmpty()
    val snippet get() = text("snippet")
    val date get() = (text("publishedAt") ?: text("updatedAt"))?.take(10)
    fun ranges(key: String) = raw[key]?.jsonArray?.map { it.jsonArray[0].jsonPrimitive.int to it.jsonArray[1].jsonPrimitive.int }.orEmpty()
    val files get() = raw["attachments"]?.jsonArray?.map { it.jsonObject["name"]!!.jsonPrimitive.content to it.jsonObject["url"]!!.jsonPrimitive.content }.orEmpty()
}
private data class Answer(val key: String, val hits: List<Hit>, val total: Int, val seconds: Double)

/** Marks the kernel's ranges, which count Unicode scalar values. */
private fun marked(text: String, ranges: List<Pair<Int, Int>>, mark: SpanStyle): AnnotatedString = buildAnnotatedString {
    val points = text.codePoints().toArray()
    fun piece(from: Int, to: Int) = String(points, from, to - from)
    var at = 0
    for ((start, end) in ranges) {
        if (start >= points.size) break
        append(piece(at, start))
        withStyle(mark) { append(piece(start, minOf(end, points.size))) }
        at = minOf(end, points.size)
    }
    append(piece(at, points.size))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable fun SearchScreen(route: Route, state: AcademicState, campus: CampusPackage?, model: CampusModel) {
    val context = LocalContext.current
    val repository = state.repository
    val engine = remember(repository) { repository?.let { repo -> NativeSearch({ path -> repo.bytes("search/$path") }, { pack, offset, bytes -> repo.block("search/$pack", offset, bytes) }) } }
    DisposableEffect(engine) { onDispose { engine?.close() } }
    var page by remember { mutableIntStateOf(1) }
    var source by remember { mutableStateOf<String?>(null) }
    var sinceYears by remember { mutableIntStateOf(0) }
    var byDate by remember { mutableStateOf(false) }
    var answer by remember { mutableStateOf<Answer?>(null) }
    var failed by remember { mutableStateOf(false) }
    var courseSheet by remember { mutableStateOf<String?>(null) }
    val channel = CHANNELS.firstOrNull { it.id == route.scope } ?: CHANNELS[0]
    val query = route.query.trim()
    val list = rememberLazyListState()
    val key = listOf(query, channel.id, source, sinceYears, byDate, page, engine.hashCode()).toString()
    LaunchedEffect(key) {
        failed = false
        if (query.length < 2 || engine == null) { answer = null; return@LaunchedEffect }
        delay(120)
        val started = System.nanoTime()
        val excluded = channel.excluded.filter { !(channel.id == "all" && query.contains(' ') && it == "teaching-classes") }
        val filters = buildJsonObject {
            val only = source?.let(::listOf) ?: channel.sources
            if (only.isNotEmpty()) put("sourceIds", JsonArray(only.map(::JsonPrimitive)))
            else if (excluded.isNotEmpty()) put("excludedSourceIds", JsonArray(excluded.map(::JsonPrimitive)))
            if (sinceYears > 0) { put("publishedFrom", java.time.LocalDate.now().minusYears(sinceYears.toLong()).toString()); put("includeUndated", false) }
        }
        try {
            val done = engine.page(query, PAGE, if (byDate) "date_desc" else "relevance", filters, (page - 1) * PAGE) { ranked ->
                answer = Answer(key, ranked.results.map(::Hit), ranked.total, (System.nanoTime() - started) / 1e9)
            }
            answer = Answer(key, done.results.map(::Hit), done.total, answer?.takeIf { it.key == key }?.seconds ?: ((System.nanoTime() - started) / 1e9))
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) {
            // Without a network the index cannot be read; places are always on the phone.
            val rows = campus?.places.orEmpty().filter { place -> place.kind != "floor" && place.kind != "campus" && place.names.any { it.contains(query, ignoreCase = true) } }.take(30)
            if (rows.isEmpty()) failed = true
            answer = Answer(key, rows.map { place -> Hit(buildJsonObject {
                put("id", place.id); put("source", if (place.kind == "room") "rooms" else "places"); put("title", if (place.kind == "room") Names.room(place.id) else place.names.first()); put("url", "/map/?place=${Uri.encode(place.id)}"); put("section", place.category)
            }) }, rows.size, 0.0)
        }
    }
    LaunchedEffect(page) { list.scrollToItem(0) }
    val hits = answer?.takeIf { it.key == key || it.key.startsWith(key.substringBefore(',')) }?.hits ?: answer?.hits.orEmpty()
    fun open(link: String) {
        if (!route.open(link, PLATFORM_ORIGIN)) runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(top.hicancan.studev.app.absolute(link, PLATFORM_ORIGIN)))) }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp).padding(top = 14.dp)) {
        Box(Modifier.padding(end = 40.dp, bottom = 12.dp)) {
            SearchField(route.query, "搜课程、老师、班级、地点、通知、资料") { route.query = it; page = 1 }
        }
        if (query.isEmpty()) {
            Plain("课程、老师、班级、教室、地点、通知、考试资料、社区手册，都在这里", 13.5.sp, Ink.muted, modifier = Modifier.padding(top = 6.dp, bottom = 10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { EXAMPLES.forEach { example -> Chip(example, { route.query = example; page = 1 }) } }
            return@Column
        }
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            TextTabs(CHANNELS.map { it.id to it.label }, channel.id, gap = 18.dp) { route.scope = it; source = null; sinceYears = 0; byDate = false; page = 1 }
        }
        val sources = when {
            channel.sources.size > 1 -> channel.sources.map { it to LABELS.getValue(it) }
            else -> emptyList()
        }
        if (sources.isNotEmpty() || channel.dated) Row(Modifier.padding(top = 10.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (sources.isNotEmpty()) Pick(sources.firstOrNull { it.first == source }?.second ?: "全部类型", listOf<Pair<String?, String>>(null to "全部类型") + sources) { source = it; page = 1 }
            if (channel.dated) {
                Pick(listOf(0 to "全部时间", 1 to "近一年", 3 to "近三年", 5 to "近五年").first { it.first == sinceYears }.second, listOf(0 to "全部时间", 1 to "近一年", 3 to "近三年", 5 to "近五年")) { sinceYears = it; page = 1 }
                Pick(if (byDate) "按时间" else "按相关性", listOf(false to "按相关性", true to "按时间")) { byDate = it; page = 1 }
            }
        }
        if (query.length < 2) { Plain("再多输入一个字", 14.sp, Ink.faint, modifier = Modifier.padding(vertical = 32.dp)); return@Column }
        LazyColumn(Modifier.weight(1f), state = list) {
            answer?.takeIf { it.total > 0 }?.let { current ->
                item { Plain((if (current.total >= 1000) "超过 1000" else "约 ${current.total}") + " 条结果（${"%.2f".format(current.seconds)} 秒）" + (if (page > 1) " · 第 $page 页" else ""), 12.5.sp, Ink.faint, modifier = Modifier.padding(top = 12.dp, bottom = 2.dp)) }
            }
            items(hits, key = { it.id }) { hit -> if (hit.source in ENTITIES) EntityRow(hit) { if (hit.source == "courses") courseSheet = hit.title else open(hit.url) } else DocumentRow(hit, ::open) }
            answer?.takeIf { it.key == key && it.total == 0 }?.let { item { Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain("没有找到“$query”", 14.sp, Ink.faint) } } }
            if (failed) item { Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain("搜索需要联网，请稍后重试", 14.sp, Ink.faint) } }
            answer?.let { current -> item { Pages(page, current.total) { page = it } } }
        }
    }
    courseSheet?.let { name -> CourseSheet(name, model, route) { courseSheet = null } }
}

@Composable private fun <T> Pick(label: String, options: List<Pair<T, String>>, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Chip("$label ▾", { open = true })
        DropdownMenu(open, { open = false }, containerColor = Ink.paper) {
            options.forEach { (value, text) -> DropdownMenuItem({ Plain(text, 14.sp) }, { open = false; onPick(value) }) }
        }
    }
}

@Composable private fun EntityRow(hit: Hit, onClick: () -> Unit) {
    val brand = Ink.brand
    val text = Ink.text
    Row(Modifier.fillMaxWidth().bottomHairline(Ink.line).clickable(onClick = onClick).padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Plain(LABELS[hit.source].orEmpty(), 12.sp, Ink.faint, modifier = Modifier.width(44.dp), maxLines = 1)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(marked(hit.title, hit.ranges("titleHighlights"), SpanStyle(color = brand)), style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = text), maxLines = 1)
                hit.text("section")?.let { Plain(it, 12.5.sp, Ink.muted, modifier = Modifier.padding(start = 8.dp), maxLines = 1) }
            }
            hit.snippet?.takeIf { it != hit.title }?.let { Text(marked(it, hit.ranges("snippetHighlights"), SpanStyle(color = text)), style = TextStyle(fontSize = 12.5.sp, color = Ink.muted), maxLines = 1) }
        }
        Plain("›", 15.sp, Ink.faint)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun DocumentRow(hit: Hit, open: (String) -> Unit) {
    val brand = Ink.brand
    val tint = SpanStyle(color = Ink.text, background = brand.copy(alpha = .1f))
    fun says(value: String) = value.replace(Regex("\\.[A-Za-z0-9]{1,5}$"), "").trim()
    val snippet = hit.snippet?.takeIf { value -> says(value) != says(hit.title) && hit.files.none { says(it.first) == says(value) } }
    Column(Modifier.fillMaxWidth().padding(vertical = 14.dp)) {
        Plain(listOfNotNull(hit.text("sourceName"), hit.text("section")).joinToString(" › ") + (hit.date?.let { " · $it" } ?: ""), 12.5.sp, Ink.muted, maxLines = 1)
        Text(marked(hit.title, hit.ranges("titleHighlights"), SpanStyle(fontWeight = FontWeight.Bold)), Modifier.padding(vertical = 3.dp).clickable { open(hit.url) }, style = TextStyle(fontSize = 17.sp, lineHeight = 24.sp, color = brand))
        snippet?.let { Text(marked(it, hit.ranges("snippetHighlights"), tint), style = TextStyle(fontSize = 14.sp, lineHeight = 23.sp, color = Ink.muted), maxLines = 3) }
        if (hit.files.isNotEmpty()) FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            hit.files.take(4).forEach { (name, url) -> Plain(name, 12.5.sp, Ink.muted, modifier = Modifier.clickable { open(url) }, maxLines = 1) }
        }
    }
}

@Composable private fun Pages(page: Int, total: Int, onPage: (Int) -> Unit) {
    val last = (total + PAGE - 1) / PAGE
    if (last <= 1) return
    val from = maxOf(1, minOf(page - 2, last - 4))
    val to = minOf(last, from + 4)
    val ink = Ink.text
    Row(Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 16.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.clickable(enabled = page > 1) { onPage(page - 1) }.padding(horizontal = 8.dp, vertical = 8.dp)) { Plain("‹ 上一页", 13.5.sp, if (page > 1) Ink.muted else Ink.line) }
        (from..to).forEach { number ->
            val on = number == page
            Box(Modifier.widthIn(min = 34.dp).clickable { onPage(number) }.drawBehind { if (on) drawRect(ink, Offset(0f, size.height - 2.dp.toPx()), Size(size.width, 2.dp.toPx())) }.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                Plain(number.toString(), 13.5.sp, if (on) Ink.text else Ink.muted, if (on) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
        Box(Modifier.clickable(enabled = page < last) { onPage(page + 1) }.padding(horizontal = 8.dp, vertical = 8.dp)) { Plain("下一页 ›", 13.5.sp, if (page < last) Ink.muted else Ink.line) }
    }
}

@Composable private fun CourseSheet(name: String, model: CampusModel, route: Route, onClose: () -> Unit) {
    var groups by remember { mutableStateOf<List<List<TeachingMeeting>>?>(null) }
    LaunchedEffect(name) { groups = model.meetings().filter { Names.course(it.course.name) == name }.groupBy { it.teaching_class.id }.values.sortedByDescending { it.size } }
    PlainSheet(name, onClose) {
        Plain(groups?.let { "${it.size} 个教学班，点一个叠到你的课表上看看" } ?: "正在读取…", 13.5.sp, Ink.muted)
        KeyRow(null, "这门课的全部时段", chevron = true, onClick = { onClose(); route.timetable("course", name) })
        LazyColumn(Modifier.heightIn(max = 460.dp)) {
            items(groups.orEmpty(), key = { it.first().teaching_class.id }) { rows ->
                val slots = rows.map { "${WEEKDAYS[it.weekday]} ${it.periods.first()}–${it.periods.last()} 节" }.distinct().take(3).joinToString("，")
                KeyRow(null, rows.flatMap { row -> row.teachers.map { it.name } }.distinct().joinToString(" ").ifEmpty { "教师待定" }, slots + (rows.first().room?.let { " · ${Names.room(it)}" } ?: ""), onClick = {
                    onClose(); route.whoType = "me"; route.preview = rows.first().teaching_class.id; route.scale = "week"; route.tab = "timetable"
                })
            }
        }
    }
}
