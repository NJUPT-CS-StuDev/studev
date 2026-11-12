package top.hicancan.studev.timetable

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
@Composable fun TimetableScreen(route: Route, model: CampusModel, state: AcademicState, settings: PersonalSettings, now: Moment, walk: suspend (String) -> Int?, onEvent: (LineEvent, CampusLine) -> Unit) {
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
    val record = examRecordOf(state, classId)
    val title = when {
        !isMe -> if (route.whoType == "teacher") "${route.whoId} 老师" else if (route.whoType == "room") Names.room(route.whoId) else route.whoId
        scale == "list" -> "清单"
        scale == "term" -> "${term.year}–${term.year + 1} 学年第${if (term.number == 1) "一" else "二"}学期"
        scale == "week" -> if (week != null) "第 $week 周" else "假期"
        else -> "${dateLabel(day)} ${WEEKDAYS[day.dayOfWeek.value]}"
    }
    val lastDay = remember(line) { line.lastLesson() }
    val pending = line.tasks.count { it.parent == null && it.done == null }
    val sub = when (scale) {
        "list" -> if (pending > 0) "$pending 件要做" else "没有要做的事"
        "term" -> "${dateLabel(LocalDate.parse(term.weeks.first().start))} – ${dateLabel(LocalDate.parse(term.weeks.last().end))} · " +
            (line.weekOf(now.date)?.let { "第 $it / ${term.weeks.size} 周" } ?: "${term.weeks.size} 周") + (lastDay?.let { " · 课上到 ${dateLabel(it)}" } ?: "")
        "week" -> (if (ahead == 1) "下周 · " else if (ahead > 1) "$ahead 周后 · " else "") + "${dateLabel(monday)} – ${dateLabel(monday.plusDays(6))}"
        else -> if (week != null) "第 $week 周" else "假期"
    }
    val order = listOf("day", "week", "term")
    var pinch by remember { mutableFloatStateOf(1f) }
    var calendar by remember { mutableStateOf(false) }
    if (calendar) CalendarSheet(state, settings, model) { calendar = false }
    Column(Modifier.fillMaxSize().pointerInput(scale) {
        detectTransformGestures { _, _, zoom, _ ->
            pinch *= zoom
            val step = if (pinch < .72f) 1 else if (pinch > 1.38f) -1 else 0
            if (step != 0) { order.getOrNull(order.indexOf(scale) + step)?.let { route.scale = it }; pinch = 1f }
        }
    }.statusBarsPadding().padding(horizontal = 16.dp).padding(top = 14.dp)) {
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
        Row(Modifier.fillMaxWidth().padding(end = 40.dp, bottom = 16.dp), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                if (!isMe) Plain("‹ 我的课表", 13.sp, Ink.muted, modifier = Modifier.clickable { route.whoType = "me"; route.whoId = ""; route.scale = "day"; route.preview = null }.padding(bottom = 6.dp))
                Plain(title, 22.sp, weight = FontWeight.SemiBold, maxLines = 2)
                Plain(sub, 13.5.sp, Ink.muted, modifier = Modifier.padding(top = 4.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (scale == "week") { Chip("‹", { route.day = day.minusDays(7) }); Chip("今天", { route.day = if (ahead > 0) now.date else null }); Chip("›", { route.day = day.plusDays(7) }) }
                if (isMe && scale != "week") Chip("日历", { calendar = true })
            }
        }
        // The list is one's own: tasks by when they are due, exams among them.
        TextTabs(listOf("day" to "天", "week" to "周", "term" to "学期") + if (isMe) listOf("list" to "清单") else emptyList(), scale) { route.scale = it }
        Spacer(Modifier.height(16.dp))
        Box(Modifier.weight(1f)) {
            when (scale) {
                "list" -> TaskList(line, now, model.tasks) { onEvent(it, line) }
                "week" -> WeekView(line, day, now, record, previewRows, settings.layers) { onEvent(it, line) }
                "term" -> TermView(line, state, model, now, isMe, record, state.classes.firstOrNull { it.id == classId }?.practice.orEmpty(), settings, route, { route.day = it; route.scale = "week" }) { onEvent(it, line) }
                else -> DayView(line, day, now, isMe, record, route, walk, settings.layers, model.tasks) { onEvent(it, line) }
            }
            if (route.preview != null && previewRows.isNotEmpty()) PreviewDock(previewRows, line.meetings, week, settings.timetableEdits(term.term).added.contains(route.preview), Modifier.align(Alignment.BottomCenter),
                onCancel = { route.preview = null },
                onAdd = { model.addTeachingClass(route.preview!!); route.preview = null })
        }
    }
}

/** How a class's exams came to be: loaded once per class, for every view and sheet that shows an exam. */
@Composable fun examRecordOf(state: AcademicState, classId: String?): ExamRecord? =
    produceState<ExamRecord?>(null, classId, state.repository) { value = classId?.let { id -> runCatching { state.repository?.examRecord(id) }.getOrNull() } }.value

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

@Composable fun SearchField(value: String, hint: String, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    Row(modifier.fillMaxWidth().height(44.dp).border(1.dp, Ink.line, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(value, onChange, Modifier.weight(1f), singleLine = true, textStyle = TextStyle(fontSize = 15.5.sp, color = Ink.text), cursorBrush = androidx.compose.ui.graphics.SolidColor(Ink.brand), decorationBox = { inner ->
            if (value.isEmpty()) Plain(hint, 15.5.sp, Ink.faint, maxLines = 1)
            inner()
        })
    }
}

/** One thing on the line. `behind` is how many it overlaps lie behind it; one in front names the count. */
@Composable private fun Tile(event: LineEvent, toneIndex: Int?, past: Boolean, modifier: Modifier, big: Boolean, changed: Boolean = false, behind: Int = 0, onClick: () -> Unit) {
    val mark = marks()
    val tones = toneIndex?.let { tone(it) }
    val paper = Ink.paper
    fun faded(color: Color, amount: Float) = if (past) Color(color.red + (paper.red - color.red) * amount, color.green + (paper.green - color.green) * amount, color.blue + (paper.blue - color.blue) * amount) else color
    val done = event.task?.done != null
    val bg = when (event.kind) { "exam" -> mark.exam; "run", "task" -> paper; else -> faded(tones?.bg ?: Ink.sunken, .35f) }
    val fg = when (event.kind) { "exam" -> mark.onExam; "run" -> Ink.muted; "task" -> if (done) Ink.faint else Ink.text; else -> faded(tones?.fg ?: Ink.text, .42f) }
    val border = when (event.kind) { "exam" -> mark.exam; "run" -> Ink.line; "task" -> if (done) Ink.line else Ink.brand; else -> faded(tones?.border ?: Ink.line, .55f) }
    Box(modifier) {
        val lab = event.lab
        val note = if (big) "${hm(event.start)}–${hm(event.end)}${if (lab != null) " · ${lab.project}" else ""}${if (event.room != null) " · ${Names.room(event.room)}" else ""}"
            else if (lab != null) lab.room?.let(Names::roomShort) ?: Names.compactPlace(lab.short) else Names.roomShort(event.room)
        TileBox(if (big) event.name else event.short, if (event.task != null) (if (big) "${hm(event.start)}–${hm(event.end)}" else "") else note, bg, border, fg, Modifier.fillMaxSize(), big, onClick, strong = lab != null || event.task != null)
        if (changed) Box(Modifier.align(Alignment.TopEnd).padding(3.dp).clip(RoundedCornerShape(3.dp)).background(paper).padding(horizontal = 3.dp)) { Plain("改", 10.sp, mark.warning, FontWeight.SemiBold) }
        if (behind > 0) Box(Modifier.align(Alignment.BottomEnd).padding(3.dp).clip(RoundedCornerShape(3.dp)).background(paper).border(1.dp, Ink.line, RoundedCornerShape(3.dp)).padding(horizontal = 3.dp)) {
            Plain(if (big) "同时段另有 $behind 项" else "+$behind", if (big) 11.sp else 10.sp, Ink.text, FontWeight.SemiBold)
        }
    }
}
@Composable private fun TileBox(name: String, note: String, bg: Color, border: Color, fg: Color, modifier: Modifier, big: Boolean, onClick: (() -> Unit)?, strong: Boolean = false) {
    val base = modifier.clip(RoundedCornerShape(8.dp)).background(bg).border(if (strong) 2.dp else 1.dp, border, RoundedCornerShape(8.dp))
    Column((if (onClick != null) base.clickable(onClick = onClick) else base).padding(horizontal = 2.dp, vertical = 3.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(name, color = fg, textAlign = TextAlign.Center, style = TextStyle(fontSize = if (big) 14.5.sp else 11.sp, fontWeight = FontWeight.SemiBold, lineHeight = if (big) 19.sp else 14.sp))
        if (note.isNotEmpty()) Text(note, color = fg.copy(alpha = .82f), textAlign = TextAlign.Center, style = TextStyle(fontSize = if (big) 12.5.sp else 10.sp, lineHeight = if (big) 17.sp else 13.sp))
    }
}

@Composable private fun DayView(line: CampusLine, day: LocalDate, now: Moment, isMe: Boolean, record: ExamRecord?, route: Route, walk: suspend (String) -> Int?, order: List<String>, store: top.hicancan.studev.me.TaskStore, onOpen: (LineEvent) -> Unit) {
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
        if (gone.isNotEmpty()) Plain("已结束 ${gone.size} 项 · ${gone.joinToString("、") { it.short }}", 13.sp, Ink.faint, maxLines = 1, modifier = Modifier.padding(bottom = 12.dp))
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
            @Composable fun gap(start: Int, end: Int) = Plain("空 ${durationText(end - start)} · 看这时的空教室 ›", 12.5.sp, Ink.muted, modifier = Modifier.padding(start = 54.dp).offset(y = y((start + end) / 2) - 9.dp).clickable { route.rooms(day to start) })
            if (awake && live.first().start - free >= 45) gap(free, live.first().start)
            // Everything on, at its own time, back to front: what is behind shows beside what is in front.
            CampusLine.layers(live, order).forEach { (event, under, over) ->
                Tile(event, TimetablePresentation.toneOf(event, tones, line.courseMeetings), false, Modifier.padding(start = 44.dp, end = (under * 8).dp).fillMaxWidth().offset(y = y(event.start) + 1.dp).height(maxOf(40.dp, y(event.end) - y(event.start) - 2.dp)), true,
                    event.exam?.let { Exams.wasChanged(record, it) } == true, if (over == 0) under else 0) { onOpen(event) }
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

@Composable private fun NextBlock(line: CampusLine, now: Moment, route: Route, walk: suspend (String) -> Int?) {
    val event = remember(line, now) { line.next(now) } ?: return
    var minutes by remember(event.room) { mutableStateOf<Int?>(null) }
    LaunchedEffect(event.room) { if (Names.placed(event.room)) minutes = walk(event.room!!) }
    val today = event.date == now.date
    val during = today && event.start <= now.min
    val caption = when {
        during -> "正在上，到 ${hm(event.end)}"
        today -> "下一节 · 还有 ${durationText(event.start - now.min)}"
        CampusLine.daysBetween(now.date, event.date) == 1 -> "下一节 · 明天"
        else -> "下一节 · ${dateLabel(event.date)}"
    }
    val exam = line.examDays(now.date).firstOrNull()
    val mark = marks()
    Row(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f)) {
            Plain(caption, 12.5.sp, Ink.muted)
            Plain("${hm(event.start)} ${event.name}", 19.sp, weight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 2.dp))
            Plain((if (event.room != null) Names.room(event.room) else "课表没写地点") + (minutes?.takeIf { !during }?.let { " · ${hm(event.start - it - 2)} 出门，步行 $it 分钟" } ?: ""), 13.5.sp, Ink.muted)
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
            Row(Modifier.fillMaxWidth().bottomHairline(hairline).padding(vertical = 6.dp)) {
                Spacer(Modifier.width(38.dp))
                days.take(columns).forEachIndexed { index, date ->
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
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
                        CampusLine.layers(events[index], order).forEach { (event, under, over) ->
                            val past = event.kind != "exam" && (date < now.date || (date == now.date && event.end <= now.min))
                            Tile(event, TimetablePresentation.toneOf(event, lineTones, line.courseMeetings), past, Modifier.padding(start = 2.dp, end = (2 + under * 5).dp).fillMaxWidth().offset(y = y(event.start) + 1.dp).height(maxOf(22.dp, y(event.end) - y(event.start) - 2.dp)), false,
                                event.exam?.let { Exams.wasChanged(record, it) } == true, if (over == 0) under else 0) { onOpen(event) }
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

/** The term in three pages: the grid with everything on it, the exams as a list, and 早锻炼 to plan. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable private fun TermView(line: CampusLine, state: AcademicState, model: CampusModel, now: Moment, isMe: Boolean, record: ExamRecord?, practice: List<Practice>, settings: PersonalSettings, route: Route, onPick: (LocalDate) -> Unit, onOpen: (LineEvent) -> Unit) {
    val mark = marks()
    val hairline = Ink.line
    val calendar = state.calendar.firstOrNull { it.start == line.term.weeks.firstOrNull()?.start }
    val plan = line.run.takeIf { isMe }
    val runnable = remember(plan, line) { plan?.let { CampusLine.runDates(it.rule, line.holidays).toSet() }.orEmpty() }
    val codes = remember(line) { line.meetings.map { it.course.code.orEmpty() }.toSet() }
    val changes = record?.changes.orEmpty().filter { !isMe || it.course.code.orEmpty() in codes }
    val latest = changes.maxOfOrNull { it.observed }
    val ahead = remember(line, now.date) { line.examDays(now.date) }
    val taken = line.exams.filter { it.date < now.date.toString() }.sortedWith(compareByDescending<Exam> { it.date }.thenByDescending { it.start })
    val hasExams = line.exams.isNotEmpty() || changes.isNotEmpty()
    val mode = when { route.termMode == "exam" && hasExams -> "exam"; route.termMode == "run" && plan != null -> "run"; else -> "course" }
    val run = plan.takeIf { mode == "run" }
    LaunchedEffect(latest, mode, settings.examsSeen, isMe) {
        // Someone arriving for the first time has nothing new to be told about.
        if (isMe && latest != null && settings.examsSeen != latest && (mode == "exam" || settings.examsSeen == null)) model.settings.update { it.copy(examsSeen = latest) }
    }
    val fresh = isMe && latest != null && settings.examsSeen != null && latest > settings.examsSeen && mode != "exam"
    val termStart = LocalDate.parse(line.term.weeks.first().start)
    val termEnd = LocalDate.parse(calendar?.end ?: line.term.weeks.last().end)
    val last = remember(line) { line.lastLesson() }
    val courses = line.exams.map { it.course.code ?: it.course.name }.distinct().size
    val offGrid = practice.distinctBy { it.name to it.weeks }.sortedWith(compareBy({ it.weeks.first() }, { it.name }))
    var takenOpen by remember { mutableStateOf(false) }
    var detailOpen by remember { mutableStateOf(false) }
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
    val modes = listOf("course" to "课程") + (if (hasExams) listOf("exam" to (if (fresh) "考试 •" else "考试")) else emptyList()) + (if (plan != null) listOf("run" to "早锻炼") else emptyList())
    // The pages sit above the list, so the list never starts scrolled past them while they appear.
    Column(Modifier.fillMaxSize()) {
    if (modes.size > 1) Box(Modifier.padding(bottom = 12.dp)) { Choice(modes, mode) { route.termMode = it } }
    LazyColumn(Modifier.fillMaxSize()) {
        if (mode == "exam") {
            // The first thing to know: how soon, and what.
            item {
                Column(Modifier.padding(top = 4.dp, bottom = 14.dp)) {
                    val first = ahead.firstOrNull()
                    Plain(if (first != null) "${lead(first.second)}考试" else "后面没有考试了", 22.sp, weight = FontWeight.SemiBold)
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
            if (taken.isNotEmpty()) item {
                Column(Modifier.fillMaxWidth().topHairline(hairline).clickable { takenOpen = !takenOpen }.padding(vertical = 11.dp)) { Plain("已考 ${taken.size} 场", 13.5.sp, Ink.muted) }
                if (takenOpen) taken.forEach { examRow(it, dateLabel(LocalDate.parse(it.date))) }
            }
            if (record != null) item {
                // Why the list can be trusted, said as something one can check: every sheet the office published has been
                // read, and when its site was last looked at; then every change seen. The office withdraws old notices, so nothing links to them.
                Column(Modifier.padding(top = 24.dp)) {
                    record.checked?.let { at ->
                        val local = java.time.OffsetDateTime.parse(at).atZoneSameInstant(CampusDay.zone)
                        Plain("已核对教务处发布的全部考试安排表 · 最近检查 ${local.monthValue}月${local.dayOfMonth}日 ${hm(local.hour * 60 + local.minute)}", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 12.dp))
                    }
                    if (changes.isNotEmpty()) {
                        Column(Modifier.fillMaxWidth().topHairline(hairline).clickable { detailOpen = !detailOpen }.padding(vertical = 10.dp)) { Plain("变动 ${changes.size} 处 · 最近 ${dateLabel(LocalDate.parse(latest!!))}", 13.5.sp, Ink.muted) }
                        if (detailOpen) changes.sortedByDescending { it.observed }.forEach { change ->
                            Row(Modifier.padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Plain(Exams.changeNames.getValue(change.change), 11.5.sp, when (change.change) { "added" -> mark.free; "changed" -> mark.warning; else -> Ink.faint }, FontWeight.Medium)
                                Column {
                                    Plain(Names.course(change.course.name), 14.sp)
                                    Plain("${dateLabel(LocalDate.parse(change.observed))} 发现", 12.5.sp, Ink.muted)
                                    Exams.changeLines(change).forEach { Plain(it, 12.5.sp, Ink.muted) }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
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
                                .clickable { line.on(date).firstOrNull { it.kind == "exam" }?.let(onOpen) ?: onPick(date) },
                                contentAlignment = Alignment.Center) { Plain(dayLabel(date), 12.sp, ink, if (cell == "exam" || cell == "hol") FontWeight.SemiBold else FontWeight.Normal) }
                        }
                    }
                }
                if (mode == "course" && last != null && week.start <= last.toString() && last.toString() <= week.end && week.week < line.term.weeks.size) PhaseLine("课程结束 · ${dayHead(last)}")
            }
            calendar?.pause?.takeIf { LocalDate.parse(it.start) <= LocalDate.parse(line.term.weeks.last().end).plusDays(1) }?.let { PhaseLine("${it.name} ${dateLabel(LocalDate.parse(it.start))}起") }
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
            if (hasExams) Column(Modifier.fillMaxWidth().topHairline(hairline).clickable { route.termMode = "exam" }.padding(vertical = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Plain("考试 · 已发现 $courses 门", 17.sp, weight = FontWeight.SemiBold)
                    if (fresh) Box(Modifier.padding(start = 6.dp).size(6.dp).clip(RoundedCornerShape(3.dp)).background(mark.warning))
                }
                val first = ahead.firstOrNull()
                if (first == null) Plain("都考完了", 14.sp, weight = FontWeight.Medium, modifier = Modifier.padding(top = 2.dp))
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
                Plain("不在课表里的课", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
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
            ActionButton("取消", onClick = onCancel)
            ActionButton(if (added) "已加入" else "加入课表", go = true, enabled = !added, onClick = onAdd)
        }
    }
}
