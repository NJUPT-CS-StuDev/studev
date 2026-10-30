package top.hicancan.studev.campus

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.testTag
import top.hicancan.studev.data.*
import top.hicancan.studev.timetable.*
import java.time.*
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

@Composable internal fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp))
}
@Composable internal fun Supporting(text: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}
@Composable internal fun EmptyCard(title: String, text: String, action: String? = null, onAction: () -> Unit = {}) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium); Supporting(text)
            if (action != null) FilledTonalButton(onAction) { Text(action) }
        }
    }
}
@Composable internal fun EventCard(event: CampusEvent, onClick: () -> Unit, onRoute: (String, Boolean) -> Unit) {
    OutlinedCard(onClick, Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.width(54.dp)) {
                Text(event.start.atZone(CampusDay.zone).format(DateTimeFormatter.ofPattern("HH:mm")), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                Supporting(event.end.atZone(CampusDay.zone).format(DateTimeFormatter.ofPattern("HH:mm")))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(event.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
                Supporting(event.room ?: event.location ?: "地点待定")
            }
            if (event.room != null) IconButton({ onRoute(event.room, false) }) { Icon(Icons.AutoMirrored.Outlined.DirectionsWalk, "去这里 ${event.room}") }
        }
    }
}
@Composable internal fun CampusHome(state: AcademicState, klass: String?, now: ZonedDateTime, walk: Int?, locationGranted: Boolean,
    onLocation: () -> Unit, onClass: () -> Unit, onScreen: (String) -> Unit, onLesson: (TeachingMeeting) -> Unit, onRoute: (String, Boolean) -> Unit) {
    val next = state.events.firstOrNull { !it.exam && it.start > now.toInstant() }
    val today = state.events.filter { !it.exam && it.start.atZone(CampusDay.zone).toLocalDate() == now.toLocalDate() && it.end > now.toInstant() }
    val exams = state.events.filter { it.exam && it.end > now.toInstant() }.take(2)
    LazyColumn(Modifier.fillMaxSize().testTag("home"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Supporting("${now.format(DateTimeFormatter.ofPattern("M月d日"))} · 星期${"一二三四五六日"[now.dayOfWeek.value - 1]} · ${CampusDay.weekOf(state.term!!.weeks, now.toLocalDate())?.let { "第 ${it.week} 周" } ?: "学期之外"}")
            Text("校园，井井有条", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.padding(top = 8.dp))
        }
        item {
            OutlinedCard({ onScreen("search") }, Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Outlined.Search, null, tint = MaterialTheme.colorScheme.primary)
                    Text("搜索通知、资料、课程与地点", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                listOf("rooms" to "空教室", "exams" to "考试安排", "timetable" to "我的课表").forEach { (key, title) ->
                    Card({ onScreen(key) }, Modifier.weight(1f), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(when (key) { "rooms" -> Icons.Outlined.MeetingRoom; "exams" -> Icons.AutoMirrored.Outlined.Assignment; else -> Icons.Outlined.CalendarMonth }, null, tint = MaterialTheme.colorScheme.primary)
                            Text(title, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
        item {
            if (klass == null) EmptyCard("从你的班级开始", "选好班级，下一节课、今日课程和考试都会出现在这里。", "选择班级", onClass)
            else if (next == null) EmptyCard("接下来没有课程", "${klass} · 已发布课表中暂无后续课程。", "查看课表", { onScreen("timetable") })
            else Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("下一节课", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        Text(next.start.atZone(CampusDay.zone).format(DateTimeFormatter.ofPattern(if (next.start.atZone(CampusDay.zone).toLocalDate() == now.toLocalDate()) "今天 HH:mm" else "M月d日 HH:mm")), style = MaterialTheme.typography.labelLarge)
                    }
                    Text(next.title, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Outlined.Place, null, modifier = Modifier.size(18.dp)); Text(next.room ?: next.location ?: "地点待定", style = MaterialTheme.typography.bodyMedium)
                    }
                    if (walk != null) Text("从我的位置步行约 $walk 分钟", style = MaterialTheme.typography.bodySmall)
                    else if (!locationGranted) TextButton(onLocation, contentPadding = PaddingValues(0.dp)) { Text("开启定位，查看步行时间") }
                    else Supporting("获得校园内的位置后显示步行时间")
                    if (next.room != null) Button({ onRoute(next.room, true) }, Modifier.fillMaxWidth()) {
                        Icon(Icons.AutoMirrored.Outlined.DirectionsWalk, null, Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)); Text("现在出发")
                    }
                }
            }
        }
        if (klass != null) {
            item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) { SectionLabel("今天还有 ${today.size} 节课"); TextButton({ onScreen("timetable") }) { Text("完整课表") } } }
            if (today.isEmpty()) item { Supporting("今天的课程已结束，留点时间给自己。") }
            items(today, key = { it.id }) { event -> EventCard(event, {
                state.schedule?.meetings?.find { event.id.contains(":${it.id}:") }?.let(onLesson)
            }, onRoute) }
            item { SectionLabel("近期考试") }
            if (exams.isEmpty()) item { EmptyCard("暂无待考科目", "${state.repository?.release?.exams ?: "考试"} · 以学校最新通知为准。", "查看已发布考试", { onScreen("exams") }) }
            items(exams, key = { it.id }) { event -> EventCard(event, { onScreen("exams") }, onRoute) }
        }
        item { Supporting("${klass ?: "尚未选择班级"} · 离线可用", Modifier.padding(vertical = 12.dp)) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun ClassPicker(state: AcademicState, onChoose: (String) -> Unit, onClose: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val choices = (state.classes.map { it.id } + state.examClasses).distinct()
    val shown = remember(query, choices) { choices.filter { it.contains(query.trim(), ignoreCase = true) }.take(60) }
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
            Text("选择你的班级", style = MaterialTheme.typography.headlineSmall)
            Supporting("课表和考试会使用这个班级", Modifier.padding(vertical = 8.dp))
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().testTag("class-query"), singleLine = true, label = { Text("班级名称，如 B240402") }, leadingIcon = { Icon(Icons.Outlined.Search, null) })
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp), contentPadding = PaddingValues(vertical = 12.dp)) {
                items(shown, key = { it }) { id ->
                    val entry = state.classes.find { it.id == id }
                    ListItem(headlineContent = { Text(id) }, supportingContent = { Text(listOfNotNull(entry?.college, entry?.major).joinToString(" · ").ifEmpty { "已发布考试的班级" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        modifier = Modifier.clickable { onChoose(id) }.testTag("class-$id"), trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null) })
                }
                if (shown.isEmpty()) item { Supporting("没有找到这个班级，请检查输入。", Modifier.padding(16.dp)) }
            }
        }
    }
}

@Composable internal fun TimetableScreen(state: AcademicState, klass: String?, requestedWeek: Int?, onClass: () -> Unit, onLesson: (TeachingMeeting) -> Unit) {
    val today = CampusDay.now().toLocalDate()
    val weeks = state.term!!.weeks
    var number by rememberSaveable(state.term.term, requestedWeek) { mutableIntStateOf(requestedWeek?.takeIf { n -> weeks.any { it.week == n } } ?: CampusDay.weekOf(weeks, today)?.week ?: 1) }
    var dayView by rememberSaveable { mutableStateOf(false) }
    var day by rememberSaveable { mutableIntStateOf(today.dayOfWeek.value) }
    val week = weeks.find { it.week == number } ?: weeks.first()
    val meetings = state.schedule?.meetings.orEmpty().filter { number in it.weeks }
    Column(Modifier.fillMaxSize().testTag("timetable")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClass) { Icon(Icons.Outlined.Groups, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(klass ?: "选择班级") }
            Row {
                FilterChip(!dayView, { dayView = false }, { Text("周视图") }, modifier = Modifier.testTag("week-view"))
                Spacer(Modifier.width(8.dp)); FilterChip(dayView, { dayView = true }, { Text("日视图") }, modifier = Modifier.testTag("day-view"))
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ number = weeks.getOrNull(weeks.indexOf(week) - 1)?.week ?: number }, enabled = week != weeks.first()) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "上一周") }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("第 $number 周", style = MaterialTheme.typography.titleLarge)
                Supporting("${week.start.substring(5).replace('-', '.')} — ${week.end.substring(5).replace('-', '.')}")
            }
            TextButton({ number = CampusDay.weekOf(weeks, today)?.week ?: 1 }) { Text("本周") }
            IconButton({ number = weeks.getOrNull(weeks.indexOf(week) + 1)?.week ?: number }, enabled = week != weeks.last()) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, "下一周") }
        }
        if (klass == null || state.schedule == null) {
            Box(Modifier.padding(20.dp)) { EmptyCard(if (klass == null) "先选好你的班级" else "暂无本学期课表", "选择班级后，按学校教学周显示课程。", "选择班级", onClass) }; return
        }
        if (dayView) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                (1..7).forEach { d ->
                    val date = LocalDate.parse(week.start).plusDays(d - 1L)
                    FilterChip(day == d, { day = d }, { Text("${"一二三四五六日"[d - 1]}\n${date.dayOfMonth}", style = MaterialTheme.typography.labelMedium) })
                }
            }
            val entries = meetings.filter { it.weekday == day }.sortedBy { it.periods.first() }
            LazyColumn(Modifier.weight(1f).testTag("timetable-day"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (entries.isEmpty()) item { EmptyCard("这天没有课", "可以安排自习，也可以好好休息。") }
                items(entries, key = { it.id }) { meeting -> LessonCard(meeting, state.periods, onLesson) }
            }
        } else {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                Spacer(Modifier.width(36.dp))
                (1..7).forEach { d ->
                    val date = LocalDate.parse(week.start).plusDays(d - 1L)
                    val current = date == today
                    Surface(Modifier.weight(1f).padding(2.dp), shape = MaterialTheme.shapes.small, color = if (current) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface) {
                        Column(Modifier.padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("周${"一二三四五六日"[d - 1]}", style = MaterialTheme.typography.labelSmall)
                            Text("${date.dayOfMonth}", style = MaterialTheme.typography.titleSmall, color = if (current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
            }
            val rowHeight = 54.dp
            Row(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 8.dp).testTag("timetable-week")) {
                Column(Modifier.width(36.dp)) {
                    state.periods.forEach { period -> Column(Modifier.height(rowHeight).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Text(period.period.toString(), style = MaterialTheme.typography.labelSmall)
                        Text(period.start, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } }
                }
                (1..7).forEach { d ->
                    BoxWithConstraints(Modifier.weight(1f).height(rowHeight * state.periods.size)) {
                        Column { state.periods.forEach { _ -> Box(Modifier.fillMaxWidth().height(rowHeight).padding(horizontal = 2.dp, vertical = 1.dp).background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(4.dp))) } }
                        val daily = meetings.filter { it.weekday == d }
                        daily.forEach { meeting ->
                            val start = state.periods.indexOfFirst { it.period == meeting.periods.first() }
                            val end = state.periods.indexOfFirst { it.period == meeting.periods.last() }
                            val overlap = daily.filter { it.periods.first() == meeting.periods.first() }
                            val width = maxWidth / overlap.size.coerceAtLeast(1)
                            if (start >= 0 && end >= start) Surface(onClick = { onLesson(meeting) }, modifier = Modifier.offset(x = width * overlap.indexOf(meeting).coerceAtLeast(0), y = rowHeight * start)
                                .width(width).height(rowHeight * (end - start + 1)).padding(2.dp).testTag("lesson-${meeting.id}"),
                                shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                                Column(Modifier.padding(horizontal = 3.dp, vertical = 5.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(meeting.course.name, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium, maxLines = ((end - start + 1) * 3 - 1).coerceAtLeast(2), overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onPrimaryContainer)
                                    Text(meeting.room ?: meeting.location.orEmpty(), fontSize = 9.sp, lineHeight = 12.sp, maxLines = 2, color = MaterialTheme.colorScheme.onPrimaryContainer)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
@Composable private fun LessonCard(meeting: TeachingMeeting, periods: List<TeachingPeriod>, onLesson: (TeachingMeeting) -> Unit) {
    OutlinedCard({ onLesson(meeting) }, Modifier.fillMaxWidth().testTag("lesson-${meeting.id}")) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${periods.find { it.period == meeting.periods.first() }?.start.orEmpty()} — ${periods.find { it.period == meeting.periods.last() }?.end.orEmpty()} · 第 ${meeting.periods.first()}–${meeting.periods.last()} 节", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Text(meeting.course.name, style = MaterialTheme.typography.titleMedium)
            Supporting(listOf(meeting.room ?: meeting.location ?: "地点待定", meeting.teachers.joinToString("、") { it.name }).filter { it.isNotEmpty() }.joinToString(" · "))
        }
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun LessonDetail(meeting: TeachingMeeting, periods: List<TeachingPeriod>, onClose: () -> Unit, onRoute: (String, Boolean) -> Unit) {
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 32.dp).testTag("lesson-detail"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Supporting("课程详情 · ${meeting.course.nature ?: "课程"}")
            Text(meeting.course.name, style = MaterialTheme.typography.headlineSmall)
            Text("周${"一二三四五六日"[meeting.weekday - 1]} · 第 ${meeting.periods.first()}–${meeting.periods.last()} 节", style = MaterialTheme.typography.titleMedium)
            Supporting("${periods.find { it.period == meeting.periods.first() }?.start.orEmpty()} — ${periods.find { it.period == meeting.periods.last() }?.end.orEmpty()}")
            HorizontalDivider()
            DetailLine("授课教师", meeting.teachers.joinToString("、") { it.name }.ifEmpty { "待公布" })
            DetailLine("上课地点", listOfNotNull(meeting.campus, meeting.location ?: meeting.room).joinToString(" · ").ifEmpty { "待公布" })
            DetailLine("教学周", meeting.weeks.joinToString("、") + " 周")
            meeting.course.credits?.let { DetailLine("学分与考核", "$it 学分 · ${meeting.course.assessment ?: "待公布"}") }
            if (meeting.room != null) Button({ onRoute(meeting.room, false) }, Modifier.fillMaxWidth()) { Icon(Icons.AutoMirrored.Outlined.DirectionsWalk, null); Spacer(Modifier.width(8.dp)); Text("去这里 · ${meeting.room}") }
        }
    }
}
@Composable private fun DetailLine(title: String, text: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { Supporting(title); Text(text, style = MaterialTheme.typography.bodyLarge) }
}

@Composable internal fun ExamsScreen(state: AcademicState, klass: String?, onClass: () -> Unit, onRoute: (String, Boolean) -> Unit) {
    val now = CampusDay.now()
    val sorted = state.exams.sortedWith(compareBy<Exam> { it.date }.thenBy { it.start })
    val future = sorted.filter { LocalDate.parse(it.date).atTime(LocalTime.parse(it.end)).atZone(CampusDay.zone) > now }
    var history by rememberSaveable { mutableStateOf(future.isEmpty()) }
    LazyColumn(Modifier.fillMaxSize().testTag("exams"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column { Text("考试安排", style = MaterialTheme.typography.headlineSmall); Supporting(state.repository?.release?.exams ?: "暂无考试安排") }
                TextButton(onClass) { Text(klass ?: "选择班级") }
            }
        }
        if (klass == null) item { EmptyCard("先选好你的班级", "按班级查看学校已发布的考试安排。", "选择班级", onClass) }
        else {
            item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!history, { history = false }, { Text("待考 ${future.size}") })
                FilterChip(history, { history = true }, { Text("全部 ${sorted.size}") })
            } }
            if ((if (history) sorted else future).isEmpty()) item { EmptyCard("暂无${if (history) "已发布" else "待考"}科目", "考试安排以学校最新通知为准。") }
            items(if (history) sorted else future, key = { it.id }) { exam ->
                val days = ChronoUnit.DAYS.between(now.toLocalDate(), LocalDate.parse(exam.date))
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(exam.date, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                            Supporting(if (days > 0) "还有 $days 天" else if (days == 0L) "今天" else "已结束")
                        }
                        Text(exam.course.name, style = MaterialTheme.typography.titleMedium)
                        Text("${exam.start} — ${exam.end}", style = MaterialTheme.typography.bodyMedium)
                        Supporting(listOfNotNull(exam.campus, exam.location ?: exam.room, exam.teacher).joinToString(" · "))
                        exam.note?.takeIf { it.isNotBlank() }?.let { Supporting(it) }
                        exam.room?.let { room -> TextButton({ onRoute(room, false) }, contentPadding = PaddingValues(0.dp)) { Icon(Icons.AutoMirrored.Outlined.DirectionsWalk, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("去这里 · $room") } }
                    }
                }
            }
        }
        item { Supporting("数据版本 ${state.repository?.release?.version.orEmpty()}\n如有调整，请以学校最新通知为准。") }
    }
}
