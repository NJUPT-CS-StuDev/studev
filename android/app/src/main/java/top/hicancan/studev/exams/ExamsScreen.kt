package top.hicancan.studev.exams

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

import top.hicancan.studev.campus.*

@Composable internal fun ExamsScreen(state: AcademicState, klass: String?, onClass: () -> Unit, onRoute: (String, Boolean) -> Unit, campus: CampusPackage? = null,
                                    choices: Map<String, Boolean> = emptyMap(), onAttendance: (String, Boolean) -> Unit = { _, _ -> }) {
    val now = CampusDay.now()
    val published = state.exams
    val selected = ExamAttendance.select(published, choices, state.repository?.let { ExamAttendance.ownCodes(it.release, state.schedule) })
    val selectedIds = selected.mapTo(mutableSetOf()) { it.id }
    val excluded = published.filter { it.id !in selectedIds }
    val future = selected.filter { examPresentation(it, now.toInstant()).state in listOf("upcoming", "ongoing", "unknown") }
    var history by rememberSaveable { mutableStateOf(future.isEmpty()) }
    var showExcluded by rememberSaveable { mutableStateOf(false) }
    val visible = if (showExcluded) excluded else if (history) selected else future
    LazyColumn(Modifier.fillMaxSize().testTag("exams"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column { Text("考试安排", style = MaterialTheme.typography.headlineSmall); Supporting(state.repository?.release?.exams ?: "暂无考试安排") }
                TextButton(onClass) { Text(klass ?: "选择班级") }
            }
        }
        if (klass == null) item { EmptyCard("先选好你的班级", "按班级查看学校已发布的考试安排。", "选择班级", onClass) }
        else {
            if (state.repository?.release?.exams != state.term?.term) item {
                EmptyCard("当前显示历史考试安排", "${state.repository?.release?.exams.orEmpty()} 学期 · 本学期安排公布后会自动更新。")
            }
            item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!history && !showExcluded, { history = false; showExcluded = false }, { Text("待考 ${future.size}") })
                FilterChip(history && !showExcluded, { history = true; showExcluded = false }, { Text("我的考试 ${selected.size}") }, modifier = Modifier.testTag("exams-attending"))
                FilterChip(showExcluded, { showExcluded = true }, { Text("已排除 ${excluded.size}") }, modifier = Modifier.testTag("exams-excluded"))
            } }
            if (visible.isEmpty()) item { EmptyCard(if (showExcluded) "没有排除的考试" else "暂无${if (history) "已选" else "待考"}科目", if (showExcluded) "不参加的考试会保留在这里，随时可以恢复。" else "可在「已排除」中恢复考试；安排以学校最新通知为准。") }
            items(visible, key = { it.id }) { exam ->
                val cell = examPresentation(exam, now.toInstant())
                OutlinedCard(Modifier.fillMaxWidth().testTag("exam-${exam.id}")) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(exam.date, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                            Supporting(cell.countdown)
                        }
                        Text(exam.course.name, style = MaterialTheme.typography.titleMedium)
                        Text("${exam.start} — ${exam.end} · ${cell.duration} 分钟", style = MaterialTheme.typography.bodyMedium)
                        Supporting(listOfNotNull(exam.campus, roomDisplayName(cell.room, campus?.byId ?: emptyMap()), exam.teacher).joinToString(" · "))
                        exam.note?.takeIf { it.isNotBlank() }?.let { Supporting(it) }
                        exam.room?.let { room -> TextButton({ onRoute(room, false) }, contentPadding = PaddingValues(0.dp)) { Icon(Icons.AutoMirrored.Outlined.DirectionsWalk, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("去这里 · ${roomDisplayName(room, campus?.byId ?: emptyMap())}") } }
                        TextButton({ onAttendance(exam.id, exam.id !in selectedIds) }, modifier = Modifier.testTag("exam-attendance-${exam.id}"), contentPadding = PaddingValues(0.dp)) {
                            Icon(if (exam.id in selectedIds) Icons.Outlined.EventBusy else Icons.Outlined.EventAvailable, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(if (exam.id in selectedIds) "不参加这场考试" else "恢复参加")
                        }
                    }
                }
            }
        }
        item { Supporting("参加选择按学期和班级保存在此设备，日历、提醒和桌面组件会一起更新。\n如有调整，请以学校最新通知为准。") }
    }
}
