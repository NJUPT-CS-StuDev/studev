package top.hicancan.studev.search

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import top.hicancan.studev.account.PLATFORM_ORIGIN
import top.hicancan.studev.R
import top.hicancan.studev.app.*
import top.hicancan.studev.app.AcademicState
import top.hicancan.studev.app.CampusModel
import top.hicancan.search.SearchException
import top.hicancan.studev.data.DataCorruptionException
import top.hicancan.studev.data.TeachingMeeting
import top.hicancan.studev.timetable.SearchField
import top.hicancan.studev.world.Names
import top.hicancan.studev.world.WEEKDAYS
import top.hicancan.studev.world.Channel

private const val PAGE = 10
private val SINCE = listOf("" to "全部时间", "3" to "近三天", "7" to "近一周", "30" to "近一月", "365" to "近一年")
private val ENTITIES = setOf("courses", "teachers", "classes", "teaching-classes", "exams", "rooms", "places", "topics", "sections")
private val LABELS = mapOf("courses" to "课程", "teachers" to "老师", "classes" to "班级", "teaching-classes" to "教学班", "exams" to "考试安排", "rooms" to "教室", "places" to "地点", "topics" to "知识点", "sections" to "资料章节")
private val FILLER_SECTIONS = setOf("Direct detail links", "显示更多", "更多", "查看更多", "More")
private val FILE_SUFFIX = Regex("""\.[a-z0-9]{1,5}$""", RegexOption.IGNORE_CASE)
private val FILE_TYPE = Regex("""\.([a-z0-9]{2,5})(?:$|[?#])""", RegexOption.IGNORE_CASE)
private val RESULT_DATE = Regex("""(\d{4})-(\d{2})-(\d{2})""")

private fun fileType(url: String) = FILE_TYPE.find(url)?.groupValues?.get(1)?.uppercase()
private fun fileName(name: String) = name.trim().replace(FILE_SUFFIX, "")

private data class Attachment(val name: String, val url: String, val type: String)

private data class Hit(val raw: JsonObject) {
    fun text(key: String) = raw[key]?.jsonPrimitive?.contentOrNull
    val id get() = text("id").orEmpty()
    val source get() = text("source").orEmpty()
    val title get() = text("title").orEmpty()
    val url get() = text("url").orEmpty()
    val snippet get() = text("snippet")
    val date get() = RESULT_DATE.matchEntire((text("publishedAt") ?: text("updatedAt")).orEmpty().take(10))
        ?.destructured?.let { (year, month, day) -> "${year}年${month.toInt()}月${day.toInt()}日" }
    fun ranges(key: String) = raw[key]?.jsonArray?.map { it.jsonArray[0].jsonPrimitive.int to it.jsonArray[1].jsonPrimitive.int }.orEmpty()
    val files get() = raw["attachments"]?.jsonArray?.map {
        val file = it.jsonObject
        val url = file.getValue("url").jsonPrimitive.content
        Attachment(file.getValue("name").jsonPrimitive.content, url,
            file["extension"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank)?.uppercase() ?: fileType(url) ?: "文件")
    }.orEmpty()
}
private data class Answer(val key: String, val hits: List<Hit>, val total: Int, val seconds: Double)
private data class Facets(val sources: Map<String, String>, val categories: Set<String>)

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
@Composable fun SearchScreen(route: Route, state: AcademicState, model: CampusModel) {
    val context = LocalContext.current
    val channels = remember(context) { Channel.load(context) }
    val repository = state.repository
    val engine = repository?.search
    val page = route.searchPage
    val source = route.searchSource
    val since = route.searchSince
    val byDate = route.searchByDate
    val category = route.searchType
    var facets by remember(repository) { mutableStateOf<Facets?>(null) }
    var answer by remember { mutableStateOf<Answer?>(null) }
    var failure by remember { mutableStateOf<Pair<String, String>?>(null) }
    var courseSheet by remember { mutableStateOf<String?>(null) }
    val channel = channels.firstOrNull { it.id == route.scope } ?: channels[0]
    val query = route.query.trim()
    val list = rememberLazyListState()
    val searchFocus = remember { FocusRequester() }
    LaunchedEffect(route.tab, route.searchFocus) {
        if (route.tab == "search" && route.searchFocus) {
            route.searchFocus = false
            runCatching { searchFocus.requestFocus() }
        }
    }
    val browsing = query.isEmpty()
    val live = channel.id == "room" && browsing && route.within == null
    val key = listOf(query, channel.id, source, since, byDate, category, page, route.within, engine.hashCode()).toString()
    LaunchedEffect(key) {
        failure = null
        if (query.length == 1 || live || engine == null) { answer = null; return@LaunchedEffect }
        delay(120)
        val started = System.nanoTime()
        val excluded = channel.excluded.filter { !(channel.id == "all" && query.contains(' ') && it == "teaching-classes") }
        val filters = buildJsonObject {
            val only = source?.let(::listOf) ?: channel.sources
            if (only.isNotEmpty()) put("sourceIds", JsonArray(only.map(::JsonPrimitive)))
            else if (excluded.isNotEmpty()) put("excludedSourceIds", JsonArray(excluded.map(::JsonPrimitive)))
            val today = java.time.LocalDate.now(top.hicancan.studev.world.CampusDay.zone)
            // Time means when a thing was published, never later than today.
            when {
                since.isNotEmpty() -> { put("publishedFrom", today.minusDays(since.toLong()).toString()); put("publishedTo", today.toString()); put("includeUndated", false) }
                browsing -> { put("publishedTo", today.toString()); put("includeUndated", true) }
            }
            category?.let { put("category", it) }
            route.within?.let { put("within", it) }
        }
        try {
            val done = engine.page(query, PAGE, if (byDate || browsing) "date_desc" else "relevance", filters, (page - 1) * PAGE)
            val names = done.filters["sources"]?.jsonArray.orEmpty().associate { value ->
                val item = value.jsonObject
                item.getValue("id").jsonPrimitive.content to item.getValue("label").jsonPrimitive.content
            }
            val categories = done.filters["categories"]?.jsonArray.orEmpty().map { it.jsonObject.getValue("id").jsonPrimitive.content }.toSet()
            facets = Facets(names, categories)
            answer = Answer(key, done.results.map(::Hit), done.total, (System.nanoTime() - started) / 1e9)
        } catch (_: java.io.IOException) {
            answer = null
            failure = key to "搜索需要联网，请稍后重试"
        } catch (error: SearchException) {
            android.util.Log.e("Search", "Search data could not be read", error)
            answer = null
            failure = key to "搜索数据有误，暂时无法显示结果"
        } catch (error: kotlinx.serialization.SerializationException) {
            android.util.Log.e("Search", "Search data could not be read", error)
            answer = null
            failure = key to "搜索数据有误，暂时无法显示结果"
        } catch (error: DataCorruptionException) {
            android.util.Log.e("Search", "Search data could not be read", error)
            answer = null
            failure = key to "搜索数据有误，暂时无法显示结果"
        }
    }
    LaunchedEffect(page) { list.scrollToItem(0) }
    val currentAnswer = answer?.takeIf { it.key == key }
    val hits = currentAnswer?.hits.orEmpty()
    fun open(link: String) {
        if (!route.open(link, PLATFORM_ORIGIN)) runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(top.hicancan.studev.app.absolute(link, PLATFORM_ORIGIN)))) }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
        CampusHeader {
            SearchField(route.query, "搜索课程、老师、地点、通知、资料", Modifier.focusRequester(searchFocus), height = Tokens.Size.search.dp) { route.query = it; route.searchPage = 1 }
        }
        Spacer(Modifier.height(6.dp))
        route.within?.let { place -> Box(Modifier.padding(bottom = 8.dp)) { Chip("在 ${Names.room(place)} 里 ×", { route.within = null; route.searchPage = 1 }) } }
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            TextTabs(channels.map { it.id to it.label }, channel.id, gap = 12.dp) { next ->
                route.scope = next; route.searchSource = null; route.searchType = null; route.searchByDate = false; route.searchPage = 1
                if (next != "all" && channels.first { it.id == next }.dated != true) route.searchSince = ""
            }
        }
        if (live) { RoomsBrowse(state, route, Modifier.weight(1f)); return@Column }
        if (channel.dated || channel.id == "all") Row(Modifier.padding(top = 10.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            SINCE.forEach { (value, label) -> Plain(label, 13.sp, if (since == value) Ink.text else Ink.muted, if (since == value) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.clickable { route.searchSince = value; route.searchPage = 1 }) }
        }
        val sources = when {
            channel.sources.size > 1 -> channel.sources.mapNotNull { id -> (LABELS[id] ?: facets?.sources?.get(id))?.let { id to it } }
            channel.dated -> facets?.sources.orEmpty().filterKeys { it !in channel.excluded }.toList()
            else -> emptyList()
        }
        val categories = channel.categories.filterKeys { it in facets?.categories.orEmpty() }.toList()
        if (sources.isNotEmpty() || categories.isNotEmpty() || (channel.dated && !browsing))
            Row(Modifier.padding(top = 10.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (sources.isNotEmpty()) Pick(sources.firstOrNull { it.first == source }?.second ?: "全部来源", listOf<Pair<String?, String>>(null to "全部来源") + sources) {
                    route.searchSource = it; route.searchPage = 1
                }
                if (categories.isNotEmpty()) Pick(channel.categories[category] ?: "全部类型", listOf<Pair<String?, String>>(null to "全部类型") + categories) {
                    route.searchType = it; route.searchPage = 1
                }
                if (channel.dated && !browsing) Pick(if (byDate) "按时间" else "按相关性", listOf(false to "按相关性", true to "按时间")) {
                    route.searchByDate = it; route.searchPage = 1
                }
            }
        if (query.length == 1) { Plain("再多输入一个字", 14.sp, Ink.faint, modifier = Modifier.padding(vertical = 32.dp)); return@Column }
        LazyColumn(Modifier.weight(1f), state = list) {
            currentAnswer?.takeIf { it.total > 0 }?.let { current ->
                item { Plain((if (browsing) "${current.total} 条" else (if (current.total >= 1000) "超过 1000" else "约 ${current.total}") + " 条结果") + "（${"%.2f".format(current.seconds)} 秒）" + (if (page > 1) " · 第 $page 页" else ""), 12.5.sp, Ink.faint, modifier = Modifier.padding(top = 12.dp, bottom = 2.dp)) }
            }
            items(hits, key = { it.id }) { hit -> if (hit.source in ENTITIES) EntityRow(hit) { if (hit.source == "courses") courseSheet = hit.title else open(hit.url) } else DocumentRow(hit, ::open) }
            currentAnswer?.takeIf { it.total == 0 }?.let { item { Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain(if (browsing) "这段时间没有内容" else "没有找到“$query”", 14.sp, Ink.faint) } } }
            failure?.takeIf { it.first == key }?.let { (_, message) -> item { Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain(message, 14.sp, Ink.faint) } } }
            currentAnswer?.let { current -> item { Pages(page, current.total) { route.searchPage = it } } }
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
            hit.snippet?.takeIf { hit.source != "places" && it != hit.title }?.let { Text(marked(it, hit.ranges("snippetHighlights"), SpanStyle(color = text)), style = TextStyle(fontSize = 12.5.sp, color = Ink.muted), maxLines = 1) }
        }
        Plain("›", 15.sp, Ink.faint)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun DocumentRow(hit: Hit, open: (String) -> Unit) {
    val dark = isSystemInDarkTheme()
    val titleColor = if (dark) Tokens.Color.Dark.searchLink else Tokens.Color.Light.searchLink
    val hitColor = if (dark) Tokens.Color.Dark.searchHit else Tokens.Color.Light.searchHit
    val files = hit.files
    val snippet = hit.snippet?.takeIf { value ->
        value.isNotBlank() && fileName(value) != fileName(hit.title) && files.none { fileName(it.name) == fileName(value) }
    }
    val internal = hit.url.startsWith('/')
    val source = if (internal) "StuDev" else hit.text("sourceName").orEmpty()
    val section = hit.text("section")?.takeUnless { it.isBlank() || it in FILLER_SECTIONS }
    val breadcrumb = listOfNotNull(Uri.parse(hit.url).host, section).joinToString(" › ")
    val type = fileType(hit.url).takeIf { hit.text("kind") == "file" }
    Column(Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 20.dp)) {
        Row(
            Modifier.clip(RoundedCornerShape(4.dp)).clickable { open(hit.url) },
            horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            val shortName = source.substringAfterLast('/').trim()
            val hue = shortName.codePoints().toArray().fold(0) { hue, point -> (hue * 31 + point) % 360 }
            val background = if (dark) Color.hsl(hue.toFloat(), .30f, .20f) else Color.hsl(hue.toFloat(), .60f, .94f)
            val border = if (dark) Color.hsl(hue.toFloat(), .25f, .30f) else Color.hsl(hue.toFloat(), .40f, .86f)
            val foreground = if (dark) Color.hsl(hue.toFloat(), .70f, .80f) else Color.hsl(hue.toFloat(), .55f, .34f)
            Box(Modifier.size(28.dp).background(if (internal) Ink.paper else background, CircleShape)
                .border(1.dp, if (internal) Ink.line else border, CircleShape), contentAlignment = Alignment.Center) {
                if (internal) Image(painterResource(R.drawable.ic_launcher_foreground), null, Modifier.size(22.dp))
                else Plain(shortName.codePoints().findFirst().orElse('·'.code).let { String(intArrayOf(it), 0, 1) }, 13.sp, foreground, FontWeight.SemiBold)
            }
            Column {
                Plain(source, 14.sp, maxLines = 1, lineHeight = 18.sp)
                if (breadcrumb.isNotEmpty()) Plain(breadcrumb, 12.sp, Ink.muted, maxLines = 1, lineHeight = 16.sp)
            }
        }
        Row(
            Modifier.padding(top = 6.dp, bottom = 3.dp).clickable { open(hit.url) },
            horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.Top,
        ) {
            type?.let { FileType(it, standalone = true, modifier = Modifier.padding(top = 3.dp)) }
            Plain(hit.title, 19.sp, titleColor, lineHeight = 25.sp)
        }
        val date = hit.date
        if (date != null || snippet != null) {
            val faint = Ink.faint
            val emphasis = SpanStyle(color = hitColor, fontWeight = FontWeight.SemiBold)
            val description = buildAnnotatedString {
                if (date != null) withStyle(SpanStyle(color = faint)) { append(date); if (snippet != null) append(" — ") }
                if (snippet != null) append(marked(snippet, hit.ranges("snippetHighlights"), emphasis))
            }
            Text(description, style = TextStyle(fontSize = 14.sp, lineHeight = 22.sp, color = Ink.muted), maxLines = 2,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
        if (files.isNotEmpty()) FlowRow(Modifier.padding(top = 9.dp), horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)) {
            files.take(4).forEach { file ->
                Row(Modifier.clip(CircleShape).border(1.dp, Ink.line, CircleShape).clickable { open(file.url) }
                    .heightIn(min = 32.dp).padding(horizontal = 7.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    FileType(file.type)
                    Plain(fileName(file.name), 12.5.sp, modifier = Modifier.weight(1f, fill = false), maxLines = 1)
                }
            }
            if (files.size > 4) Plain("等 ${files.size} 个附件", 12.sp, Ink.muted)
        }
    }
}

@Composable private fun FileType(type: String, standalone: Boolean = false, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(4.dp)
    val surface = if (standalone) Modifier.border(1.dp, Ink.line, shape) else Modifier.background(Ink.sunken, shape)
    Plain(type, 11.sp, Ink.muted, FontWeight.SemiBold,
        modifier.then(surface).padding(horizontal = 4.dp, vertical = 1.dp), maxLines = 1)
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
