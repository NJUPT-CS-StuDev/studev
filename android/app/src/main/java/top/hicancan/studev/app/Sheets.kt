package top.hicancan.studev.app

import android.app.UiModeManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.account.PLATFORM_ORIGIN
import top.hicancan.studev.account.roleName
import top.hicancan.studev.app.AcademicState
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.app.marks
import top.hicancan.studev.world.*

/** Classes sitting or taught together, folded: "4 个班 · 102 人", open to see which. */
@Composable private fun Together(label: String, classes: List<String>, people: Int?) {
    if (classes.size < 2 && people == null) return
    var open by remember { mutableStateOf(false) }
    KeyRow(label, (if (classes.size > 1) "${classes.size} 个班" else classes.firstOrNull().orEmpty()) + (people?.let { " · $it 人" } ?: ""),
        if (open && classes.size > 1) classes.joinToString("、") else null, onClick = if (classes.size > 1) ({ open = !open }) else null)
}

private fun courseLine(course: top.hicancan.studev.data.Course?, assessment: Boolean) = course?.let {
    listOfNotNull(it.credits?.let { c -> "${if (c % 1.0 == 0.0) c.toInt().toString() else c.toString()} 学分" }, it.nature, it.assessment?.takeIf { assessment }?.let { a -> "考核：$a" }).joinToString(" · ")
}.orEmpty()

/** One thing on the timetable, wherever it was tapped: a lesson, an exam or 早锻炼. It says what matters
 *  for going there and preparing, and links on to the course, the people and the rest. */
@Composable fun EventSheet(event: LineEvent, line: CampusLine, isMe: Boolean, route: Route, model: CampusModel, settings: PersonalSettings, state: AcademicState, now: Moment, onOpen: (LineEvent) -> Unit, onClose: () -> Unit) {
    val mark = marks()
    val date = event.date
    val whenText = "${WEEKDAYS[date.dayOfWeek.value]} ${dateLabel(date)} · ${hm(event.start)}–${hm(event.end)}"
    val plan = line.run
    val classId = if (isMe) settings.klass else if (route.whoType == "class") route.whoId else null
    val record = top.hicancan.studev.timetable.examRecordOf(state, classId)
    if (event.kind == "run" && plan != null) {
        val place = plan.rule.xianlin
        PlainSheet("早锻炼", onClose) {
            Plain(whenText, 13.5.sp, Ink.muted)
            if (place != null) Row(Modifier.padding(top = 16.dp, bottom = 8.dp)) { ActionButton("去起点", go = true, modifier = Modifier.weight(1f)) { onClose(); route.map(nav = "仙林/${place.route[0]}") } }
            if (place != null) {
                KeyRow("路线", "${place.route.joinToString(" ↔ ")}，约 ${place.metres} 米")
                KeyRow("刷脸", "起点 ${place.start_scan_end} 前，终点 ${place.end_scan_end} 前", if (place.male_minutes == place.female_minutes) "${place.male_minutes} 分钟内跑完" else "男生 ${place.male_minutes} 分钟、女生 ${place.female_minutes} 分钟内跑完")
            }
            KeyRow("次数", "${CampusLine.tally(plan, now).count} / ${plan.rule.required}", "编排整个学期", chevron = true, onClick = { onClose(); route.scale = "term"; route.termMode = "run"; route.tab = "timetable" })
            KeyRow(null, "这天没跑", color = mark.danger, onClick = { model.setRun { it.copy(runDays = CampusLine.toggleRun(it.runDays, date)) }; onClose() })
        }
        return
    }
    val exam = event.exam
    PlainSheet(if (exam != null) "考试 · ${event.name}" else event.name, onClose) {
        val placed = Names.placed(event.room)
        val roomName = event.room?.let(Names::room)
        val facts = if (exam != null) Exams.courseOf(line.meetings, exam) else event.meeting?.course
        courseLine(facts, exam == null).takeIf { it.isNotEmpty() }?.let { Plain(it, 13.5.sp, Ink.muted) }
        val campus = state.classes.firstOrNull { it.id == classId }?.campus
        Plain(whenText + " · " + (roomName ?: exam?.location ?: "课表没写地点") + (exam?.campus?.takeIf { campus != null && it != campus }?.let { " · ${it}校区" } ?: ""), 13.5.sp, modifier = Modifier.padding(top = 2.dp))
        if (placed) Row(Modifier.padding(top = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionButton("在地图上看", modifier = Modifier.weight(1f)) { onClose(); route.map(place = event.room, at = date to event.start) }
            ActionButton("去这里", go = true, modifier = Modifier.weight(1f)) { onClose(); route.map(nav = event.room) }
        } else Spacer(Modifier.height(12.dp))
        if (exam != null) {
            Exams.changesOf(record, exam).forEach { change ->
                KeyRow(if (change.change == "added") "新发布" else "改过", "${dateLabel(java.time.LocalDate.parse(change.observed))} 发现", if (change.change == "changed") Exams.changeLines(change).joinToString("\n") else null)
            }
            Together("同考场", exam.classes, exam.students)
            exam.note?.let { KeyRow("备注", it) }
        }
        val meeting = event.meeting
        if (meeting != null) {
            val left = Exams.lessonsLeft(line.term, meeting, line.holidays, now, event.end)
            KeyRow("周次", Exams.weeksText(meeting.weeks), if (left > 0) "还剩 $left 次" else "已经上完")
            Together("合班", meeting.classes, meeting.teaching_class.size)
        }
        event.teachers.flatMap { it.split("、") }.forEach { teacher -> KeyRow("老师", "$teacher 的课表", chevron = true, onClick = { onClose(); route.timetable("teacher", teacher) }) }
        if (Names.isRoom(event.room)) KeyRow(if (exam != null) "考场" else "教室", "$roomName 的课表", chevron = true, onClick = { onClose(); route.timetable("room", event.room!!) })
        KeyRow("课程", "这门课的全部时段", chevron = true, onClick = { onClose(); route.timetable("course", event.name) })
        line.sharingSlot(event).forEach { other ->
            KeyRow("同时段", Names.course(other.course.name), "${Exams.weeksText(other.weeks)} · 本周不上", chevron = true, onClick = { line.meetingAround(other.id, event.date)?.let(onOpen) })
        }
        if (exam != null) {
            KeyRow("考试", "全部考试 · ${line.exams.map { it.course.code ?: it.course.name }.distinct().size} 门", chevron = true, onClick = { onClose(); route.tab = "timetable"; route.scale = "term"; route.termMode = "exam" })
            record?.sources?.firstOrNull { it.file == exam.source }?.let { sheet ->
                KeyRow("来源", Exams.sheetName(sheet.file), "${dateLabel(java.time.LocalDate.parse(Exams.publishedOn(sheet.file)))} 发布")
            }
        } else if (meeting != null) {
            val own = line.exams.filter { (it.course.code ?: it.course.name) == (meeting.course.code ?: meeting.course.name) }.minByOrNull { it.date }
            own?.let { found -> line.on(java.time.LocalDate.parse(found.date)).firstOrNull { it.exam?.id == found.id } }?.let { examEvent ->
                KeyRow("考试", "${dateLabel(examEvent.date)} ${WEEKDAYS[examEvent.date.dayOfWeek.value]} ${hm(examEvent.start)}", chevron = true, onClick = { onOpen(examEvent) })
            }
        }
        if (isMe && exam != null) KeyRow(null, "不参加这场考试", color = mark.danger, onClick = { model.examAttendance(event.id, false); onClose() })
        if (isMe && event.kind == "class") KeyRow(null, "从我的课表移除", color = mark.danger, onClick = { model.removeCourse(event.meeting!!.teaching_class.id); onClose() })
    }
}

@Composable fun MeSheet(state: AcademicState, settings: PersonalSettings, model: CampusModel, now: Moment, route: Route, onPickClass: () -> Unit, onAccount: () -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val term = state.term
    val info = state.classes.find { it.id == settings.klass }
    val edits = term?.let { settings.timetableEdits(it.term) }
    val grade = if (term != null) CampusLine.grade(info?.grade, term) else null
    val runOn = settings.runShown ?: (grade != null && grade <= 2)
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
            val account by top.hicancan.studev.account.Accounts.get(context).user.collectAsStateWithLifecycle()
            KeyRow("账号", account?.let { "${it.nickname} · ${it.roleName}" } ?: "未登录", chevron = true, onClick = { onClose(); onAccount() })
            state.run?.let { rule ->
                Plain("早锻炼", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
                KeyRow(null, "显示在课表上", if (grade != null && grade <= 2) "大${"一二"[grade - 1]}必做，本学期 ${rule.required} 次" else "大三大四需要补跑时打开", trailing = { Toggle(runOn) { on -> model.setRun { it.copy(runShown = on) } } })
            }
            Plain("桌面小组件", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Plain("显示", 14.sp, Ink.muted, modifier = Modifier.width(80.dp))
                Choice(listOf("auto" to "随大小", "next" to "下一节", "day" to "一天", "week" to "一周"), settings.widgetView) { next -> model.settings.update { it.copy(widgetView = next) } }
            }
            KeyRow(null, "添加到桌面", "也可以长按桌面空白处，在窗口小工具里找 studev", chevron = true, onClick = {
                if (!top.hicancan.studev.widget.CampusWidget.pin(context, settings.widgetView)) model.tell("这台手机要从桌面添加：长按空白处，打开窗口小工具，找到 studev")
            })
            val background = remember(settings) { top.hicancan.studev.device.BackgroundSettings.status(context) }
            KeyRow(null, "后台导航", if (background.batteryExempt) "已允许，息屏也能继续导航；还可以打开自启动" else "允许后，息屏也能继续导航", chevron = true, onClick = {
                if (background.batteryExempt) top.hicancan.studev.device.BackgroundSettings.openOemStartup(context) else top.hicancan.studev.device.BackgroundSettings.requestBatteryExemption(context)
            })
            KeyRow(null, "检查更新", (if (state.appBehind) "有新版本 ${state.app!!.versionName} · " else "") + "App ${top.hicancan.studev.BuildConfig.VERSION_NAME} · 数据 ${state.repository?.release?.data_version.orEmpty()}", chevron = true, onClick = { model.refresh() })
            KeyRow(null, "分享 studev", PLATFORM_ORIGIN.removePrefix("https://"), chevron = true, onClick = {
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "$PLATFORM_ORIGIN/"), "分享 studev"))
            })
            KeyRow(null, "学生发展中心", "南邮计软网安", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/club/"))) })
            KeyRow(null, "用户协议", "服务条款与免责声明", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/terms/"))) })
            KeyRow(null, "隐私政策", "个人信息保护与权限说明", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/privacy/"))) })
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
