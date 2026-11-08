package top.hicancan.studev.timetable

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*
import top.hicancan.studev.device.TimetableCalendar
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.world.Exams

/** The timetable in the phone's calendar: four calendars kept up to date as the data and plans change. */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun CalendarSheet(state: AcademicState, settings: PersonalSettings, model: CampusModel, onClose: () -> Unit) {
    val context = LocalContext.current
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }
    val access = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result.values.all { it }) pending?.invoke() else model.tell("需要日历权限才能写入手机日历")
        pending = null
    }
    fun set(change: (PersonalSettings) -> PersonalSettings) {
        val action = { model.setRun(change) }
        if (TimetableCalendar.permitted(context)) action()
        else { pending = action; access.launch(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)) }
    }
    PlainSheet("写入手机日历", onClose) {
        Plain("每类是手机日历里单独的一个日历，可以分别设颜色和隐藏；课表和数据变了会跟着更新。", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
        KeyRow(null, "studev 课程", "上课前 15 分钟提醒", trailing = { Toggle(settings.calendar) { on -> set { it.copy(calendar = on) } } })
        KeyRow(null, "studev 考试", "按下面选的时间提醒", trailing = { Toggle(settings.calendarExams) { on -> set { it.copy(calendarExams = on) } } })
        if (state.run != null) KeyRow(null, "studev 早锻炼", "你排上的那些天，提前 30 分钟提醒", trailing = { Toggle(settings.calendarRun) { on -> set { it.copy(calendarRun = on) } } })
        KeyRow(null, "studev 校历", "放假和校历日程，整天显示", trailing = { Toggle(settings.calendarSchool) { on -> set { it.copy(calendarSchool = on) } } })
        Plain("考试提醒", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Exams.REMINDERS.forEach { (key, name) ->
                val on = key in settings.examReminders
                Surface({ set { current -> current.copy(examReminders = Exams.REMINDERS.map { it.first }.filter { (it == key) != (it in current.examReminders) }) } },
                    Modifier.heightIn(min = 32.dp), shape = RoundedCornerShape(8.dp), color = if (on) Ink.brand else Ink.paper, border = if (on) null else BorderStroke(1.dp, Ink.line)) {
                    Box(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) { Plain(name, 13.sp, if (on) androidx.compose.material3.MaterialTheme.colorScheme.onPrimary else Ink.text) }
                }
            }
        }
        Plain(if (settings.examReminders.isEmpty()) "不提醒" else "可以多选，一个都不选就不提醒", 12.sp, Ink.muted, modifier = Modifier.padding(top = 8.dp))
    }
}
