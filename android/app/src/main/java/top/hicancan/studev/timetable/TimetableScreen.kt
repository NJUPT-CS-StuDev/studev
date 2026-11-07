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
        others = CampusLine(term, state.periods, meetings, exams, state.holidays, null)
    }
    val line = if (isMe) model.myLine(state, settings) else others
    if (line == null) { Box(Modifier.fillMaxSize()); return }
    var previewRows by remember { mutableStateOf(emptyList<TeachingMeeting>()) }
    LaunchedEffect(route.preview) { previewRows = route.preview?.let { id -> model.meetings().filter { it.teaching_class.id == id } }.orEmpty() }
    val day = route.day ?: now.date
    val monday = day.minusDays((day.dayOfWeek.value - 1).toLong())
    val week = line.weekOf(day)
    val scale = route.scale
    val title = when {
        !isMe -> if (route.whoType == "teacher") "${route.whoId} 老师" else if (route.whoType == "room") Names.room(route.whoId) else route.whoId
        scale == "term" -> "${term.year}–${term.year + 1} 学年第${if (term.number == 1) "一" else "二"}学期"
        scale == "week" -> if (week != null) "第 $week 周" else "假期"
        else -> "${dateLabel(day)} ${WEEKDAYS[day.dayOfWeek.value]}"
    }
    val sub = when (scale) {
        "term" -> "${dateLabel(LocalDate.parse(term.weeks.first().start))} – ${dateLabel(LocalDate.parse(term.weeks.last().end))} · ${term.weeks.size} 周"
        "week" -> "${dateLabel(monday)} – ${dateLabel(monday.plusDays(6))}"
        else -> if (week != null) "第 $week 周" else "假期"
    }
    val order = listOf("day", "week", "term")
    var pinch by remember { mutableFloatStateOf(1f) }
    Column(Modifier.fillMaxSize().pointerInput(scale) {
        detectTransformGestures { _, _, zoom, _ ->
            pinch *= zoom
            val step = if (pinch < .72f) 1 else if (pinch > 1.38f) -1 else 0
            if (step != 0) { order.getOrNull(order.indexOf(scale) + step)?.let { route.scale = it }; pinch = 1f }
        }
    }.statusBarsPadding().padding(horizontal = 16.dp).padding(top = 14.dp)) {
        Row(Modifier.fillMaxWidth().padding(end = 40.dp, bottom = 16.dp), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                if (!isMe) Plain("‹ 我的课表", 13.sp, Ink.muted, modifier = Modifier.clickable { route.whoType = "me"; route.whoId = ""; route.scale = "day"; route.preview = null }.padding(bottom = 6.dp))
                Plain(title, 22.sp, weight = FontWeight.SemiBold, maxLines = 2)
                Plain(sub, 13.5.sp, Ink.muted, modifier = Modifier.padding(top = 4.dp))
            }
            if (scale == "week") Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("‹", { route.day = day.minusDays(7) }); Chip("今天", { route.day = null }); Chip("›", { route.day = day.plusDays(7) })
            }
        }
        TextTabs(listOf("day" to "天", "week" to "周", "term" to "学期"), scale) { route.scale = it }
        Spacer(Modifier.height(16.dp))
        Box(Modifier.weight(1f)) {
            when (scale) {
                "week" -> WeekView(line, day, now, previewRows) { onEvent(it, line) }
                "term" -> TermView(line, state, model, now, isMe, if (isMe) settings.klass else if (route.whoType == "class") route.whoId else null, settings, route, { route.day = it; route.scale = "week" }) { onEvent(it, line) }
                else -> DayView(line, day, now, isMe, route, walk) { onEvent(it, line) }
            }
            if (route.preview != null && previewRows.isNotEmpty()) PreviewDock(previewRows, line.meetings, week, settings.timetableEdits(term.term).added.contains(route.preview), Modifier.align(Alignment.BottomCenter),
                onCancel = { route.preview = null },
                onAdd = { model.addTeachingClass(route.preview!!); route.preview = null })
        }
    }
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

@Composable fun SearchField(value: String, hint: String, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    Row(modifier.fillMaxWidth().height(44.dp).border(1.dp, Ink.line, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(value, onChange, Modifier.weight(1f), singleLine = true, textStyle = TextStyle(fontSize = 15.5.sp, color = Ink.text), cursorBrush = androidx.compose.ui.graphics.SolidColor(Ink.brand), decorationBox = { inner ->
            if (value.isEmpty()) Plain(hint, 15.5.sp, Ink.faint, maxLines = 1)
            inner()
        })
    }
}

@Composable private fun Tile(event: LineEvent, past: Boolean, modifier: Modifier, big: Boolean, onClick: () -> Unit) {
    val mark = marks()
    val tones = event.meeting?.let { tone(TimetablePresentation.colourIndex(it)) }
    val paper = Ink.paper
    fun faded(color: Color, amount: Float) = if (past) Color(color.red + (paper.red - color.red) * amount, color.green + (paper.green - color.green) * amount, color.blue + (paper.blue - color.blue) * amount) else color
    val bg = when (event.kind) { "exam" -> mark.exam; "run" -> paper; else -> faded(tones?.bg ?: Ink.sunken, .35f) }
    val fg = when (event.kind) { "exam" -> mark.onExam; "run" -> Ink.muted; else -> faded(tones?.fg ?: Ink.text, .42f) }
    val border = when (event.kind) { "exam" -> mark.exam; "run" -> Ink.line; else -> faded(tones?.border ?: Ink.line, .55f) }
    TileBox(if (big) event.name else event.short, if (big) "${hm(event.start)}–${hm(event.end)}${if (event.room != null) " · ${Names.room(event.room)}" else ""}" else Names.roomShort(event.room), bg, border, fg, modifier, big, onClick)
}
@Composable private fun TileBox(name: String, note: String, bg: Color, border: Color, fg: Color, modifier: Modifier, big: Boolean, onClick: (() -> Unit)?) {
    val base = modifier.clip(RoundedCornerShape(8.dp)).background(bg).border(1.dp, border, RoundedCornerShape(8.dp))
    Column((if (onClick != null) base.clickable(onClick = onClick) else base).padding(horizontal = 2.dp, vertical = 3.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(name, color = fg, textAlign = TextAlign.Center, style = TextStyle(fontSize = if (big) 14.5.sp else 11.sp, fontWeight = FontWeight.SemiBold, lineHeight = if (big) 19.sp else 14.sp))
        if (note.isNotEmpty()) Text(note, color = fg.copy(alpha = .82f), textAlign = TextAlign.Center, style = TextStyle(fontSize = if (big) 12.5.sp else 10.sp, lineHeight = if (big) 17.sp else 13.sp))
    }
}

@Composable private fun DayView(line: CampusLine, day: LocalDate, now: Moment, isMe: Boolean, route: Route, walk: suspend (String) -> Int?, onOpen: (LineEvent) -> Unit) {
    val today = day == now.date
    val events = remember(line, day) { line.on(day) }
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
        if (events.isEmpty()) { Empty(line.holidays[day] ?: "这一天没有安排"); return@Column }
        val fold = today && isMe
        val gone = if (fold) events.filter { it.end <= now.min } else emptyList()
        val live = if (fold) events.filter { it.end > now.min } else events
        if (gone.isNotEmpty()) Plain("已结束 ${gone.size} 项 · ${gone.joinToString("、") { it.short }}", 13.sp, Ink.faint, maxLines = 1, modifier = Modifier.padding(bottom = 12.dp))
        if (live.isEmpty()) { Empty("今天的课都上完了"); return@Column }
        val from = (if (fold) minOf(now.min, live.first().start) else live.first().start) - 14
        val to = maxOf(live.last().end + 24, if (today) now.min + 20 else 0)
        fun y(minutes: Int): Dp = (minutes - from).dp
        val mark = marks()
        val hairline = Ink.line
        Box(Modifier.fillMaxWidth().height(y(to))) {
            var hour = (from / 60 + 1) * 60
            while (hour <= to) {
                val at = hour
                if (!(today && kotlin.math.abs(at - now.min) < 16)) Plain("${at / 60}:00", 11.5.sp, Ink.faint, modifier = Modifier.offset(y = y(at) - 8.dp).width(36.dp))
                Box(Modifier.padding(start = 44.dp).fillMaxWidth().height(1.dp).offset(y = y(at)).background(hairline))
                hour += 60
            }
            @Composable fun gap(start: Int, end: Int) = Plain("空 ${durationText(end - start)} · 看这时的空教室 ›", 12.5.sp, Ink.muted, modifier = Modifier.padding(start = 54.dp).offset(y = y((start + end) / 2) - 9.dp).clickable { route.map(at = day to start) })
            if (today && live.first().start - now.min >= 25) gap(now.min, live.first().start)
            live.forEachIndexed { index, event ->
                Tile(event, false, Modifier.padding(start = 44.dp).fillMaxWidth().offset(y = y(event.start) + 1.dp).height(maxOf(40.dp, y(event.end) - y(event.start) - 2.dp)), true) { onOpen(event) }
                val next = live.getOrNull(index + 1)
                val start = if (today) maxOf(event.end, now.min) else event.end
                if (next != null && next.start - start >= 30 && next.start - event.end >= 45) gap(start, next.start)
            }
            if (today) {
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
    val exam = line.upcomingExams(now.date).firstOrNull()
    val mark = marks()
    Row(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f)) {
            Plain(caption, 12.5.sp, Ink.muted)
            Plain("${hm(event.start)} ${event.name}", 19.sp, weight = FontWeight.SemiBold, modifier = Modifier.padding(vertical = 2.dp))
            Plain((if (event.room != null) Names.room(event.room) else "教室未排定") + (minutes?.takeIf { !during }?.let { " · ${hm(event.start - it - 2)} 出门，步行 $it 分钟" } ?: ""), 13.5.sp, Ink.muted)
            if (exam != null) Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                SmallTag("考试", mark.exam, mark.onExam)
                val days = CampusLine.daysBetween(now.date, LocalDate.parse(exam.date))
                Plain("${if (days == 0) "今天" else if (days == 1) "明天" else "$days 天后"} ${exam.course.name} ${exam.start}", 13.sp, maxLines = 1)
            }
        }
        if (Names.placed(event.room)) ActionButton("去这里", go = true) { route.map(nav = event.room) }
    }
    HorizontalDivider(color = Ink.line, modifier = Modifier.padding(bottom = 18.dp))
}

@Composable private fun Empty(text: String) = Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain(text, 14.sp, Ink.faint) }

private const val DAY_END = 21 * 60 + 8

@Composable private fun WeekView(line: CampusLine, day: LocalDate, now: Moment, ghosts: List<TeachingMeeting>, onOpen: (LineEvent) -> Unit) {
    val monday = day.minusDays((day.dayOfWeek.value - 1).toLong())
    val days = remember(monday) { (0L until 7L).map { monday.plusDays(it) } }
    val week = line.weekOf(monday)
    val events = remember(line, monday) { days.map(line::on) }
    val cells = remember(line, week) { if (week != null) TimetablePresentation.cells(line.meetings, week) else emptyList() }
    val shownGhosts = if (week != null) ghosts.filter { week in it.weeks } else emptyList()
    var columns = 5
    days.forEachIndexed { index, _ -> if (events[index].isNotEmpty() || cells.any { it.day == index + 1 } || shownGhosts.any { it.weekday == index + 1 }) columns = maxOf(columns, index + 1) }
    val period = remember(line) { line.periods.associate { it.period to (clock(it.start) to clock(it.end)) } }
    val from = (if (events.flatten().any { it.kind == "run" }) clock(line.run!!.rule.time[0]) else 480) - 4
    fun y(minutes: Int): Dp = ((minutes - from) * .72f).dp
    val mark = marks()
    val hairline = Ink.line
    val soft = hairline.copy(alpha = .65f)
    val paper = Ink.paper
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Column(Modifier.fillMaxWidth().border(1.dp, hairline, RoundedCornerShape(8.dp)).clip(RoundedCornerShape(8.dp))) {
            Row(Modifier.fillMaxWidth().bottomHairline(hairline).padding(vertical = 6.dp)) {
                Spacer(Modifier.width(32.dp))
                days.take(columns).forEachIndexed { index, date ->
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        val color = if (date == now.date) Ink.brand else Ink.text
                        Plain(WEEKDAYS[index + 1], 12.sp, color, FontWeight.SemiBold)
                        Plain(line.holidays[date] ?: "${date.monthValue}/${date.dayOfMonth}", 11.sp, if (date == now.date) Ink.brand else Ink.muted, maxLines = 1)
                    }
                }
            }
            Row(Modifier.fillMaxWidth().height(y(DAY_END))) {
                Box(Modifier.width(32.dp).fillMaxHeight().drawBehind { drawLine(hairline, Offset(size.width, 0f), Offset(size.width, size.height), 1f) }) {
                    line.periods.forEach { item ->
                        val (start, end) = period.getValue(item.period)
                        Box(Modifier.fillMaxWidth().height(y(end) - y(start)).offset(y = y(start)), contentAlignment = Alignment.Center) { Plain(item.period.toString(), 11.sp, Ink.faint) }
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
                        val all = if (off) emptyList() else cells.filter { it.day == index + 1 }
                        fun clash(a: TimetableCell, b: TimetableCell) = a !== b && a.periods.first() <= b.periods.last() && b.periods.first() <= a.periods.last()
                        val lessons = all.filter { cell -> cell.state == "active" || all.none { it.state == "active" && clash(cell, it) } }
                        lessons.forEach { cell ->
                            val start = period[cell.periods.first()]?.first ?: return@forEach
                            val end = period[cell.periods.last()]?.second ?: return@forEach
                            val shared = lessons.any { clash(cell, it) }
                            val slotWidth = if (shared) width / cell.columns else width
                            val x = if (shared) slotWidth * cell.slot else 0.dp
                            val event = events[index].firstOrNull { it.meeting?.id == cell.id }
                            val quiet = cell.state != "active"
                            val past = date < now.date || (date == now.date && end <= now.min)
                            val tones = tone(cell.colourIndex)
                            val blend = if (quiet || past) .4f else 0f
                            fun mix(color: Color) = Color(color.red + (paper.red - color.red) * blend, color.green + (paper.green - color.green) * blend, color.blue + (paper.blue - color.blue) * blend)
                            TileBox(Names.courseShort(cell.course), if (quiet) cell.label else Names.roomShort(cell.room), mix(tones.bg), mix(tones.border), mix(tones.fg),
                                Modifier.padding(horizontal = 2.dp).width(slotWidth - 4.dp).offset(x = x, y = y(start) + 1.dp).height(y(end) - y(start) - 2.dp), false, event?.let { found -> { onOpen(found) } })
                        }
                        events[index].filter { it.kind != "class" }.forEach { event ->
                            Tile(event, false, Modifier.padding(horizontal = 2.dp).fillMaxWidth().offset(y = y(event.start) + 1.dp).height(maxOf(22.dp, y(event.end) - y(event.start) - 2.dp)), false) { onOpen(event) }
                        }
                        shownGhosts.filter { it.weekday == index + 1 }.forEach { meeting ->
                            val start = period.getValue(meeting.periods.first()).first
                            val end = period.getValue(meeting.periods.last()).second
                            val busy = events[index].any { it.start < end && start < it.end }
                            val color = if (busy) mark.now else mark.free
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

private val SLOT_FIELDS: List<Pair<String, (ExamSlot) -> String?>> = listOf(
    "时间" to { "${it.date} ${it.start}–${it.end}" }, "地点" to { it.location }, "校区" to { it.campus }, "教师" to { it.teacher }, "人数" to { it.students?.toString() },
)
private fun slotText(slots: List<ExamSlot>?, read: (ExamSlot) -> String?) = slots.orEmpty().map { read(it)?.takeIf(String::isNotEmpty) ?: "未填写" }.distinct().joinToString("、").ifEmpty { "未填写" }
private fun changeLines(change: ExamChange): List<String> = when (change.change) {
    "changed" -> SLOT_FIELDS.mapNotNull { (label, read) -> val before = slotText(change.before, read); val after = slotText(change.after, read); if (before == after) null else "$label：$before → $after" }
    "added" -> listOf("${slotText(change.after, SLOT_FIELDS[0].second)} · ${slotText(change.after, SLOT_FIELDS[1].second)}")
    else -> listOf("原定 ${slotText(change.before, SLOT_FIELDS[0].second)}")
}

/** Colour swatch of the legend; a shape says the same thing as the cell it stands for. */
@Composable private fun Swatch(fill: Color, edge: Color?, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(RoundedCornerShape(2.dp)).background(fill).then(if (edge != null) Modifier.border(1.dp, edge, RoundedCornerShape(2.dp)) else Modifier))
        Plain(label, 12.sp, Ink.muted, modifier = Modifier.padding(start = 5.dp))
    }
}

@Composable private fun TermView(line: CampusLine, state: AcademicState, model: CampusModel, now: Moment, isMe: Boolean, classId: String?, settings: PersonalSettings, route: Route, onPick: (LocalDate) -> Unit, onOpen: (LineEvent) -> Unit) {
    val mark = marks()
    val hairline = Ink.line
    val calendar = state.calendar.firstOrNull { it.start == line.term.weeks.firstOrNull()?.start }
    val plan = line.run.takeIf { isMe }
    val runnable = remember(plan, line) { plan?.let { CampusLine.runDates(it.rule, line.holidays).toSet() }.orEmpty() }
    val record by produceState<ExamRecord?>(null, classId, state.repository) { value = classId?.let { id -> runCatching { state.repository?.examRecord(id) }.getOrNull() } }
    val codes = remember(line) { line.meetings.map { it.course.code.orEmpty() }.toSet() }
    val changes = record?.changes.orEmpty().filter { !isMe || it.course.code.orEmpty() in codes }
    val latest = changes.maxOfOrNull { it.observed }
    val upcoming = line.upcomingExams(now.date)
    val taken = line.exams.filter { it.date < now.date.toString() }.sortedByDescending { it.date }
    val hasExams = upcoming.isNotEmpty() || taken.isNotEmpty() || record?.changes.orEmpty().isNotEmpty()
    val mode = when { route.termMode == "exam" && hasExams -> "exam"; route.termMode == "run" && plan != null -> "run"; else -> "course" }
    val run = plan.takeIf { mode == "run" }
    LaunchedEffect(latest, mode, settings.examsSeen, isMe) {
        // Someone arriving for the first time has nothing new to be told about.
        if (isMe && latest != null && settings.examsSeen != latest && (mode == "exam" || settings.examsSeen == null)) model.settings.update { it.copy(examsSeen = latest) }
    }
    val fresh = isMe && latest != null && settings.examsSeen != null && latest > settings.examsSeen && mode != "exam"
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    val scope = rememberCoroutineScope()
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    var takenOpen by remember { mutableStateOf(false) }
    @Composable fun examRow(exam: Exam, lead: String) {
        val date = LocalDate.parse(exam.date)
        val changed = record?.changes.orEmpty().any { it.change == "changed" && it.course.code == exam.course.code }
        AheadRow(lead, Names.course(exam.course.name) + if (changed) " · 已调整" else "", "${dateLabel(date)} ${WEEKDAYS[date.dayOfWeek.value]} ${exam.start}${(exam.room?.let(Names::room) ?: exam.location)?.let { " · $it" } ?: ""}") {
            line.on(date).firstOrNull { it.exam?.id == exam.id }?.let(onOpen)
        }
    }
    LazyColumn(Modifier.fillMaxSize(), state = listState) {
        item {
            val modes = listOf("course" to "课程") + (if (hasExams) listOf("exam" to (if (fresh) "考试 •" else "考试")) else emptyList()) + (if (plan != null) listOf("run" to "早锻炼") else emptyList())
            if (modes.size > 1) Box(Modifier.padding(bottom = 12.dp)) { Choice(modes, mode) { route.termMode = it } }
            if (run != null) RunPanel(run, line, now, model)
            Row { Spacer(Modifier.width(28.dp)); WEEKDAYS.drop(1).forEach { Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { Plain(it.drop(1), 11.5.sp, Ink.faint) } } }
            line.term.weeks.forEach { week ->
                val current = week.start <= now.date.toString() && now.date.toString() <= week.end
                Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(28.dp)) { Plain(week.week.toString(), 11.5.sp, if (current) Ink.brand else Ink.faint, if (current) FontWeight.SemiBold else FontWeight.Normal) }
                    (0L until 7L).forEach { offset ->
                        val date = LocalDate.parse(week.start).plusDays(offset)
                        if (run != null) RunCell(date, run, date in runnable, now, model, Modifier.weight(1f)) else {
                            val events = line.on(date)
                            val exam = events.any { it.kind == "exam" }
                            val holiday = date in line.holidays
                            val past = date < now.date
                            val shape = RoundedCornerShape(4.dp)
                            val fill = when {
                                exam && mode == "exam" && past -> Color.Transparent
                                exam -> mark.exam
                                mode == "exam" || holiday || past -> Color.Transparent
                                events.any { it.kind == "class" } -> Ink.sunken
                                else -> Color.Transparent
                            }
                            val ink = when { exam && !(mode == "exam" && past) -> mark.onExam; mode == "exam" -> Ink.line; past -> Ink.faint; holiday -> Ink.muted; events.any { it.kind == "class" } -> Ink.text; else -> Ink.faint }
                            Box(Modifier.weight(1f).height(30.dp).padding(horizontal = 1.5.dp).clip(shape).background(fill)
                                .then(if (date == now.date) Modifier.border(1.5.dp, mark.now, shape) else if (exam && mode == "exam" && past) Modifier.border(1.dp, Ink.faint, shape) else Modifier)
                                .drawBehind { if (holiday && mode != "exam") { var x = -size.height; while (x < size.width) { drawLine(hairline, Offset(x, size.height), Offset(x + size.height, 0f), 1.5f); x += 4.dp.toPx() } } }
                                .then(when {
                                    mode == "course" -> Modifier.clickable { onPick(date) }
                                    exam -> Modifier.clickable { scope.launch { listState.animateScrollToItem(1 + (upcoming.indexOfFirst { it.date == date.toString() }).coerceAtLeast(0)) } }
                                    else -> Modifier
                                }), contentAlignment = Alignment.Center) { Plain(date.dayOfMonth.toString(), 12.sp, ink) }
                        }
                    }
                }
            }
            Row(Modifier.padding(top = 14.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                when (mode) {
                    "run" -> { Swatch(mark.free, null, "已跑"); Swatch(mark.free.copy(alpha = .22f), mark.free, "计划"); Swatch(Color.Transparent, Ink.faint, "可跑，点一下排上"); Swatch(Ink.line, null, "已过") }
                    "exam" -> { Swatch(mark.exam, null, "考试"); Swatch(Color.Transparent, Ink.faint, "已考"); Swatch(Color.Transparent, mark.now, "今天") }
                    else -> { Swatch(mark.exam, null, "考试"); Swatch(hairline, null, "放假"); Swatch(Color.Transparent, mark.now, "今天") }
                }
            }
        }
        if (mode == "exam") {
            if (upcoming.isEmpty()) item { Plain("后面没有考试了", 13.5.sp, Ink.muted, modifier = Modifier.padding(bottom = 12.dp)) }
            items(upcoming.size) { index -> val exam = upcoming[index]; val days = CampusLine.daysBetween(now.date, LocalDate.parse(exam.date)); examRow(exam, if (days == 0) "今天" else "$days 天后") }
            if (taken.isNotEmpty()) item {
                Column(Modifier.fillMaxWidth().topHairline(hairline).clickable { takenOpen = !takenOpen }.padding(vertical = 11.dp)) { Plain("已考 ${taken.size} 场", 13.5.sp, Ink.muted) }
                if (takenOpen) taken.forEach { examRow(it, "已考") }
            }
            item {
                Plain("更新记录", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                if (changes.isEmpty()) Plain("发布以来没有变动", 13.5.sp, Ink.muted)
                changes.groupBy { it.observed }.toSortedMap(compareByDescending { it }).forEach { (day, list) ->
                    Column(Modifier.fillMaxWidth().topHairline(hairline).padding(vertical = 10.dp)) {
                        Plain("${dateLabel(LocalDate.parse(day))} 发现 ${list.size} 处变动", 13.5.sp, Ink.muted)
                        list.forEach { change ->
                            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Plain(when (change.change) { "added" -> "新增"; "changed" -> "调整"; else -> "已移除" }, 11.5.sp, when (change.change) { "added" -> mark.free; "changed" -> mark.now; else -> Ink.faint }, FontWeight.Medium)
                                Column { Plain(Names.course(change.course.name), 14.sp); changeLines(change).forEach { Plain(it, 12.5.sp, Ink.muted) } }
                            }
                        }
                    }
                }
                record?.sources.orEmpty().takeIf { it.isNotEmpty() }?.let { sources ->
                    Plain("来源", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                    sources.forEach { source -> Box(Modifier.fillMaxWidth().topHairline(hairline).clickable { uri.openUri(source.url) }.padding(vertical = 9.dp)) { Plain(source.file.replace(Regex("\\.[a-zA-Z]+$"), "").replace(Regex("^\\d{4}-\\d{2}-\\d{2}-"), ""), 13.sp, Ink.muted) } }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
        if (mode == "course") item {
            if (plan != null) {
                val tally = CampusLine.tally(plan)
                Column(Modifier.fillMaxWidth().topHairline(hairline).clickable { route.termMode = "run" }.padding(vertical = 12.dp)) {
                    Plain("早锻炼 ${tally.count} / ${plan.rule.required} 次", 17.sp, weight = FontWeight.SemiBold)
                    Box(Modifier.padding(vertical = 8.dp).fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(Ink.sunken)) {
                        Box(Modifier.fillMaxWidth(tally.count.coerceIn(0, plan.rule.required).toFloat() / plan.rule.required).fillMaxHeight().background(Ink.brand))
                    }
                    Plain("已跑 ${tally.done}，计划 ${tally.planned}，" + if (tally.need > 0) "还差 ${tally.need} 次" else "够了", 13.5.sp, Ink.muted)
                }
            }
            if (upcoming.isNotEmpty()) {
                Plain("考试", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                upcoming.take(2).forEach { exam -> val days = CampusLine.daysBetween(now.date, LocalDate.parse(exam.date)); examRow(exam, if (days == 0) "今天" else "$days 天后") }
                Row(Modifier.fillMaxWidth().topHairline(hairline).clickable { route.termMode = "exam" }.padding(vertical = 11.dp)) { Plain("全部 ${upcoming.size} 场和更新记录", 13.5.sp, Ink.muted) }
            }
            val ahead = (calendar?.holidays.orEmpty() + calendar?.events.orEmpty() + listOfNotNull(calendar?.pause)).filter { it.start >= now.date.toString() }.sortedBy { it.start }
            if (ahead.isNotEmpty()) {
                Plain("校历", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                ahead.forEach { item ->
                    val start = LocalDate.parse(item.start); val end = LocalDate.parse(item.end)
                    AheadRow("${CampusLine.daysBetween(now.date, start)} 天后", item.name, if (start == end) "${dateLabel(start)} ${WEEKDAYS[start.dayOfWeek.value]}" else "${dateLabel(start)} – ${dateLabel(end)}", null)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
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
                if (first != null) Plain("与${Names.courseShort(first.course.name)}时间冲突", 12.sp, marks().now, maxLines = 1)
                else Plain("${rows.first().teachers.joinToString(" ") { it.name }} · $slots", 12.sp, Ink.muted, maxLines = 1)
            }
            ActionButton("取消", onClick = onCancel)
            ActionButton(if (added) "已加入" else "加入课表", go = true, enabled = !added, onClick = onAdd)
        }
    }
}
