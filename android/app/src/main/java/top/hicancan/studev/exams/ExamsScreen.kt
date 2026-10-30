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

@Composable internal fun ExamsScreen(state: AcademicState, klass: String?, onClass: () -> Unit, onRoute: (String, Boolean) -> Unit) {
    val now = CampusDay.now()
    val published = state.exams
    val future = published.filter { examPresentation(it, now.toInstant()).state in listOf("upcoming", "ongoing", "unknown") }
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
                FilterChip(history, { history = true }, { Text("全部 ${published.size}") })
            } }
            if ((if (history) published else future).isEmpty()) item { EmptyCard("暂无${if (history) "已发布" else "待考"}科目", "考试安排以学校最新通知为准。") }
            items(if (history) published else future, key = { it.id }) { exam ->
                val cell = examPresentation(exam, now.toInstant())
                OutlinedCard(Modifier.fillMaxWidth().testTag("exam-${exam.id}")) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(exam.date, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                            Supporting(cell.countdown)
                        }
                        Text(exam.course.name, style = MaterialTheme.typography.titleMedium)
                        Text("${exam.start} — ${exam.end} · ${cell.duration} 分钟", style = MaterialTheme.typography.bodyMedium)
                        Supporting(listOfNotNull(exam.campus, cell.room, exam.teacher).joinToString(" · "))
                        exam.note?.takeIf { it.isNotBlank() }?.let { Supporting(it) }
                        exam.room?.let { room -> TextButton({ onRoute(room, false) }, contentPadding = PaddingValues(0.dp)) { Icon(Icons.AutoMirrored.Outlined.DirectionsWalk, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("去这里 · $room") } }
                    }
                }
            }
        }
        item { Supporting("数据版本 ${state.repository?.release?.version.orEmpty()}\n如有调整，请以学校最新通知为准。") }
    }
}
