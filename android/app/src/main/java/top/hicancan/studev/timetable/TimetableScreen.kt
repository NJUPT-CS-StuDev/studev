package top.hicancan.studev.timetable

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.campus.*
import top.hicancan.studev.data.*
import top.hicancan.studev.ui.theme.Tokens
import java.time.LocalDate

internal data class CourseColours(val bg: Color, val border: Color, val fg: Color)
@Composable internal fun courseColours(index: Int, inactive: Boolean = false): CourseColours {
    val dark = MaterialTheme.colorScheme.background == Tokens.Color.Dark.paper
    if (inactive) return if (dark) Tokens.Color.Dark.let { CourseColours(it.surfaceSunken, it.line, it.muted) }
        else Tokens.Color.Light.let { CourseColours(it.surfaceSunken, it.line, it.muted) }
    val palette = if (dark) darkCourses else lightCourses
    return palette[index % palette.size]
}

@Composable internal fun TimetableScreen(state: AcademicState, klass: String?, requestedWeek: Int?, onClass: () -> Unit, onLesson: (TeachingMeeting) -> Unit) {
    val today = CampusDay.now().toLocalDate()
    val weeks = state.term!!.weeks
    var number by rememberSaveable(state.term.term, requestedWeek) { mutableIntStateOf(requestedWeek?.takeIf { n -> weeks.any { it.week == n } } ?: CampusDay.weekOf(weeks, today)?.week ?: 1) }
    var dayView by rememberSaveable { mutableStateOf(false) }
    var day by rememberSaveable { mutableIntStateOf(today.dayOfWeek.value) }
    val week = weeks.find { it.week == number } ?: weeks.first()
    val meetings = state.schedule?.meetings.orEmpty()
    val cells = remember(meetings, number) { TimetablePresentation.cells(meetings, number) }
    val byId = remember(meetings) { meetings.associateBy { it.id } }
    val days = if (dayView) listOf(day) else (1..7).toList()
    Column(Modifier.fillMaxSize().testTag("timetable")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClass) { Icon(Icons.Outlined.Groups, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(klass ?: "选择班级") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!dayView, { dayView = false }, { Text("周视图") }, modifier = Modifier.testTag("week-view"), colors = timetableChipColours())
                FilterChip(dayView, { dayView = true }, { Text("日视图") }, modifier = Modifier.testTag("day-view"), colors = timetableChipColours())
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ number = weeks.getOrNull(weeks.indexOf(week) - 1)?.week ?: number }, enabled = week != weeks.first()) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "上一周") }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("第${number}周", style = MaterialTheme.typography.titleLarge)
                Supporting("${week.start.substring(5).replace('-', '.')} — ${week.end.substring(5).replace('-', '.')}")
            }
            TextButton({ number = CampusDay.weekOf(weeks, today)?.week ?: 1 }) { Text("本周") }
            IconButton({ number = weeks.getOrNull(weeks.indexOf(week) + 1)?.week ?: number }, enabled = week != weeks.last()) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, "下一周") }
        }
        if (klass == null || state.schedule == null) {
            Box(Modifier.padding(20.dp)) { EmptyCard(if (klass == null) "先选好你的班级" else "暂无本学期课表", "选择班级后，按学校教学周显示课程。", "选择班级", onClass) }; return
        }
        if (dayView) Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            (1..7).forEach { d ->
                val date = LocalDate.parse(week.start).plusDays(d - 1L)
                FilterChip(day == d, { day = d }, { Text("${"一二三四五六日"[d - 1]}\n${date.dayOfMonth}", textAlign = TextAlign.Center, fontSize = 12.sp) }, modifier = Modifier.weight(1f).testTag("weekday-$d"), colors = timetableChipColours())
            }
        }
        Row(Modifier.fillMaxWidth()) {
            Spacer(Modifier.width(50.dp))
            days.forEach { d ->
                val date = LocalDate.parse(week.start).plusDays(d - 1L)
                Column(Modifier.weight(1f).padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("周${"一二三四五六日"[d - 1]}", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = if (date == today) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                    Text("${date.monthValue}/${date.dayOfMonth}", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        val rowHeight = 62.dp
        Row(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).testTag(if (dayView) "timetable-day" else "timetable-week")) {
            Column(Modifier.width(50.dp)) {
                state.periods.forEach { period -> Column(Modifier.height(rowHeight).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(period.period.toString(), fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    Text(period.start, fontSize = 9.sp, lineHeight = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(period.end, fontSize = 9.sp, lineHeight = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } }
            }
            days.forEach { d ->
                BoxWithConstraints(Modifier.weight(1f).height(rowHeight * state.periods.size).testTag("timetable-column-$d")) {
                    Column { state.periods.forEach { p ->
                        Box(Modifier.fillMaxWidth().height(rowHeight)) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            if (p.period in listOf(6,10)) Box(Modifier.fillMaxWidth().height(5.dp).background(MaterialTheme.colorScheme.surfaceContainerLow))
                        }
                    } }
                    cells.filter { it.day == d }.forEach { cell ->
                        val start = state.periods.indexOfFirst { it.period == cell.periods.first() }
                        val end = state.periods.indexOfFirst { it.period == cell.periods.last() }
                        val width = maxWidth / cell.columns
                        if (start >= 0 && end >= start) CourseCell(cell, dayView,
                            Modifier.offset(x = width * cell.slot, y = rowHeight * start).width(width).height(rowHeight * (end-start+1)).padding(horizontal = 1.dp, vertical = 5.dp),
                            { byId[cell.id]?.let(onLesson) })
                    }
                }
            }
        }
    }
}

@Composable private fun timetableChipColours() = FilterChipDefaults.filterChipColors(
    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
)

@Composable private fun CourseCell(cell: TimetableCell, dayView: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colours = courseColours(cell.colourIndex, cell.state != "active")
    val suspended = cell.state == "suspended"
    val small = !dayView && cell.columns > 1
    val dashed = suspended || cell.overlap.isNotEmpty()
    // The week grid can have two narrow columns in one day. Let its measured
    // interval width win; the day view gives the same items a full touch target.
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 0.dp) {
    Surface(onClick = onClick, modifier = modifier.testTag("lesson-${cell.id}").semantics {
        contentDescription = "${cell.course}，${cell.room}，第${cell.periods.first()}至${cell.periods.last()}节，${cell.label}，${cell.note}"
    }.drawWithContent {
        drawContent()
        drawRoundRect(colours.border, cornerRadius = CornerRadius(8.dp.toPx()), style = Stroke(1.dp.toPx(), pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(),3.dp.toPx())) else null))
    }, shape = RoundedCornerShape(8.dp), color = colours.bg, contentColor = colours.fg) {
        Column(Modifier.padding(horizontal = if (dayView) 10.dp else 2.dp, vertical = 5.dp), verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(cell.course, fontSize = if (dayView) 15.sp else if (small) 9.sp else 11.sp, lineHeight = if (dayView) 19.sp else if (small) 11.sp else 14.sp,
                fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, maxLines = if (dayView) 2 else if (small) 3 else 5, overflow = TextOverflow.Ellipsis,
                textDecoration = if (suspended) TextDecoration.LineThrough else TextDecoration.None)
            if (cell.room.isNotEmpty()) Text(cell.room, fontSize = if (dayView) 12.sp else if (small) 8.sp else 9.sp, lineHeight = if (dayView) 15.sp else 11.sp, maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
            if (cell.note.isNotEmpty()) Text(cell.note, fontSize = if (dayView) 12.sp else 9.sp, lineHeight = if (dayView) 15.sp else 11.sp, maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
            if (cell.label.isNotEmpty()) Text(cell.label, fontSize = if (dayView) 12.sp else 8.sp, lineHeight = if (dayView) 15.sp else 10.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
        }
    }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun LessonDetail(meeting: TeachingMeeting, periods: List<TeachingPeriod>, onClose: () -> Unit, onRoute: (String, Boolean) -> Unit) {
    val colours = courseColours(TimetablePresentation.colourIndex(meeting))
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 32.dp).testTag("lesson-detail"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Supporting("课程详情 · ${meeting.course.nature ?: "课程"}")
            Surface(color = colours.bg, contentColor = colours.fg, shape = MaterialTheme.shapes.medium) {
                Text(meeting.course.name, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.fillMaxWidth().padding(16.dp))
            }
            Text("周${"一二三四五六日"[meeting.weekday - 1]} · 第 ${meeting.periods.first()}–${meeting.periods.last()} 节", style = MaterialTheme.typography.titleMedium)
            Supporting("${periods.find { it.period == meeting.periods.first() }?.start.orEmpty()} — ${periods.find { it.period == meeting.periods.last() }?.end.orEmpty()}")
            HorizontalDivider()
            DetailLine("授课教师", meeting.teachers.joinToString("、") { it.name }.ifEmpty { "待公布" })
            DetailLine("上课地点", listOfNotNull(meeting.campus, meeting.location ?: meeting.room).joinToString(" · ").ifEmpty { "待公布" })
            TimetablePresentation.note(meeting).takeIf { it.isNotEmpty() }?.let { DetailLine("授课方式", it) }
            DetailLine("教学周", meeting.weeks.joinToString("、") + " 周")
            meeting.course.credits?.let { DetailLine("学分与考核", "$it 学分 · ${meeting.course.assessment ?: "待公布"}") }
            if (meeting.room != null) Button({ onRoute(meeting.room, false) }, Modifier.fillMaxWidth()) { Icon(Icons.AutoMirrored.Outlined.DirectionsWalk, null); Spacer(Modifier.width(8.dp)); Text("去这里 · ${meeting.room}") }
        }
    }
}
@Composable private fun DetailLine(title: String, text: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { Supporting(title); Text(text, style = MaterialTheme.typography.bodyLarge) }
}


private val lightCourses = listOf(
    Tokens.Course.Light.Tone0.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone1.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone2.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone3.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone4.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone5.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone6.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone7.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone8.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone9.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone10.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Light.Tone11.let { CourseColours(it.bg, it.border, it.fg) }
)

private val darkCourses = listOf(
    Tokens.Course.Dark.Tone0.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone1.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone2.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone3.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone4.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone5.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone6.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone7.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone8.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone9.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone10.let { CourseColours(it.bg, it.border, it.fg) },
    Tokens.Course.Dark.Tone11.let { CourseColours(it.bg, it.border, it.fg) }
)
