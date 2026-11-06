package top.hicancan.studev.app

import android.Manifest
import android.app.UiModeManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.account.PLATFORM_ORIGIN
import top.hicancan.studev.device.TimetableCalendar
import top.hicancan.studev.app.AcademicState
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.app.marks
import top.hicancan.studev.world.*

@Composable fun EventSheet(event: LineEvent, line: CampusLine, isMe: Boolean, route: Route, model: CampusModel, settings: PersonalSettings, onClose: () -> Unit) {
    val mark = marks()
    val date = event.date
    val whenText = "${WEEKDAYS[date.dayOfWeek.value]} ${dateLabel(date)} · ${hm(event.start)}–${hm(event.end)}"
    val plan = line.run
    if (event.kind == "run" && plan != null) {
        val place = plan.rule.xianlin
        PlainSheet("早锻炼", onClose) {
            Plain(whenText, 13.5.sp, Ink.muted)
            Row(Modifier.padding(top = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton(if (event.runMark == "done") "已记为跑过" else "记为跑过", modifier = Modifier.weight(1f)) { model.setRun { it.copy(runDays = it.runDays + (date.toString() to "done")) }; onClose() }
                if (place != null) ActionButton("去起点", go = true, modifier = Modifier.weight(1f)) { onClose(); route.map(nav = "仙林/${place.route[0]}") }
            }
            if (place != null) {
                KeyRow("路线", "${place.route.joinToString(" ↔ ")}，约 ${place.metres} 米")
                KeyRow("刷脸", "起点 ${place.start_scan_end} 前，终点 ${place.end_scan_end} 前", if (place.male_minutes == place.female_minutes) "${place.male_minutes} 分钟内，超时无效" else "男生 ${place.male_minutes} 分钟内，女生 ${place.female_minutes} 分钟内，超时无效")
            }
            KeyRow("次数", "${CampusLine.tally(plan).count} / ${plan.rule.required}", "编排整个学期", chevron = true, onClick = { onClose(); route.scale = "term"; route.running = true; route.tab = "timetable" })
        }
        return
    }
    PlainSheet(if (event.kind == "exam") "考试 · ${event.name}" else event.name, onClose) {
        val placed = Names.placed(event.room)
        val roomName = event.room?.let(Names::room)
        Plain(whenText + (roomName?.let { " · $it" } ?: " · 教室未排定"), 13.5.sp, Ink.muted)
        if (placed) Row(Modifier.padding(top = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionButton("在地图上看", modifier = Modifier.weight(1f)) { onClose(); route.map(place = event.room, at = date to event.start) }
            ActionButton("去这里", go = true, modifier = Modifier.weight(1f)) { onClose(); route.map(nav = event.room) }
        } else Spacer(Modifier.height(12.dp))
        if (placed) KeyRow("教室", "$roomName 的课表", chevron = true, onClick = { onClose(); route.timetable("room", event.room!!) })
        event.teachers.forEach { teacher -> KeyRow("老师", "$teacher 的课表", chevron = true, onClick = { onClose(); route.timetable("teacher", teacher) }) }
        KeyRow("课程", "这门课的全部时段", chevron = true, onClick = { onClose(); route.timetable("course", event.name) })
        if (isMe && event.kind == "exam") KeyRow(null, "不参加这场考试", color = mark.now, onClick = { model.examAttendance(event.id, false); onClose() })
        if (isMe && event.kind == "class") KeyRow(null, "从我的课表移除", color = mark.now, onClick = { model.removeCourse(event.meeting!!.teaching_class.id); onClose() })
    }
}

@Composable private fun Toggle(on: Boolean, onChange: (Boolean) -> Unit) = Switch(on, onChange, colors = SwitchDefaults.colors(checkedTrackColor = Ink.brand))

@Composable fun MeSheet(state: AcademicState, settings: PersonalSettings, model: CampusModel, now: Moment, route: Route, onPickClass: () -> Unit, onAccount: () -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val term = state.term
    val info = state.classes.find { it.id == settings.klass }
    val edits = term?.let { settings.timetableEdits(it.term) }
    val grade = if (term != null) CampusLine.grade(info?.grade, term) else null
    val runOn = settings.runShown ?: (grade != null && grade <= 2)
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }
    val calendarAccess = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result.values.all { it }) pending?.invoke() else model.tell("需要日历权限才能同步")
        pending = null
    }
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun withCalendar(action: () -> Unit) {
        if (TimetableCalendar.permitted(context)) action()
        else { pending = action; calendarAccess.launch(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)) }
    }
    PlainSheet("我", onClose) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            KeyRow("班级", listOfNotNull(settings.klass, info?.major).joinToString(" · ").ifEmpty { "还没有选" }, chevron = true, onClick = onPickClass)
            if (edits != null) KeyRow("改动", "加了 ${edits.added.size} 门，隐藏了 ${edits.hidden.size} 门", trailing = if (edits.added.size + edits.hidden.size > 0) ({ Chip("还原", { model.resetTimetableEdits() }) }) else null)
            Row(Modifier.fillMaxWidth().topHairline(Ink.line).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Plain("外观", 14.sp, Ink.muted, modifier = Modifier.width(80.dp))
                Choice(listOf("system" to "自动", "light" to "浅色", "dark" to "深色"), settings.theme) { next ->
                    model.settings.update { it.copy(theme = next) }
                    if (Build.VERSION.SDK_INT >= 31) context.getSystemService(UiModeManager::class.java).setApplicationNightMode(when (next) { "dark" -> UiModeManager.MODE_NIGHT_YES; "light" -> UiModeManager.MODE_NIGHT_NO; else -> UiModeManager.MODE_NIGHT_AUTO })
                    else (context as? android.app.Activity)?.recreate()
                }
            }
            KeyRow("账号", "登录和社团表单", chevron = true, onClick = { onClose(); onAccount() })
            state.run?.let { rule ->
                Plain("早锻炼", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
                KeyRow(null, "显示在课表上", if (grade != null && grade <= 2) "大${"一二"[grade - 1]}必做，本学期 ${rule.required} 次" else "大三大四需要补跑时打开", trailing = { Toggle(runOn) { on -> model.setRun { it.copy(runShown = on) } } })
                if (runOn) KeyRow(null, "编排早锻炼", "在学期视图里点选每一天，也能自动排好", chevron = true, onClick = { onClose(); route.timetable("me", "", "term"); route.running = true })
            }
            Plain("桌面小组件", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Plain("显示", 14.sp, Ink.muted, modifier = Modifier.width(80.dp))
                Choice(listOf("auto" to "随大小", "next" to "下一节", "day" to "今天", "week" to "本周"), settings.widgetView) { next -> model.settings.update { it.copy(widgetView = next) } }
            }
            KeyRow(null, "添加到桌面", "也可以长按桌面空白处，在窗口小工具里找 studev", chevron = true, onClick = {
                if (!top.hicancan.studev.widget.CampusWidget.pin(context, settings.widgetView)) model.tell("这台手机要从桌面添加：长按空白处，打开窗口小工具，找到 studev")
            })
            Plain("同步到手机日历", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
            fun set(change: (PersonalSettings) -> PersonalSettings) = withCalendar { model.setRun(change) }
            KeyRow(null, "studev 课表", "上课前 15 分钟提醒", trailing = { Toggle(settings.calendar) { on -> set { it.copy(calendar = on) } } })
            KeyRow(null, "studev 考表", "提前 1 天和 1 小时提醒", trailing = { Toggle(settings.calendarExams) { on -> set { it.copy(calendarExams = on) } } })
            state.run?.let { rule -> KeyRow(null, "studev 早锻炼", "只同步你计划跑的那些天，提前 30 分钟提醒", trailing = { Toggle(settings.calendarRun) { on -> withCalendar { set { it.copy(calendarRun = on) } } } }) }
            KeyRow(null, "studev 校历", "放假和校历日程，整天显示", trailing = { Toggle(settings.calendarSchool) { on -> set { it.copy(calendarSchool = on) } } })
            val background = remember(settings) { top.hicancan.studev.device.BackgroundSettings.status(context) }
            KeyRow(null, "后台导航", if (background.batteryExempt) "已允许，息屏也能继续导航；还可以打开自启动" else "允许后，息屏也能继续导航", chevron = true, onClick = {
                if (background.batteryExempt) top.hicancan.studev.device.BackgroundSettings.openOemStartup(context) else top.hicancan.studev.device.BackgroundSettings.requestBatteryExemption(context)
            })
            KeyRow(null, "检查数据更新", state.repository?.release?.data_version, chevron = true, onClick = { model.refresh() })
            KeyRow(null, "社团", "南邮计软网安学生发展中心", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/club/"))) })
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable fun ClassPickSheet(state: AcademicState, onPick: (String) -> Unit, onClose: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val hits = remember(query, state.classes) {
        val needle = query.trim().uppercase()
        if (needle.isEmpty()) emptyList() else state.classes.filter { "${it.name} ${it.major.orEmpty()}".uppercase().contains(needle) }.take(30)
    }
    PlainSheet("选择班级", onClose) {
        top.hicancan.studev.timetable.SearchField(query, "比如 B240402", Modifier.padding(top = 8.dp, bottom = 8.dp)) { query = it }
        Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
            hits.forEach { item -> KeyRow(null, item.name, listOfNotNull(item.major, item.campus).joinToString(" · "), onClick = { onPick(item.id); onClose() }) }
        }
    }
}
