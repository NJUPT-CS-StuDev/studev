package top.hicancan.studev.timetable

import androidx.compose.material3.Text
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*
import top.hicancan.studev.app.AcademicState
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.data.*
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.app.marks
import top.hicancan.studev.app.tone
import top.hicancan.studev.world.*
import java.time.LocalDate

/** Whoever is being looked at, unfolded along time. */
@Composable fun TimetableScreen(route: Route, model: CampusModel, state: AcademicState, settings: PersonalSettings, now: Moment, walk: suspend (String) -> top.hicancan.studev.navigation.WalkEstimate?, onEvent: (LineEvent, CampusLine) -> Unit) {
    val term = state.term
    if (settings.klass == null && route.whoType == "me") { ClassPicker(state) { model.chooseClass(it) }; return }
    if (term == null) { Box(Modifier.fillMaxSize()); return }
    val isMe = route.whoType == "me"
    var others by remember { mutableStateOf<CampusLine?>(null) }
    LaunchedEffect(route.whoType, route.whoId, state.repository) {
        others = null
        if (isMe) return@LaunchedEffect
        val repo = state.repository ?: return@LaunchedEffect
        val meetings = when (route.whoType) {
            "class" -> runCatching { repo.schedule(route.whoId).meetings }.getOrDefault(emptyList())
            "teacher" -> model.meetings().filter { row -> row.teachers.any { it.name == route.whoId } }
            "course" -> model.meetings().filter { Names.course(it.course.name) == route.whoId }
            "room" -> model.meetings().filter { it.room == route.whoId }
            else -> emptyList()
        }
        val exams = if (route.whoType == "course") runCatching { repo.allExams().filter { Names.course(it.course.name) == route.whoId } }.getOrDefault(emptyList()) else if (route.whoType == "class") runCatching { repo.exams(route.whoId) }.getOrDefault(emptyList()) else emptyList()
        val labs = when (route.whoType) {
            "class" -> runCatching { repo.labs(route.whoId) }.getOrDefault(emptyList())
            "teacher" -> runCatching { repo.allLabs().filter { route.whoId in it.teachers } }.getOrDefault(emptyList())
            "course" -> runCatching { repo.allLabs().filter { Names.course(it.course.name) == route.whoId } }.getOrDefault(emptyList())
            "room" -> runCatching { repo.allLabs().filter { it.room == route.whoId } }.getOrDefault(emptyList())
            else -> emptyList()
        }
        others = CampusLine(term, state.periods, meetings, labs, exams, state.holidays, null)
    }
    val tasks by model.tasks.all.collectAsStateWithLifecycle()
    val line = if (isMe) model.myLine(state, settings, top.hicancan.studev.me.TaskStore.live(tasks)) else others
    if (line == null) { Box(Modifier.fillMaxSize()); return }
    var previewRows by remember { mutableStateOf(emptyList<TeachingMeeting>()) }
    LaunchedEffect(route.preview) { previewRows = route.preview?.let { id -> model.meetings().filter { it.teaching_class.id == id } }.orEmpty() }
    val scale = route.scale
    // A week opened as "now" shows what is left of this one, or the next one once this is over.
    val day = route.day ?: if (scale == "week") line.weekShown(now) else now.date
    val monday = day.minusDays((day.dayOfWeek.value - 1).toLong())
    val week = line.weekOf(day)
    val ahead = if (route.day == null) CampusLine.daysBetween(now.date.minusDays(now.date.dayOfWeek.value - 1L), monday) / 7 else 0
    val classId = if (isMe) settings.klass else if (route.whoType == "class") route.whoId else null
    val recordState = examRecordOf(state, classId)
    val record = recordState.record
    val title = when {
        !isMe -> if (route.whoType == "teacher") "${route.whoId} 老师" else if (route.whoType == "room") Names.room(route.whoId) else route.whoId
        scale == "list" -> "任务"
        scale == "exam" -> "考试"
        scale == "term" -> "${term.year}–${term.year + 1} 学年"
        scale == "week" -> if (week != null) "第 $week 周" else "假期"
        else -> "${dateLabel(day)} ${WEEKDAYS[day.dayOfWeek.value]}"
    }
    val lastDay = remember(line) { line.lastLesson() }
    val pending = line.tasks.count { it.parent == null && it.done == null }
    val sub = when (scale) {
        "list" -> if (pending > 0) "$pending 件要做" else "没有要做的事"
        // Two lines, so the narrow header never breaks inside a date.
        "exam" -> line.exams.count { it.date >= now.date.toString() }.let { if (it > 0) "$it 场待考" else "暂无待考" }
        "term" -> "本学期 · " + (line.weekOf(now.date)?.let { "第 $it / ${term.weeks.size} 周" } ?: "${term.weeks.size} 周") + (lastDay?.let { " · 课上到 ${dateLabel(it)}" } ?: "")
        "week" -> (if (ahead == 1) "下周 · " else if (ahead > 1) "$ahead 周后 · " else "") + "${dateLabel(monday)} – ${dateLabel(monday.plusDays(6))}"
        else -> if (week != null) "第 $week 周" else "假期"
    }
    val order = listOf("day", "week", "term")
    var pinch by remember { mutableFloatStateOf(1f) }
    var calendar by remember { mutableStateOf(false) }
    var addingCourse by remember { mutableStateOf(false) }
    var customCourseOpen by remember { mutableStateOf(false) }
    if (calendar) CalendarSheet(state, settings, model) { calendar = false }
    if (addingCourse) PlainSheet("加课", { addingCourse = false }) {
        KeyRow(null, "从全校课表里挑一门", "查看其他班或老师的时间，点击可预览冲突后加入", chevron = true) {
            addingCourse = false; route.scope = "course"; route.query = ""; route.searchFocus = true; route.tab = "search"
        }
        KeyRow(null, "手动记一门自己的课", "教务课表里没有的任选课、实习或固定活动", chevron = true) {
            addingCourse = false; customCourseOpen = true
        }
    }
    if (customCourseOpen) CustomCourseSheet(term.weeks.size, line.periods.size, model) { customCourseOpen = false }
    Column(Modifier.fillMaxSize().pointerInput(scale) {
        detectTransformGestures { _, _, zoom, _ ->
            pinch *= zoom
            val step = if (pinch < .72f) 1 else if (pinch > 1.38f) -1 else 0
            if (step != 0) {
                if (scale in order) order.getOrNull(order.indexOf(scale) + step)?.let { route.scale = it; route.termMode = "course" }
                pinch = 1f
            }
        }
    }.statusBarsPadding().padding(horizontal = 16.dp)) {
        // A newer app is out: said once, quietly, above the timetable, until it is installed.
        state.app?.takeIf { state.appBehind }?.let { app ->
            val context = androidx.compose.ui.platform.LocalContext.current
            Row(Modifier.padding(end = 40.dp, bottom = 10.dp).clip(RoundedCornerShape(8.dp)).background(Ink.sunken).clickable {
                context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("${top.hicancan.studev.account.PLATFORM_ORIGIN}/download/")))
            }.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Plain("新版本 ${app.versionName}", 13.5.sp, weight = FontWeight.Medium)
                Plain(" · 更新 ›", 13.5.sp, Ink.brand)
            }
        }
        Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
            // The avatar has its own place beside the title. Week navigation must not squeeze the title into it.
            if (isMe) CampusHeader { Plain(title, 22.sp, weight = FontWeight.SemiBold, maxLines = 1) }
            else {
                CampusHeader { Plain("‹ 我的课表", 13.sp, Ink.muted, modifier = Modifier.clickable { route.whoType = "me"; route.whoId = ""; route.scale = "day"; route.preview = null }.padding(vertical = 10.dp)) }
                Plain(title, 22.sp, weight = FontWeight.SemiBold, maxLines = 2)
            }
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Plain(sub, 13.5.sp, Ink.muted, modifier = Modifier.weight(1f))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (scale == "week") {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(44.dp).clickable { route.day = day.minusDays(7) }.semantics { contentDescription = "上一周" }, contentAlignment = Alignment.Center) { Plain("‹", 24.sp, Ink.muted) }
                            TextAction("今天", { route.day = if (ahead > 0) now.date else null }, modifier = Modifier.heightIn(min = 44.dp), muted = true)
                            Box(Modifier.size(44.dp).clickable { route.day = day.plusDays(7) }.semantics { contentDescription = "下一周" }, contentAlignment = Alignment.Center) { Plain("›", 24.sp, Ink.muted) }
                        }
                    }
                    if (isMe) Chip(if (scale == "week") "+" else "加课", { addingCourse = true })
                    if (isMe && scale != "week") Chip("日历", { calendar = true })
                }
            }
        }
        // The list is one's own: tasks by when they are due, exams among them.
        TextTabs(listOf("day" to "天", "week" to "周", "term" to "学期", "exam" to "考试") + if (isMe) listOf("list" to "任务") else emptyList(), scale, separateBefore = "list") { route.scale = it; route.termMode = "course" }
        Spacer(Modifier.height(16.dp))
        Box(Modifier.weight(1f)) {
            when (scale) {
                "list" -> TaskList(line, now, model.tasks, model.settings) { onEvent(it, line) }
                "week" -> WeekView(line, day, now, record, previewRows, settings.layers) { onEvent(it, line) }
                "term", "exam" -> TermView(line, state, model, now, isMe, recordState, state.classes.firstOrNull { it.id == classId }?.practice.orEmpty(), settings, route, scale == "exam", { route.day = it; route.scale = "week" }) { onEvent(it, line) }
                else -> DayView(line, day, now, isMe, record, route, walk, settings.layers, model.tasks) { onEvent(it, line) }
            }
            if (route.preview != null && previewRows.isNotEmpty()) PreviewDock(previewRows, line.meetings, week, settings.timetableEdits(term.term).added.contains(route.preview), Modifier.align(Alignment.BottomCenter),
                onCancel = { route.preview = null },
                onAdd = { model.addTeachingClass(route.preview!!); route.preview = null })
        }
    }
}

/** How a class's exams came to be: loaded once per class, for every view and sheet that shows an exam. */
data class ExamRecordState(val record: ExamRecord?, val failed: Boolean, val retry: () -> Unit)
@Composable fun examRecordOf(state: AcademicState, classId: String?): ExamRecordState {
    var attempt by remember(classId, state.repository) { mutableIntStateOf(0) }
    var failed by remember(classId, state.repository) { mutableStateOf(false) }
    val record by produceState<ExamRecord?>(null, classId, state.repository, attempt) {
        value = null; failed = false
        try { value = classId?.let { id -> state.repository?.examRecord(id) } }
        catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (_: Exception) { failed = true }
    }
    return ExamRecordState(record, failed) { attempt++ }
}

@Composable private fun ClassPicker(state: AcademicState, onPick: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    val hits = remember(query, state.classes) {
        val needle = query.trim().uppercase()
        if (needle.isEmpty()) emptyList() else state.classes.filter { "${it.name} ${it.major.orEmpty()}".uppercase().contains(needle) }.take(30)
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp).padding(top = 38.dp)) {
        Plain("你在哪个班？", 26.sp, weight = FontWeight.SemiBold)
        Plain("输入班号或专业，课表、考试和校历就都有了。", 14.sp, Ink.muted, modifier = Modifier.padding(top = 4.dp, bottom = 20.dp))
        SearchField(query, "比如 B240402", Modifier.testTag("class-query")) { query = it }
        LazyColumn(Modifier.padding(top = 8.dp)) {
            items(hits, key = { it.id }) { item ->
                Column(Modifier.fillMaxWidth().topHairline(Ink.line).clickable { onPick(item.id) }.padding(vertical = 10.dp)) {
                    Plain(item.name, 15.sp, weight = FontWeight.Medium)
                    Plain(listOfNotNull(item.major, item.campus, item.students?.let { "$it 人" }).joinToString(" · "), 12.5.sp, Ink.muted)
                }
            }
        }
    }
}

@Composable fun SearchField(value: String, hint: String, modifier: Modifier = Modifier, height: Dp = Tokens.Size.target.dp, onChange: (String) -> Unit) {
    val shape = RoundedCornerShape(Tokens.Radius.pill.dp)
    Row(modifier.fillMaxWidth().height(height).clip(shape).background(Ink.sunken).border(1.dp, Ink.line, shape).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.Outlined.Search, null, Modifier.size(16.dp), tint = Ink.muted)
        BasicTextField(value, onChange, Modifier.weight(1f), singleLine = true, textStyle = TextStyle(fontSize = 15.sp, color = Ink.text), cursorBrush = androidx.compose.ui.graphics.SolidColor(Ink.brand), decorationBox = { inner ->
            if (value.isEmpty()) Plain(hint, 14.5.sp, Ink.faint, maxLines = 1)
            inner()
        })
    }
}

/** One thing on the line; what lies behind it shows beside it, so it needs no count of its own. */
@Composable private fun Tile(event: LineEvent, toneIndex: Int?, past: Boolean, modifier: Modifier, big: Boolean, changed: Boolean = false, topInset: Dp = 0.dp, onClick: () -> Unit) {
    val mark = marks()
    val tones = toneIndex?.let { tone(it) }
    val paper = Ink.paper
    fun faded(color: Color, amount: Float) = if (past) Color(color.red + (paper.red - color.red) * amount, color.green + (paper.green - color.green) * amount, color.blue + (paper.blue - color.blue) * amount) else color
    val done = event.task?.done != null
    val bg = when (event.kind) { "exam" -> mark.exam; "run", "task" -> paper; else -> faded(tones?.bg ?: Ink.sunken, .25f) }
    val fg = when (event.kind) { "exam" -> mark.onExam; "run" -> Ink.muted; "task" -> if (done) Ink.faint else Ink.text; else -> tones?.fg ?: Ink.text }
    val border = when (event.kind) { "exam" -> mark.exam; "run" -> Ink.line; "task" -> if (done) Ink.line else Ink.brand; else -> faded(tones?.border ?: Ink.line, .35f) }
    Box(modifier) {
        val lab = event.lab
        val note = if (big) "${hm(event.start)}–${hm(event.end)}${if (lab != null) " · ${lab.project}" else ""}${if (event.room != null) " · ${Names.room(event.room)}" else ""}"
            else if (lab != null) lab.room?.let(Names::roomShort) ?: Names.compactPlace(lab.short) else Names.roomShort(event.room)
        TileBox(if (big) event.name else event.short, if (event.task != null) (if (big) "${hm(event.start)}–${hm(event.end)}" else "") else note, bg, border, fg, Modifier.fillMaxSize(), big, onClick, strong = lab != null || event.task != null, topInset = topInset)
        if (changed) Box(Modifier.align(Alignment.TopEnd).padding(3.dp).clip(RoundedCornerShape(3.dp)).background(paper).padding(horizontal = 3.dp)) { Plain("改", 10.sp, mark.warning, FontWeight.SemiBold) }
    }
}
@Composable private fun TileBox(name: String, note: String, bg: Color, border: Color, fg: Color, modifier: Modifier, big: Boolean, onClick: (() -> Unit)?, strong: Boolean = false, topInset: Dp = 0.dp) {
    // A day reads as an agenda, as on the web: left-aligned on the course's tint with its bar at the edge; a tile on
    // the paper (a task, 早锻炼) keeps its outline, having no tint to stand on.
    if (big) {
        val shape = RoundedCornerShape(10.dp)
        val tinted = bg != Ink.paper
        var base = modifier.clip(shape).background(bg)
        if (!tinted || strong) base = base.border(if (strong) 2.dp else 1.dp, border, shape)
        Row(if (onClick != null) base.clickable(onClick = onClick) else base) {
            if (tinted) Box(Modifier.width(4.dp).fillMaxHeight().background(fg.copy(alpha = .6f)))
            Column(Modifier.fillMaxSize().padding(start = if (tinted) 16.dp else 14.dp, end = 12.dp, top = 6.dp, bottom = 6.dp), verticalArrangement = Arrangement.Center) {
                Text(name, color = fg, style = TextStyle(fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, lineHeight = 19.sp), maxLines = 2)
                if (note.isNotEmpty()) Text(note, color = fg, style = TextStyle(fontSize = 12.5.sp, lineHeight = 17.sp), maxLines = 2)
            }
        }
        return
    }
    val base = modifier.clip(RoundedCornerShape(8.dp)).background(bg).border(if (strong) 2.dp else 1.dp, border, RoundedCornerShape(8.dp))
    Column((if (onClick != null) base.clickable(onClick = onClick) else base).padding(start = 2.dp, end = 2.dp, top = maxOf(3.dp, topInset), bottom = 3.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = if (topInset > 0.dp) Arrangement.Top else Arrangement.Center) {
        Text(name, color = fg, textAlign = TextAlign.Center, style = TextStyle(fontSize = if (big) 14.5.sp else 11.sp, fontWeight = FontWeight.SemiBold, lineHeight = if (big) 19.sp else 14.sp))
        if (note.isNotEmpty()) Text(note, color = fg, textAlign = TextAlign.Center, style = TextStyle(fontSize = if (big) 12.5.sp else 10.sp, lineHeight = if (big) 17.sp else 13.sp))
    }
}

private fun goneSummary(events: List<LineEvent>): String {
    val counts = LinkedHashMap<String, Int>()
    for (event in events) counts[event.short] = (counts[event.short] ?: 0) + 1
    return counts.entries.joinToString("、") { (name, count) -> if (count > 1) "$name（$count 节）" else name }
}

@Composable private fun DayView(line: CampusLine, day: LocalDate, now: Moment, isMe: Boolean, record: ExamRecord?, route: Route, walk: suspend (String) -> top.hicancan.studev.navigation.WalkEstimate?, order: List<String>, store: top.hicancan.studev.me.TaskStore, onOpen: (LineEvent) -> Unit) {
    val today = day == now.date
    val events = remember(line, day) { line.on(day) }
    val tones = remember(line) { TimetablePresentation.tones(line) }
    val monday = day.minusDays((day.dayOfWeek.value - 1).toLong())
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        if (isMe && today) NextBlock(line, now, route, walk)
        Row(Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
            (0L until 7L).forEach { offset ->
                val date = monday.plusDays(offset)
                val hasExam = line.exams.any { it.date == date.toString() }
                val on = date == day
                Column(Modifier.weight(1f).height(48.dp).clip(RoundedCornerShape(8.dp)).background(if (on) Ink.sunken else Color.Transparent).clickable { route.day = if (date == now.date) null else date },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Plain(WEEKDAYS[date.dayOfWeek.value].drop(1), 11.5.sp, Ink.faint)
                    Plain(date.dayOfMonth.toString(), 15.sp, if (date == now.date) Ink.brand else Ink.text, if (date == now.date) FontWeight.SemiBold else FontWeight.Medium)
                    if (hasExam) Box(Modifier.size(4.dp).clip(RoundedCornerShape(2.dp)).background(marks().exam))
                }
            }
        }
        // What is due by the end of the day, with no time of its own, is listed above the day's hours.
        val due = line.dueOn(day)
        if (due.isNotEmpty()) {
            Plain((if (day == now.date) "今天" else dateLabel(day)) + "截止", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp))
            due.forEach { task ->
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TaskCheck(task, store)
                    Plain(task.title, 15.sp, if (task.done != null) Ink.faint else Ink.text, maxLines = 1, modifier = Modifier.weight(1f).clickable { onOpen(taskEvent(task, day)) })
                    Plain(task.due?.time?.let(::hm) ?: "当天结束", 12.sp, Ink.muted)
                }
            }
            Spacer(Modifier.height(10.dp))
        }
        if (events.isEmpty()) { if (due.isEmpty()) Empty(line.holidays[day] ?: "这一天没有安排"); return@Column }
        val fold = today && isMe
        val gone = if (fold) events.filter { it.end <= now.min } else emptyList()
        val live = if (fold) events.filter { it.end > now.min } else events
        if (gone.isNotEmpty()) Plain("已结束 ${gone.size} 项 · ${goneSummary(gone)}", 13.sp, Ink.faint, maxLines = 1, modifier = Modifier.padding(bottom = 12.dp))
        if (live.isEmpty()) { Empty("今天的课都上完了"); return@Column }
        // The campus day opens with the first period. Before that nobody looks for a room, and the column does not
        // stretch back to midnight: "now" joins it only within the hour before the day's first thing.
        val opens = clock(line.periods.first().start)
        val awake = fold && now.min >= minOf(opens, live.first().start) - 60
        val free = maxOf(now.min, opens)
        val from = (if (awake) minOf(now.min, live.first().start) else live.first().start) - 14
        val to = maxOf(live.maxOf { it.end } + 24, if (awake) now.min + 20 else 0)
        fun y(minutes: Int): Dp = (minutes - from).dp
        val mark = marks()
        val hairline = Ink.line
        Box(Modifier.fillMaxWidth().height(y(to))) {
            var hour = (from / 60 + 1) * 60
            while (hour <= to) {
                val at = hour
                if (!(awake && kotlin.math.abs(at - now.min) < 16)) Plain("${at / 60}:00", 11.5.sp, Ink.faint, modifier = Modifier.offset(y = y(at) - 8.dp).width(36.dp))
                Box(Modifier.padding(start = 44.dp).fillMaxWidth().height(1.dp).offset(y = y(at)).background(hairline))
                hour += 60
            }
            @Composable fun gap(start: Int, end: Int, leadNow: Boolean = false) = Plain("${if (leadNow) "现在有空" else "空 ${durationText(end - start)}"} · 看这时的空教室 ›", 12.5.sp, Ink.muted, modifier = Modifier.padding(start = 54.dp).offset(y = y((start + end) / 2) - 9.dp).clickable { route.rooms(day to start) })
            if (awake && live.first().start - free >= 45) gap(free, live.first().start, leadNow = free == now.min)
            // Everything on, at its own time, back to front: what is behind shows beside what is in front.
            CampusLine.layers(live, order).forEach { (event, under) ->
                Tile(event, TimetablePresentation.toneOf(event, tones, line.courseMeetings), false, Modifier.padding(start = 44.dp, end = (under * 8).dp).fillMaxWidth().offset(y = y(event.start) + 1.dp).height(maxOf(40.dp, y(event.end) - y(event.start) - 2.dp)), true,
                    event.exam?.let { Exams.wasChanged(record, it) } == true) { onOpen(event) }
            }
            // Free time is between runs of things that overlap, not between any two of them.
            val runs = CampusLine.clusters(live, order)
            runs.forEachIndexed { index, run ->
                val next = runs.getOrNull(index + 1)
                val start = maxOf(if (today) maxOf(run.end, now.min) else run.end, opens)
                if (next != null && next.start - start >= 30 && next.start - run.end >= 45) gap(start, next.start)
            }
            if (awake) {
                Box(Modifier.padding(start = 44.dp).fillMaxWidth().height(1.5.dp).offset(y = y(now.min)).background(mark.now))
                Plain(hm(now.min), 11.5.sp, mark.now, FontWeight.SemiBold, modifier = Modifier.offset(y = y(now.min) - 8.dp).width(40.dp))
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable private fun NextBlock(line: CampusLine, now: Moment, route: Route, walk: suspend (String) -> top.hicancan.studev.navigation.WalkEstimate?) {
    val event = remember(line, now) { line.next(now) } ?: return
    var walking by remember(event.id, event.room) { mutableStateOf<top.hicancan.studev.navigation.WalkEstimate?>(null) }
    LaunchedEffect(event.id, event.room, now.min) { if (Names.placed(event.room)) walking = walk(event.room!!) }
    val today = event.date == now.date
    val during = today && event.start <= now.min
    val caption = when {
        during -> "进行中，至 ${hm(event.end)}"
        today -> "下一项 · 还有 ${durationText(event.start - now.min)}"
        CampusLine.daysBetween(now.date, event.date) == 1 -> "下一项 · 明天"
        else -> "下一项 · ${dateLabel(event.date)}"
    }
    val exam = line.examDays(now.date).firstOrNull()
    val mark = marks()
    Row(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f)) {
            Plain(caption, 12.5.sp, Ink.muted)
            Plain("${hm(event.start)} ${event.name}", 19.sp, weight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 2.dp))
            Plain((if (event.room != null) Names.room(event.room) else "课表没写地点") + (walking?.takeIf { !during }?.let { " · 步行${top.hicancan.studev.map.Routing.duration(it.seconds)}到${it.arrival}" } ?: ""), 13.5.sp, Ink.muted)
            if (exam != null) Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                SmallTag("考试", mark.exam, mark.onExam)
                val days = exam.second
                Plain("${if (days == 0) "今天" else if (days == 1) "明天" else "$days 天后"} " + exam.third.joinToString("、") { "${Names.course(it.course.name)} ${it.start}" }, 13.sp, maxLines = 1)
            }
        }
        if (Names.placed(event.room)) ActionButton("去这里", go = true) { route.map(nav = event.room) }
    }
    HorizontalDivider(color = Ink.line, modifier = Modifier.padding(bottom = 18.dp))
}

@Composable private fun Empty(text: String) = Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain(text, 14.sp, Ink.faint) }


@Composable private fun WeekView(line: CampusLine, day: LocalDate, now: Moment, record: ExamRecord?, ghosts: List<TeachingMeeting>, order: List<String>, onOpen: (LineEvent) -> Unit) {
    val monday = day.minusDays((day.dayOfWeek.value - 1).toLong())
    val days = remember(monday) { (0L until 7L).map { monday.plusDays(it) } }
    val week = line.weekOf(monday)
    val events = remember(line, monday) { days.map(line::on) }
    val lineTones = remember(line) { TimetablePresentation.tones(line) }
    val hints = remember(line, week) { if (week != null) TimetablePresentation.offWeekLessons(line.meetings, week) else emptyList() }
    val shownGhosts = if (week != null) ghosts.filter { week in it.weeks } else emptyList()
    var columns = 5
    days.forEachIndexed { index, date -> if (events[index].isNotEmpty() || line.dueOn(date).isNotEmpty() || hints.any { it.day == index + 1 } || shownGhosts.any { it.weekday == index + 1 }) columns = maxOf(columns, index + 1) }
    val period = remember(line) { line.periods.associate { it.period to (clock(it.start) to clock(it.end)) } }
    val (from, until) = CampusLine.timeBounds(events.flatten())
    fun y(minutes: Int): Dp = ((minutes - from) * .72f).dp
    val mark = marks()
    val hairline = Ink.line
    val soft = hairline.copy(alpha = .65f)
    val paper = Ink.paper
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Column(Modifier.fillMaxWidth().border(1.dp, hairline, RoundedCornerShape(8.dp)).clip(RoundedCornerShape(8.dp))) {
            // The weekend a shade apart, as calendars set it.
            val weekend = Ink.sunken.copy(alpha = .55f)
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).bottomHairline(hairline)) {
                Spacer(Modifier.width(38.dp))
                days.take(columns).forEachIndexed { index, date ->
                    Column(Modifier.weight(1f).fillMaxHeight().background(if (index >= 5) weekend else Color.Transparent).padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        val color = if (date == now.date) Ink.brand else Ink.text
                        Plain(WEEKDAYS[index + 1], 12.sp, color, FontWeight.SemiBold)
                        Plain(line.holidays[date] ?: "${date.monthValue}/${date.dayOfMonth}", 11.sp, if (date == now.date) Ink.brand else Ink.muted, maxLines = 1)
                    }
                }
            }
            // Tasks due by the end of a day, with no time of their own, sit in a row under the day they are due.
            val dues = days.take(columns).map(line::dueOn)
            if (dues.any { it.isNotEmpty() }) Row(Modifier.fillMaxWidth().bottomHairline(hairline).padding(vertical = 3.dp)) {
                Box(Modifier.width(38.dp), contentAlignment = Alignment.Center) { Plain("截止", 10.sp, Ink.muted) }
                dues.forEachIndexed { index, list ->
                    Column(Modifier.weight(1f).padding(horizontal = 2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        list.take(3).forEach { task -> Plain(task.title, 10.sp, if (task.done != null) Ink.faint else Ink.text, maxLines = 1,
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)).background(Ink.brand.copy(alpha = .09f)).clickable { onOpen(taskEvent(task, days[index])) }.padding(horizontal = 3.dp, vertical = 1.dp)) }
                        if (list.size > 3) Plain("+${list.size - 3}", 9.5.sp, Ink.muted)
                    }
                }
            }
            Row(Modifier.fillMaxWidth().height(y(until))) {
                Box(Modifier.width(38.dp).fillMaxHeight().drawBehind { drawLine(hairline, Offset(size.width, 0f), Offset(size.width, size.height), 1f) }) {
                    // The period, with its start and end beneath, as the school's own timetable shows it.
                    line.periods.forEach { item ->
                        val (start, end) = period.getValue(item.period)
                        Column(Modifier.fillMaxWidth().height(y(end) - y(start)).offset(y = y(start)), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            Plain(item.period.toString(), 11.sp, Ink.muted, FontWeight.SemiBold, lineHeight = 12.sp)
                            Plain(item.start, 8.5.sp, Ink.faint, lineHeight = 10.sp)
                            Plain(item.end, 8.5.sp, Ink.faint, lineHeight = 10.sp)
                        }
                    }
                    if (now.date in days) Box(Modifier.fillMaxWidth().height(18.dp).offset(y = y(now.min) - 9.dp).background(paper), contentAlignment = Alignment.Center) { Plain(hm(now.min), 10.sp, mark.now, FontWeight.SemiBold) }
                }
                days.take(columns).forEachIndexed { index, date ->
                    val off = date in line.holidays
                    BoxWithConstraints(Modifier.weight(1f).fillMaxHeight().drawBehind {
                        if (!off && index >= 5) drawRect(weekend)
                        if (off) { var x = -size.height; while (x < size.width) { drawLine(soft, Offset(x, size.height), Offset(x + size.height, 0f), 1f); x += 16.dp.toPx() } }
                    }) {
                        val width = maxWidth
                        line.periods.forEach { item -> Box(Modifier.fillMaxWidth().height(1.dp).offset(y = y(period.getValue(item.period).first)).background(soft)) }
                        // A lesson off this week keeps its place in grey, not its course's colour, only where nothing is on that week.
                        hints.filter { hint -> hint.day == index + 1 && !off }.forEach { hint ->
                            val start = period[hint.periods.first()]?.first ?: return@forEach
                            val end = period[hint.periods.last()]?.second ?: return@forEach
                            if (events[index].any { it.start < end && start < it.end }) return@forEach
                            val event = line.meetingAround(hint.id, monday)
                            TileBox(event?.takeIf { it.name != Names.course(hint.course) }?.name ?: Names.courseShort(hint.course), hint.label, Ink.sunken, Ink.line, Ink.faint,
                                Modifier.padding(horizontal = 2.dp).fillMaxWidth().offset(y = y(start) + 1.dp).height(y(end) - y(start) - 2.dp), false, event?.let { found -> { onOpen(found) } })
                        }
                        // Everything on, at its own time, back to front: what is behind shows beside what is in front.
                        val layered = CampusLine.layers(events[index], order)
                        layered.forEachIndexed { idx, (event, under) ->
                            val past = event.kind != "exam" && (date < now.date || (date == now.date && event.end <= now.min))
                            val coverEnd = layered.drop(idx + 1).filter { (upper, _) -> upper.date == event.date && upper.start <= event.start + 12 && upper.end < event.end - 16 }.maxOfOrNull { it.event.end } ?: 0
                            val pushDown = if (coverEnd > event.start) y(coverEnd) - y(event.start) + 4.dp else 0.dp
                            Tile(event, TimetablePresentation.toneOf(event, lineTones, line.courseMeetings), past, Modifier.padding(start = 2.dp, end = (2 + under * 5).dp).fillMaxWidth().offset(y = y(event.start) + 1.dp).height(maxOf(22.dp, y(event.end) - y(event.start) - 2.dp)), false,
                                event.exam?.let { Exams.wasChanged(record, it) } == true, pushDown) { onOpen(event) }
                        }
                        shownGhosts.filter { it.weekday == index + 1 }.forEach { meeting ->
                            val start = period.getValue(meeting.periods.first()).first
                            val end = period.getValue(meeting.periods.last()).second
                            val busy = events[index].any { it.start < end && start < it.end }
                            val color = if (busy) mark.danger else mark.free
                            TileBox(Names.courseShort(meeting.course.name), if (busy) "" else Names.roomShort(meeting.room), color.copy(alpha = .09f), color, color,
                                Modifier.padding(start = if (busy) width * .46f else 2.dp, end = 2.dp).fillMaxWidth().offset(y = y(start) + 1.dp).height(y(end) - y(start) - 2.dp), false, null)
                        }
                        if (date == now.date) {
                            Box(Modifier.fillMaxWidth().height(1.5.dp).offset(y = y(now.min)).background(mark.now))
                            Box(Modifier.size(8.dp).offset(x = (-1).dp, y = y(now.min) - 3.dp).clip(RoundedCornerShape(4.dp)).background(mark.now))
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(if (ghosts.isNotEmpty()) 90.dp else 24.dp))
    }
}

/** Colour swatch of the legend, drawn the way its cell is. */
@Composable private fun Swatch(fill: Color, edge: Color?, label: String, letter: String? = null, letterColor: Color = Ink.text, edgeWidth: Dp = 1.dp) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(12.dp).clip(RoundedCornerShape(3.dp)).background(fill).then(if (edge != null) Modifier.border(edgeWidth, edge, RoundedCornerShape(3.dp)) else Modifier), contentAlignment = Alignment.Center) {
            if (letter != null) Plain(letter, 10.sp, letterColor, FontWeight.Bold)
        }
        Plain(label, 12.sp, Ink.muted, modifier = Modifier.padding(start = 5.dp))
    }
}

/** A term calendar or the exam list, reached from their respective timetable tabs. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable private fun TermView(line: CampusLine, state: AcademicState, model: CampusModel, now: Moment, isMe: Boolean, recordState: ExamRecordState, practice: List<Practice>, settings: PersonalSettings, route: Route, examPage: Boolean, onPick: (LocalDate) -> Unit, onOpen: (LineEvent) -> Unit) {
    val record = recordState.record
    val mark = marks()
    val hairline = Ink.line
    val calendar = state.calendar.firstOrNull { it.start == line.term.weeks.firstOrNull()?.start }
    val plan = line.run.takeIf { isMe }
    val runnable = remember(plan, line) { plan?.let { CampusLine.runDates(it.rule, line.holidays).toSet() }.orEmpty() }
    val changes = record?.changes.orEmpty()
    val latest = record?.history?.lastOrNull { version -> changes.any { it.version == version.id } }?.id
    val seenIndex = record?.history?.indexOfFirst { it.id == settings.examsSeen } ?: -1
    val ahead = remember(line, now.date) { line.examDays(now.date) }
    val taken = line.exams.filter { it.date < now.date.toString() }.sortedWith(compareByDescending<Exam> { it.date }.thenByDescending { it.start })
    val hasExams = line.exams.isNotEmpty() || record?.history?.isNotEmpty() == true || recordState.failed
    // The academic year's two terms: this one, and the other one of the same year (the next, or the one gone by).
    val ordered = state.calendar.sortedBy { it.start }
    val termAt = calendar?.let { ordered.indexOf(it) } ?: -1
    val nextTerm = ordered.getOrNull(termAt + 1).takeIf { termAt >= 0 }
    val otherTerm = calendar?.let { if (it.number == 1) nextTerm?.takeIf { next -> next.number == 2 } else ordered.getOrNull(termAt - 1)?.takeIf { previous -> previous.number == 1 } }
    val holidays = (calendar?.holidays.orEmpty() + otherTerm?.holidays.orEmpty() + (nextTerm?.takeIf { it != otherTerm }?.holidays.orEmpty())).distinct()
    val mode = when { route.termMode == "run" && plan != null -> "run"; route.termMode == "other" && otherTerm != null -> "other"; else -> "course" }
    val run = plan.takeIf { mode == "run" }
    LaunchedEffect(latest, examPage, settings.examsSeen, isMe) {
        // Someone arriving for the first time has nothing new to be told about.
        if (isMe && latest != null && settings.examsSeen != latest && (examPage || seenIndex < 0)) model.settings.update { it.copy(examsSeen = latest) }
    }
    val fresh = isMe && latest != null && seenIndex >= 0 && latest != settings.examsSeen && !examPage
    val termStart = LocalDate.parse(line.term.weeks.first().start)
    val termEnd = LocalDate.parse(calendar?.end ?: line.term.weeks.last().end)
    val last = remember(line) { line.lastLesson() }
    val courses = line.exams.map { it.course.code ?: it.course.name }.distinct().size
    val offGrid = practice.distinctBy { it.name to it.weeks }.sortedWith(compareBy({ it.weeks.first() }, { it.name }))
    var takenOpen by remember { mutableStateOf(false) }
    var skippedOpen by remember { mutableStateOf(false) }
    // What one has taken away stays listed, greyed; exams of courses not on one's timetable can be taken away at once.
    val skipped = if (isMe) model.skippedExams(state).sortedWith(compareBy({ it.date }, { it.start })) else emptyList()
    val outside = if (isMe) ExamAttendance.outside(line.exams, line.meetings.mapNotNull { it.course.code }.toSet()) else emptyList()
    fun lead(days: Int) = when (days) { 0 -> "今天"; 1 -> "明天"; else -> "$days 天后" }
    fun dayHead(date: LocalDate) = "${dateLabel(date)} ${WEEKDAYS[date.dayOfWeek.value]}"
    fun placeOf(exam: Exam) = exam.room?.let(Names::room) ?: exam.location
    fun eventOf(exam: Exam) = line.on(LocalDate.parse(exam.date)).firstOrNull { it.exam?.id == exam.id }
    @Composable fun examRow(exam: Exam, lead: String) =
        AheadRow(lead, Names.course(exam.course.name) + if (Exams.wasChanged(record, exam)) " · 改过" else "", (if (lead == exam.start) "到 ${exam.end}" else "${exam.start}–${exam.end}") + " · ${placeOf(exam)}") { eventOf(exam)?.let(onOpen) }
    // What each day is, decided once: an exam outranks a lesson, being rarer and mattering more.
    val dates = remember(line) { line.term.weeks.flatMap { week -> (0L until 7L).map { LocalDate.parse(week.start).plusDays(it) } } }
    val states = remember(line, now, mode) {
        dates.associateWith { date ->
            val past = date < now.date
            when {
                date < termStart || date > termEnd -> "out"
                run != null -> if (date !in runnable) "none" else if (date.toString() in run.days) (if (CampusLine.runGone(run.rule, date, now)) "rdone" else "rplan") else if (past) "rgone" else "ropen"
                else -> {
                    val events = line.on(date)
                    when {
                        // The term is shown whole: what has gone by looks the same as what is to come.
                        events.any { it.kind == "exam" } -> "exam"
                        date in line.holidays -> "hol"
                        events.any { it.kind == "class" || it.kind == "lab" } -> "has"
                        else -> ""
                    }
                }
            }
        }
    }
    val present = states.values.toSet() + (if (now.date in states) setOf("today") else emptySet())
    // The year's two terms in the calendar's order, this one marked; 早锻炼 is a switch on this term's grid, not a page.
    val yearTabs = listOfNotNull(calendar, otherTerm).sortedBy { it.number }.map { item -> (if (item == calendar) "course" else "other") to (termName(item.number) + if (item == calendar) " · 本学期" else "") }
    // The pages sit above the list, so the list never starts scrolled past them while they appear.
    Column(Modifier.fillMaxSize()) {
    if (!examPage) Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (yearTabs.size > 1) Choice(yearTabs, if (mode == "other") "other" else "course") { route.termMode = it }
        Spacer(Modifier.weight(1f))
        if (plan != null && mode != "other") ActionButton(if (mode == "run") "完成" else "排早锻炼", go = mode == "run") { route.termMode = if (mode == "run") "course" else "run" }
    }
    LazyColumn(Modifier.fillMaxSize()) {
        if (!examPage && mode == "other" && otherTerm != null) {
            item { OtherTerm(otherTerm, line.term.year, holidays, now.date) }
            return@LazyColumn
        }
        if (examPage) {
            // The first thing to know: how soon, and what.
            item {
                Column(Modifier.padding(top = 4.dp, bottom = 14.dp)) {
                    val first = ahead.firstOrNull()
                    Plain(if (first != null) "${lead(first.second)}考试" else "暂未查到待考安排", 22.sp, weight = FontWeight.SemiBold)
                    if (first != null) Plain(first.third.joinToString("、") { Names.courseShort(it.course.name) }, 14.sp, Ink.muted, modifier = Modifier.padding(top = 2.dp))
                }
            }
            ahead.forEachIndexed { at, (date, _, exams) ->
                item {
                    Row(Modifier.fillMaxWidth().topHairline(hairline).padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        val next = at == 0
                        Column(Modifier.width(52.dp).clip(RoundedCornerShape(10.dp)).background(if (next) mark.exam else Color.Transparent)
                            .then(if (next) Modifier else Modifier.border(1.5.dp, mark.exam, RoundedCornerShape(10.dp))).padding(vertical = 5.dp),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            val ink = if (next) mark.onExam else Ink.text
                            Plain("${date.monthValue}月", 11.sp, ink)
                            Plain("${date.dayOfMonth}", 22.sp, ink, FontWeight.SemiBold)
                            Plain(WEEKDAYS[date.dayOfWeek.value], 11.sp, ink)
                        }
                        Column(Modifier.weight(1f)) {
                            exams.forEachIndexed { index, exam ->
                                Row(Modifier.fillMaxWidth().then(if (index > 0) Modifier.topHairline(hairline) else Modifier).clickable { eventOf(exam)?.let(onOpen) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Plain(Names.course(exam.course.name), 16.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f, fill = false))
                                            if (Exams.wasChanged(record, exam)) Plain("改过", 11.5.sp, mark.warning, FontWeight.Medium, modifier = Modifier.padding(start = 8.dp))
                                        }
                                        Plain("${exam.start}–${exam.end} · ${placeOf(exam)}", 13.sp, Ink.muted, modifier = Modifier.padding(top = 2.dp))
                                    }
                                    Plain("›", 16.sp, Ink.faint)
                                }
                            }
                        }
                    }
                }
            }
            if (outside.isNotEmpty()) item {
                Box(Modifier.padding(vertical = 12.dp)) { ActionButton("去掉课表里没有的课的考试（${outside.size}）") { model.examChoices(outside.associate { it.id to false }) } }
            }
            if (taken.isNotEmpty()) item {
                Column(Modifier.fillMaxWidth().topHairline(hairline).clickable { takenOpen = !takenOpen }.padding(vertical = 11.dp)) { Plain("已考 ${taken.size} 场", 13.5.sp, Ink.muted) }
                if (takenOpen) taken.forEach { examRow(it, dateLabel(LocalDate.parse(it.date))) }
            }
            // Taken away: out of the way, folded at the bottom, each one a tap from coming back.
            if (skipped.isNotEmpty()) item {
                Column(Modifier.fillMaxWidth().topHairline(hairline).clickable { skippedOpen = !skippedOpen }.padding(vertical = 11.dp)) { Plain("已去掉 ${skipped.size} 场 · 不提醒", 13.5.sp, Ink.muted) }
                if (skippedOpen) {
                    Box(Modifier.padding(bottom = 6.dp)) { ActionButton("全部恢复") { model.examChoices(skipped.associate { it.id to true }) } }
                    skipped.forEach { exam ->
                        Row(Modifier.fillMaxWidth().topHairline(hairline).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Plain(dateLabel(LocalDate.parse(exam.date)), 13.sp, Ink.faint, modifier = Modifier.width(52.dp))
                            Column(Modifier.weight(1f)) {
                                Plain(Names.course(exam.course.name), 15.sp, Ink.faint, maxLines = 1)
                                Plain("${exam.start}–${exam.end} · ${placeOf(exam)}", 12.5.sp, Ink.faint)
                            }
                            TextAction("恢复", onClick = { model.examAttendance(exam.id, true) })
                        }
                    }
                }
            }
            if (record != null) item { ExamRecordView(record) }
            if (recordState.failed) item { Column(Modifier.padding(vertical = 24.dp)) { Plain("更新记录暂时无法加载", 13.sp, Ink.muted); TextAction("重试", onClick = recordState.retry) } }
            return@LazyColumn
        }
        item {
            if (run != null) RunPanel(run, line, now, model)
            Row { Spacer(Modifier.width(28.dp)); WEEKDAYS.drop(1).forEach { Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { Plain(it.drop(1), 11.5.sp, Ink.faint) } } }
            line.term.weeks.forEach { week ->
                val current = week.start <= now.date.toString() && now.date.toString() <= week.end
                Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.width(28.dp), verticalAlignment = Alignment.CenterVertically) {
                        Plain(week.week.toString(), 11.5.sp, if (current) Ink.brand else Ink.faint, if (current) FontWeight.SemiBold else FontWeight.Normal)
                    }
                    (0L until 7L).forEach { offset ->
                        val date = LocalDate.parse(week.start).plusDays(offset)
                        val cell = states[date].orEmpty()
                        val today = date == now.date
                        if (cell == "out") Spacer(Modifier.weight(1f).height(30.dp))
                        else if (run != null) RunCell(date, run, date in runnable, now, model, Modifier.weight(1f))
                        else {
                            val shape = RoundedCornerShape(4.dp)
                            val fill = when (cell) { "exam" -> mark.exam; "has" -> Ink.sunken; else -> Color.Transparent }
                            val ink = when (cell) { "exam" -> mark.onExam; "" -> Ink.faint; "hol" -> mark.holiday; else -> Ink.text }
                            Box(Modifier.weight(1f).height(30.dp).padding(horizontal = 1.5.dp).clip(shape).background(fill)
                                .then(if (today) Modifier.border(2.dp, mark.now, shape) else Modifier)
                                .clickable { line.on(date).singleOrNull { it.kind == "exam" }?.let(onOpen) ?: onPick(date) },
                                contentAlignment = Alignment.Center) { Plain(dayLabel(date), 12.sp, ink, if (cell == "exam" || cell == "hol") FontWeight.SemiBold else FontWeight.Normal) }
                        }
                    }
                }
                if (mode == "course" && last != null && week.start <= last.toString() && last.toString() <= week.end && week.week < line.term.weeks.size) PhaseLine("课程结束 · ${dayHead(last)}")
            }
            if (mode == "course") calendar?.pause?.let { rest -> BreakBand(rest, nextTerm, holidays, now.date) }
            FlowRow(Modifier.padding(top = 14.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (mode == "run") {
                    if ("rdone" in present) Swatch(mark.free, null, "已跑")
                    if ("rplan" in present) Swatch(mark.free.copy(alpha = .22f), mark.free, "排上")
                    if ("ropen" in present) Swatch(Color.Transparent, Ink.faint, "可跑，点一下排上")
                } else {
                    if ("has" in present) Swatch(Ink.sunken, hairline, "上课")
                    if ("exam" in present) Swatch(mark.exam, null, "考试")
                    if ("hol" in present) Swatch(Color.Transparent, null, "不上课", "休", mark.holiday)
                }
                if ("today" in present) Swatch(Color.Transparent, mark.now, "今天", edgeWidth = 2.dp)
            }
        }
        if (mode == "course") item {
            if (plan != null) {
                val tally = CampusLine.tally(plan, now)
                Column(Modifier.fillMaxWidth().topHairline(hairline).clickable { route.termMode = "run" }.padding(vertical = 12.dp)) {
                    Plain("早锻炼 ${tally.count} / ${plan.rule.required} 次", 17.sp, weight = FontWeight.SemiBold)
                    Box(Modifier.padding(vertical = 8.dp).fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(Ink.sunken)) {
                        Box(Modifier.fillMaxWidth(tally.count.coerceIn(0, plan.rule.required).toFloat() / plan.rule.required).fillMaxHeight().background(Ink.brand))
                    }
                    Plain("已跑 ${tally.done}，排上 ${tally.planned}，" + if (tally.need > 0) "还差 ${tally.need} 次" else "够了", 13.5.sp, Ink.muted)
                }
            }
            if (hasExams) Column(Modifier.fillMaxWidth().topHairline(hairline).clickable { route.scale = "exam" }.padding(vertical = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Plain(if (courses > 0) "考试 · 已发现 $courses 门" else "考试 · 最新安排与更新记录", 17.sp, weight = FontWeight.SemiBold)
                    if (fresh) Box(Modifier.padding(start = 6.dp).size(6.dp).clip(RoundedCornerShape(3.dp)).background(mark.warning))
                }
                val first = ahead.firstOrNull()
                if (first == null) Plain(if (courses > 0) "都考完了" else "暂无待考安排", 14.sp, weight = FontWeight.Medium, modifier = Modifier.padding(top = 2.dp))
                else {
                    Plain("${dayHead(first.first)} · ${lead(first.second)}", 14.sp, weight = FontWeight.Medium, modifier = Modifier.padding(top = 2.dp))
                    first.third.forEach { exam ->
                        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Plain(Names.course(exam.course.name), 13.5.sp, Ink.muted, modifier = Modifier.weight(1f), maxLines = 1)
                            Plain("${exam.start} · ${placeOf(exam)}", 13.5.sp, Ink.muted)
                        }
                    }
                }
            }
            if (offGrid.isNotEmpty()) {
                Plain("实践课程", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                offGrid.forEach { item ->
                    Column(Modifier.fillMaxWidth().topHairline(hairline).padding(vertical = 11.dp)) { Plain(item.name, 14.5.sp, weight = FontWeight.Medium); Plain(Exams.weeksText(item.weeks), 12.5.sp, Ink.muted) }
                }
            }
            val calendarAhead = (calendar?.holidays.orEmpty() + calendar?.events.orEmpty() + listOfNotNull(calendar?.pause)).filter { it.start >= now.date.toString() }.sortedBy { it.start }
            if (calendarAhead.isNotEmpty()) {
                Plain("校历", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                calendarAhead.forEach { item ->
                    val start = LocalDate.parse(item.start); val end = LocalDate.parse(item.end)
                    val custom = if (item in calendar?.events.orEmpty()) " · 按惯例全天停课" else ""
                    AheadRow(lead(CampusLine.daysBetween(now.date, start)), item.name, (if (start == end) dayHead(start) else "${dateLabel(start)} – ${dateLabel(end)}") + custom, null)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
    }
}
/** A line across the grid where the term changes phase: teaching ends, the break begins. */
@Composable private fun PhaseLine(text: String) = Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    Box(Modifier.weight(1f).height(1.dp).background(Ink.line)); Plain(text, 11.5.sp, Ink.muted); Box(Modifier.weight(1f).height(1.dp).background(Ink.line))
}
@Composable private fun AheadRow(lead: String, name: String, note: String, onClick: (() -> Unit)?) {
    val base = Modifier.fillMaxWidth().topHairline(Ink.line)
    Row((if (onClick != null) base.clickable(onClick = onClick) else base).padding(vertical = 11.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Plain(lead, 13.sp, Ink.muted, modifier = Modifier.width(56.dp))
        Column { Plain(name, 14.5.sp, weight = FontWeight.Medium); Plain(note, 12.5.sp, Ink.muted) }
    }
}
@Composable private fun PreviewDock(rows: List<TeachingMeeting>, mine: List<TeachingMeeting>, week: Int?, added: Boolean, modifier: Modifier, onCancel: () -> Unit, onAdd: () -> Unit) {
    fun overlaps(a: TeachingMeeting, b: TeachingMeeting) = a.weekday == b.weekday && a.teaching_class.id != b.teaching_class.id && a.periods.first() <= b.periods.last() && b.periods.first() <= a.periods.last()
    val clashes = rows.flatMap { row -> mine.filter { overlaps(row, it) && it.weeks.any(row.weeks::contains) } }
    val first = clashes.firstOrNull { week != null && week in it.weeks } ?: clashes.firstOrNull()
    val slots = rows.map { "${WEEKDAYS[it.weekday]} ${it.periods.first()}–${it.periods.last()} 节" }.distinct().take(3).joinToString("，")
    Surface(modifier.padding(bottom = 12.dp).fillMaxWidth(), shape = RoundedCornerShape(10.dp), color = Ink.paper, border = BorderStroke(1.dp, Ink.line), shadowElevation = 4.dp) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Plain(Names.course(rows.first().course.name), 13.5.sp, weight = FontWeight.SemiBold, maxLines = 1)
                if (first != null) Plain("与${Names.courseShort(first.course.name)}时间冲突", 12.sp, marks().danger, maxLines = 1)
                else Plain("${rows.first().teachers.joinToString(" ") { it.name }} · $slots", 12.sp, Ink.muted, maxLines = 1)
            }
            TextAction("取消", onCancel)
            ActionButton(if (added) "已加入" else "加入课表", go = true, enabled = !added, onClick = onAdd)
        }
    }
}

private fun termName(number: Int) = "第${"一二三"[number - 1]}学期"
private fun lead(days: Long) = when { days < 0 -> "已过"; days == 0L -> "今天"; days == 1L -> "明天"; else -> "$days 天后" }

/** What a day is on the school calendar beyond the term shown: a holiday, a calendar event, a break day, a term day. */
private fun calendarMark(date: LocalDate, rest: DaySpan?, holidays: List<DaySpan>, term: CalendarTerm?): String {
    val text = date.toString()
    return when {
        holidays.any { it.start <= text && text <= it.end } -> "hol"
        term?.events?.any { it.start <= text && text <= it.end } == true -> "event"
        rest != null && rest.start <= text && text <= rest.end -> "brk"
        term != null && term.start <= text && text <= term.end -> "term"
        else -> "out"
    }
}

/** Whole weeks, Monday first, covering a span of the calendar: the same grid as the term's, for what lies beyond it. */
@Composable private fun CalendarGrid(from: LocalDate, to: LocalDate, now: LocalDate, numbered: Boolean, markOf: (LocalDate) -> String) {
    val mark = marks()
    Row { Spacer(Modifier.width(28.dp)); WEEKDAYS.drop(1).forEach { Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { Plain(it.drop(1), 11.5.sp, Ink.faint) } } }
    var monday = from.minusDays(from.dayOfWeek.value - 1L)
    var index = 1
    while (monday <= to) {
        val start = monday
        Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(28.dp)) { if (numbered) Plain(index.toString(), 11.5.sp, Ink.faint) }
            (0L until 7L).forEach { offset ->
                val date = start.plusDays(offset)
                val kind = if (date < from || date > to) "out" else markOf(date)
                val shape = RoundedCornerShape(4.dp)
                if (kind == "out") Spacer(Modifier.weight(1f).height(30.dp))
                else Box(Modifier.weight(1f).height(30.dp).padding(horizontal = 1.5.dp).clip(shape)
                    .background(if (kind == "brk") Ink.sunken.copy(alpha = .6f) else Color.Transparent)
                    .then(if (kind == "event") Modifier.border(1.dp, mark.free.copy(alpha = .6f), shape) else Modifier)
                    .then(if (date == now) Modifier.border(2.dp, mark.now, shape) else Modifier), contentAlignment = Alignment.Center) {
                    val label = if (date.dayOfMonth == 1) "${date.monthValue}月" else date.dayOfMonth.toString()
                    Plain(label, 12.sp, when (kind) { "hol" -> mark.holiday; "event" -> mark.free; "brk" -> Ink.faint; else -> Ink.text }, if (kind == "hol" || kind == "event") FontWeight.SemiBold else FontWeight.Normal)
                }
            }
        }
        monday = monday.plusDays(7)
        index++
    }
}

/** The break after the term, folded: how long it is and when the next term starts, opening to its weeks. */
@Composable private fun BreakBand(rest: DaySpan, next: CalendarTerm?, holidays: List<DaySpan>, now: LocalDate) {
    var open by remember { mutableStateOf(false) }
    val start = LocalDate.parse(rest.start)
    val end = LocalDate.parse(rest.end)
    val days = java.time.temporal.ChronoUnit.DAYS.between(start, end) + 1
    Column(Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(14.dp)).border(1.dp, Ink.line, RoundedCornerShape(14.dp))) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Plain(rest.name, 14.5.sp, weight = FontWeight.SemiBold)
            Plain("${dateLabel(start)} – ${dateLabel(end)} · $days 天" + (next?.let { " · ${dateLabel(LocalDate.parse(it.start))}开学" } ?: ""), 13.sp, Ink.muted, modifier = Modifier.weight(1f))
            Plain(if (open) "⌄" else "›", 16.sp, Ink.faint)
        }
        if (open) Column(Modifier.padding(start = 8.dp, end = 8.dp, bottom = 12.dp)) {
            CalendarGrid(start, next?.let { LocalDate.parse(it.start).plusDays(6) } ?: end, now, false) { calendarMark(it, rest, holidays, next) }
        }
    }
}

/** The academic year's other term, from the school calendar: its weeks, holidays and events, and its break. */
@Composable private fun OtherTerm(term: CalendarTerm, year: Int, holidays: List<DaySpan>, now: LocalDate) {
    val mark = marks()
    val start = LocalDate.parse(term.start)
    val end = LocalDate.parse(term.end)
    val untilStart = java.time.temporal.ChronoUnit.DAYS.between(now, start)
    Column {
        CalendarGrid(start, end, now, true) { calendarMark(it, null, holidays, term) }
        term.pause?.let { BreakBand(it, null, holidays, now) }
        Column(Modifier.fillMaxWidth().padding(top = 18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Plain("$year–${year + 1} 学年${termName(term.number)}", 17.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Plain(if (untilStart > 0) "$untilStart 天后开学" else if (end < now) "已结束" else "", 13.sp, Ink.muted)
            }
            Plain("${dateLabel(start)} – ${dateLabel(end)} · ${term.weeks} 周", 14.sp, Ink.muted, modifier = Modifier.padding(top = 2.dp, bottom = 8.dp))
            (term.holidays + term.events).sortedBy { it.start }.forEach { item ->
                val event = item in term.events
                Row(Modifier.fillMaxWidth().topHairline(Ink.line).padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    SmallTag(lead(java.time.temporal.ChronoUnit.DAYS.between(now, LocalDate.parse(item.start))), (if (event) mark.free else mark.holiday).copy(alpha = .16f), if (event) mark.free else mark.holiday)
                    Column(Modifier.weight(1f)) {
                        Plain(item.name, 14.5.sp)
                        Plain(if (item.start == item.end) dateLabel(LocalDate.parse(item.start)) else "${dateLabel(LocalDate.parse(item.start))} – ${dateLabel(LocalDate.parse(item.end))}", 12.5.sp, Ink.muted)
                    }
                }
            }
            if (untilStart > 0) Plain("这个学期的课表公布后，课程和考试会出现在这里。", 12.5.sp, Ink.faint, modifier = Modifier.padding(top = 10.dp))
        }
    }
}
