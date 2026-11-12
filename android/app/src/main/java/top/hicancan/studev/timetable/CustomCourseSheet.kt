package top.hicancan.studev.timetable

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*
import top.hicancan.studev.me.TimetableEdits
import top.hicancan.studev.world.*

/**
 * Courses of one's own, as src/campus/timetable/CustomCourses.tsx: what the teaching office's timetable does not have
 * (an elective it misses, a practical that takes a week), added by hand and kept on this device.
 */
@Composable fun CustomCourseSheet(edits: TimetableEdits, weeks: Int, periods: Int, model: CampusModel, onClose: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var days by remember { mutableStateOf(listOf(1)) }
    var from by remember { mutableIntStateOf(1) }
    var to by remember { mutableIntStateOf(2) }
    var weekText by remember { mutableStateOf("1-$weeks") }
    var room by remember { mutableStateOf("") }
    val parsed = Courses.parseWeeks(weekText, weeks)
    val ready = name.isNotBlank() && days.isNotEmpty() && parsed != null && from <= to
    fun add() {
        if (!ready) return
        model.saveCustomCourse(CustomCourse(java.util.UUID.randomUUID().toString(), name.trim(), days.sorted(), listOf(from, to), parsed!!, room.trim().ifEmpty { null }))
        name = ""; room = ""
    }
    PlainSheet("自己的课", onClose) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Plain("教务课表里没有的课：任选课、实验、占一整周的实习。加在这里的课和其他课一样显示、提醒、写进日历，只存在本机。", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
            edits.custom.forEach { course ->
                KeyRow(null, course.name, "${course.days.joinToString("、") { WEEKDAYS[it] }} ${if (course.periods[0] == course.periods[1]) "第 ${course.periods[0]} 节" else "${course.periods[0]}–${course.periods[1]} 节"} · ${Exams.weeksText(course.weeks)}${course.room?.let { " · $it" } ?: ""}",
                    trailing = { Chip("删除", { model.removeCourse("custom:${course.id}") }) })
            }
            Plain("加一门", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
            Field(name, "课名，如：金工实习", Modifier.padding(bottom = 8.dp)) { name = it.take(60) }
            Picks((1..7).map { it to WEEKDAYS[it] }, { it in days }) { day -> days = if (day in days) days - day else days + day }
            Plain("从第几节", 13.sp, Ink.muted)
            Picks((1..periods).map { it to "$it" }, { it == from }) { from = it; if (to < it) to = it }
            Plain("到第几节", 13.sp, Ink.muted)
            Picks((from..periods).map { it to "$it" }, { it == to }) { to = it }
            Plain("周次（如 1-16、单1-15、3,5,7）", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
            Field(weekText, "1-$weeks", Modifier.padding(bottom = 8.dp)) { weekText = it.take(60) }
            if (parsed == null) Plain("周次写不出来，例如 1-16 或 单1-15。", 13.sp, marks().danger, modifier = Modifier.padding(bottom = 8.dp))
            Plain("地点（可不填）", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
            Field(room, "如：工程训练中心", Modifier.padding(bottom = 12.dp), onDone = ::add) { room = it.take(60) }
            ActionButton("加上", go = true, enabled = ready, modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)) { add() }
        }
    }
}
