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

// Keep the product shell entry points stable; feature implementation lives with its policy.
@Composable internal fun TimetableScreen(state: AcademicState, klass: String?, requestedWeek: Int?, onClass: () -> Unit, onLesson: (TeachingMeeting) -> Unit) =
    top.hicancan.studev.timetable.TimetableScreen(state, klass, requestedWeek, onClass, onLesson)
@Composable internal fun LessonDetail(meeting: TeachingMeeting, periods: List<TeachingPeriod>, onClose: () -> Unit, onRoute: (String, Boolean) -> Unit) =
    top.hicancan.studev.timetable.LessonDetail(meeting, periods, onClose, onRoute)
@Composable internal fun ExamsScreen(state: AcademicState, klass: String?, onClass: () -> Unit, onRoute: (String, Boolean) -> Unit) =
    top.hicancan.studev.exams.ExamsScreen(state, klass, onClass, onRoute)
