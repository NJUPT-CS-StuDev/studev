package top.hicancan.studev.timetable

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import top.hicancan.studev.app.*
import top.hicancan.studev.world.*

/**
 * Courses of one's own, as src/campus/timetable/CustomCourses.tsx: what the teaching office's timetable does not have
 * (an elective it misses, a practical that takes a week), added by hand alongside the published timetable.
 */
@Composable fun CustomCourseSheet(weeks: Int, periods: Int, model: CampusModel, course: CustomCourse? = null, onClose: () -> Unit) {
    var name by remember(course?.id) { mutableStateOf(course?.name.orEmpty()) }
    var days by remember(course?.id) { mutableStateOf(course?.days ?: listOf(1)) }
    var from by remember(course?.id) { mutableIntStateOf(course?.periods?.firstOrNull() ?: 1) }
    var to by remember(course?.id) { mutableIntStateOf(course?.periods?.lastOrNull() ?: minOf(2, periods)) }
    var weekText by remember(course?.id) { mutableStateOf(course?.weeks?.joinToString(",") ?: "1-$weeks") }
    var room by remember(course?.id) { mutableStateOf(course?.room.orEmpty()) }
    var teacher by remember(course?.id) { mutableStateOf(course?.teacher.orEmpty()) }
    val parsed = Courses.parseWeeks(weekText, weeks)
    val ready = name.isNotBlank() && days.isNotEmpty() && parsed != null && from <= to
    fun add() {
        if (!ready) return
        model.saveCustomCourse(CustomCourse(course?.id ?: java.util.UUID.randomUUID().toString(), name.trim(), days.sorted(), listOf(from, to), parsed!!, room.trim().ifEmpty { null }, teacher.trim().ifEmpty { null }))
        onClose()
    }
    PlainSheet(if (course == null) "添加自定义课程" else "编辑课程", onClose) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Plain("记录课表里没有的课程或实习，按所选的教学周和节次显示。", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 12.dp))
            Plain("课程名称", 13.sp, Ink.muted)
            Field(name, "课名，如：金工实习", Modifier.padding(bottom = 8.dp).semantics { contentDescription = "课程名称" }) { name = it.take(60) }
            Picks((1..7).map { it to WEEKDAYS[it] }, { it in days }) { day -> days = if (day in days) days - day else days + day }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PeriodChoice("开始节次", from, 1..periods, Modifier.weight(1f)) { from = it; if (to < it) to = it }
                PeriodChoice("结束节次", to, from..periods, Modifier.weight(1f)) { to = it }
            }
            Plain("周次（如 1-16、单1-15、3,5,7）", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
            Field(weekText, "1-$weeks", Modifier.padding(bottom = 8.dp).semantics { contentDescription = "教学周" }) { weekText = it.take(120) }
            if (parsed == null) Plain("请填写有效周次，例如 1-$weeks。", 13.sp, marks().danger, modifier = Modifier.padding(bottom = 8.dp))
            Plain("地点（可不填）", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
            Field(room, "如：工程训练中心", Modifier.padding(bottom = 8.dp).semantics { contentDescription = "地点" }) { room = it.take(60) }
            Plain("教师（可不填）", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
            Field(teacher, "教师姓名", Modifier.padding(bottom = 12.dp).semantics { contentDescription = "教师" }, onDone = ::add) { teacher = it.take(40) }
            Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp, androidx.compose.ui.Alignment.End), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                TextAction("取消", onClose, muted = true)
                ActionButton(if (course == null) "添加课程" else "保存修改", go = true, enabled = ready) { add() }
            }
        }
    }
}

@Composable private fun PeriodChoice(label: String, selected: Int, choices: IntRange, modifier: Modifier, onSelect: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(modifier) {
        Plain(label, 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
        Box {
            Chip("第 $selected 节 ▾", { open = true }, Modifier.fillMaxWidth().semantics { contentDescription = label })
            DropdownMenu(open, { open = false }, containerColor = Ink.paper) {
                choices.forEach { value -> DropdownMenuItem(text = { Plain("第 $value 节", 14.sp) }, onClick = { onSelect(value); open = false }) }
            }
        }
    }
}
