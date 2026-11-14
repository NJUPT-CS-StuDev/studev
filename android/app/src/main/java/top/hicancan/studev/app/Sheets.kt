package top.hicancan.studev.app

import android.app.UiModeManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
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
/** A material's name as shown, as shownTitle in EventSheet.tsx: its file's name, with its folder when that says little. */
private fun shownTitle(title: String): String {
    val parts = title.replace(Regex("\\.[A-Za-z0-9]+$"), "").split(" · ")
    val name = parts.last()
    return if (name.length > 4 || parts.size < 2) name else "${parts[parts.size - 2]} $name"
}

/** What students have shared for the course, folded, as Materials in EventSheet.tsx: "资料 · 试卷 4 · 复习 2". */
@Composable private fun MaterialsRow(course: String, repository: top.hicancan.studev.data.AcademicRepository?, onOpen: (String) -> Unit) {
    var all by remember { mutableStateOf<List<top.hicancan.studev.world.CourseMaterials>?>(null) }
    LaunchedEffect(repository) { all = repository?.let { runCatching { it.materials() }.getOrNull() } }
    val found = all?.let { top.hicancan.studev.world.Materials.of(it, course) } ?: return
    var open by remember { mutableStateOf(false) }
    KeyRow("资料", top.hicancan.studev.world.Materials.counts(found.items).joinToString(" · ") { "${it.first} ${it.second}" }, chevron = !open, onClick = { open = !open })
    if (open) Column(Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        for (kind in top.hicancan.studev.world.Materials.KINDS) {
            val items = found.items.filter { it.kind == kind }
            if (items.isEmpty()) continue
            Plain(kind, 12.sp, Ink.muted, weight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
            var every by remember(kind) { mutableStateOf(false) }
            (if (every) items else items.take(4)).forEach { item ->
                Row(Modifier.fillMaxWidth().clickable { onOpen(item.url) }.padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Plain(shownTitle(item.title), 14.sp, modifier = Modifier.weight(1f))
                    Plain(listOfNotNull(item.term, item.ext?.uppercase()).joinToString(" · "), 12.sp, Ink.muted, modifier = Modifier.padding(start = 12.dp))
                }
            }
            if (!every && items.size > 4) Plain("还有 ${items.size - 4} 份", 13.sp, Ink.brand, modifier = Modifier.clickable { every = true }.padding(vertical = 6.dp))
        }
        Plain("来自同学们整理的南邮历年资料", 12.sp, Ink.faint, modifier = Modifier.padding(top = 8.dp))
    }
}

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
    // The sheet is the tile it opened from, enlarged: the same colour. Things on at the same time sit in a strip above
    // it, in the order they are stacked, and switch in place.
    val tones = remember(line) { top.hicancan.studev.timetable.TimetablePresentation.tones(line) }
    @Composable fun colours(item: LineEvent): Pair<Color, Color> = when (item.kind) {
        "exam" -> mark.exam to mark.onExam
        "run", "task" -> Ink.sunken to Ink.text
        else -> top.hicancan.studev.timetable.TimetablePresentation.toneOf(item, tones, line.courseMeetings)?.let { tone(it) }?.let { it.bg to it.fg } ?: (Ink.sunken to Ink.text)
    }
    val group = CampusLine.clusters(line.on(date), settings.layers).firstOrNull { run -> run.events.any { it.id == event.id } }
    val together = group?.events?.takeIf { it.size > 1 }?.sortedWith(compareByDescending<LineEvent> { it.layer }.thenBy { settings.layers.indexOf(it.kind) }.thenBy { it.start }.thenBy { it.id }).orEmpty()
    val kindNames = mapOf("class" to "课", "lab" to "实验", "exam" to "考试", "run" to "早锻炼", "task" to "任务")
    val strip: (@Composable () -> Unit)? = if (together.isEmpty()) null else ({
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            together.forEach { item ->
                val (bg, fg) = colours(item)
                val on = item.id == event.id
                Column(Modifier.clip(RoundedCornerShape(8.dp)).background(bg).border(if (on) 2.dp else 0.dp, if (on) fg.copy(alpha = .5f) else Color.Transparent, RoundedCornerShape(8.dp))
                    .clickable { onOpen(item) }.padding(horizontal = 10.dp, vertical = 6.dp).alpha(if (on) 1f else .62f)) {
                    Plain(item.short, 13.sp, fg, FontWeight.SemiBold, maxLines = 1)
                    Plain("${kindNames[item.kind]} · ${hm(item.start)}", 11.sp, fg.copy(alpha = .85f), maxLines = 1)
                }
            }
        }
    })
    val head = colours(event)
    event.task?.let { opened ->
        val tasks by model.tasks.all.collectAsStateWithLifecycle()
        val task = tasks.firstOrNull { it.id == opened.id && it.deleted != true } ?: run { LaunchedEffect(opened.id) { onClose() }; return }
        top.hicancan.studev.timetable.TaskSheet(task, line, model.tasks, model.settings, strip, onClose)
        return
    }
    if (event.kind == "run" && plan != null) {
        val place = plan.rule.xianlin
        PlainSheet("早锻炼", onClose, strip, head) {
            if (isMe) top.hicancan.studev.timetable.EventChoices(event, line, model.settings)
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
    val lab = event.lab
    val kinds = mapOf("class" to "课", "lab" to "实验", "exam" to "考试")
    PlainSheet(if (exam != null) "考试 · ${event.name}" else if (lab != null) "实验 · ${event.name}" else event.name, onClose, strip, head) {
        if (isMe) top.hicancan.studev.timetable.EventChoices(event, line, model.settings)
        val placed = Names.placed(event.room)
        val roomName = event.room?.let(Names::room)
        val facts = if (exam != null) Exams.courseOf(line.courseMeetings, exam.course) else if (lab != null) Exams.courseOf(line.courseMeetings, lab.course) else event.meeting?.course
        courseLine(facts, exam == null && lab == null).takeIf { it.isNotEmpty() }?.let { Plain(it, 13.5.sp, Ink.muted) }
        val campus = state.classes.firstOrNull { it.id == classId }?.campus
        Plain(whenText + " · " + (roomName ?: exam?.location ?: "课表没写地点") + (exam?.campus?.takeIf { campus != null && it != campus }?.let { " · ${it}校区" } ?: ""), 13.5.sp, modifier = Modifier.padding(top = 2.dp))
        if (placed) Row(Modifier.padding(top = 16.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionButton("在地图上看", modifier = Modifier.weight(1f)) { onClose(); route.map(place = event.room, at = date to event.start) }
            ActionButton("去这里", go = true, modifier = Modifier.weight(1f)) { onClose(); route.map(nav = event.room) }
        } else Spacer(Modifier.height(12.dp))
        if (lab != null) line.holidays[date]?.let { Plain("这天是$it，实验表照常排了这一次，以老师通知为准", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp)) }
        if (exam != null) {
            Exams.changesOf(record, exam).forEach { change ->
                KeyRow(if (change.change == "added") "新发布" else "改过", "${dateLabel(java.time.LocalDate.parse(change.observed))} 发现", if (change.change == "changed") Exams.changeLines(change).joinToString("\n") else null)
            }
            Together("同考场", exam.classes, exam.students)
            exam.note?.let { KeyRow("备注", it) }
        }
        if (lab != null) {
            KeyRow("项目", lab.project, lab.group?.let { "第 $it 组" })
            if (Regex("排|[（(]").containsMatchIn(lab.location)) KeyRow("座位", lab.location.replace(",", "、"))
            Together("一起上", lab.classes, lab.students)
        }
        val meeting = event.meeting
        if (meeting != null) {
            val left = Exams.lessonsLeft(line.term, meeting, line.holidays, now, event.end)
            KeyRow("周次", Exams.weeksText(meeting.weeks), if (left > 0) "还剩 $left 次" else "已经上完")
            Together("合班", meeting.classes, meeting.teaching_class.size)
        }
        event.teachers.flatMap { it.split("、") }.forEach { teacher -> KeyRow("老师", "$teacher 的课表", chevron = true, onClick = { onClose(); route.timetable("teacher", teacher) }) }
        if (lab != null) KeyRow("来源", Exams.sheetName(lab.source), "实验中心排课表，${dateLabel(java.time.LocalDate.parse(Exams.publishedOn(lab.source)))} 的版本；调整以老师通知为准")
        if (Names.isRoom(event.room)) KeyRow(if (exam != null) "考场" else "教室", "$roomName 的课表", chevron = true, onClick = { onClose(); route.timetable("room", event.room!!) })
        val courseTitle = Names.course(event.meeting?.course?.name ?: event.lab?.course?.name ?: event.exam?.course?.name ?: event.name)
        KeyRow("课程", "这门课的全部时段", chevron = true, onClick = { onClose(); route.timetable("course", courseTitle) })
        val context = androidx.compose.ui.platform.LocalContext.current
        MaterialsRow(courseTitle, state.repository) { url -> context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))) }
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
        // A name of one's own for the course: 板块课 becomes the sport actually taken. One's own course is named where it was added.
        if (isMe && meeting != null && !top.hicancan.studev.timetable.Courses.isCustom(meeting.teaching_class.id)) {
            var naming by remember(event.id) { mutableStateOf<String?>(null) }
            val typed = naming
            if (typed == null) KeyRow("名称", "改名", "比如把板块课改成具体上的课", chevron = true, onClick = { naming = event.name })
            else Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val id = top.hicancan.studev.timetable.TimetablePresentation.identity(meeting)
                val focus = remember { androidx.compose.ui.focus.FocusRequester() }
                LaunchedEffect(Unit) { focus.requestFocus() }
                top.hicancan.studev.timetable.Field(typed, "这门课叫什么", Modifier.weight(1f).focusRequester(focus), onDone = { if (typed.isNotBlank()) { model.renameCourse(id, typed); onClose() } }) { naming = it.take(60) }
                Chip("保存", { if (typed.isNotBlank()) { model.renameCourse(id, typed); onClose() } })
                Chip("原名", { model.renameCourse(id, ""); onClose() })
            }
        }
        if (isMe && exam != null) KeyRow(null, "不参加这场考试", color = mark.danger, onClick = { model.examAttendance(event.id, false); onClose() })
        if (isMe && meeting != null) KeyRow(null, if (top.hicancan.studev.timetable.Courses.isCustom(meeting.teaching_class.id)) "删除这门课" else "从我的课表移除", color = mark.danger, onClick = { model.removeCourse(meeting.teaching_class.id); onClose() })
        if (isMe && lab != null) {
            KeyRow(null, "不上这次实验", color = mark.danger, onClick = { model.settings.update { it.copy(labs = it.labs.copy(skip = (it.labs.skip + lab.id).distinct())) }; onClose() })
            KeyRow(null, "不上这门实验", "共 ${line.labs.count { top.hicancan.studev.timetable.CourseCatalog.labCourseKey(it) == top.hicancan.studev.timetable.CourseCatalog.labCourseKey(lab) }} 次，可在“我 · 实验”里恢复", color = mark.danger,
                onClick = { model.settings.update { it.copy(labs = it.labs.copy(drop = (it.labs.drop + top.hicancan.studev.timetable.CourseCatalog.labCourseKey(lab)).distinct())) }; onClose() })
        }
    }
}

private val KIND_NAMES = mapOf("exam" to "考试", "task" to "任务", "lab" to "实验", "class" to "课程", "run" to "早锻炼")

/** Which kind shows in front when things overlap. Moving one up a step swaps it with the one before. */
@Composable fun LayerSheet(settings: PersonalSettings, model: CampusModel, onClose: () -> Unit) {
    PlainSheet("叠放顺序", onClose) {
        Plain("同一时间有几件事时，靠前的显示在前面，后面的露出一条边，点开任何一件都能看到同时段的其他安排。这只改变显示，不会让哪件事消失。", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
        settings.layers.forEachIndexed { at, kind ->
            KeyRow("第 ${at + 1} 层", KIND_NAMES.getValue(kind), trailing = if (at > 0) ({ Chip("上移", { model.settings.update { current ->
                val next = current.layers.toMutableList(); next[at] = next[at - 1].also { next[at - 1] = next[at] }; current.copy(layers = next)
            } }) }) else null)
        }
        if (settings.layers != CampusLine.LAYER_ORDER) KeyRow(null, "恢复默认", onClick = { model.settings.update { it.copy(layers = CampusLine.LAYER_ORDER) } })
    }
}

/**
 * Lab sheets come from a college's laboratory centre, not the teaching office: each is the person's to take or leave
 * whole, and what they took off one lab or one sitting at a time comes back from here.
 */
@Composable fun LabSheet(state: AcademicState, settings: PersonalSettings, model: CampusModel, onForm: (top.hicancan.studev.account.FormRequest) -> Unit, onClose: () -> Unit) {
    var extraClass by remember { mutableStateOf("") }
    val choices = settings.labs
    val catalog = top.hicancan.studev.timetable.CourseCatalog
    val sheets = state.labs.distinctBy(catalog::labSheet)
    fun update(change: (top.hicancan.studev.me.LabChoices) -> top.hicancan.studev.me.LabChoices) = model.setLabs(change)
    PlainSheet("实验安排", onClose) {
        Plain("实验与理论课各自选择；增删理论课不会改变这里的选择。", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
        settings.labs.classes.forEach { name -> KeyRow("其他班", name, trailing = { Chip("移除", { update { it.copy(classes = it.classes - name) } }) }) }
        Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            top.hicancan.studev.timetable.Field(extraClass, "添加其他班实验，如 B240402", Modifier.weight(1f)) { extraClass = it.uppercase() }
            Chip("添加", { val name = extraClass.trim(); if (Regex("^[A-Z]\\d{6}(\\([A-Z]{2}\\))?$").matches(name)) { update { it.copy(classes = (it.classes + name).distinct()) }; extraClass = "" } else model.tell("请填写完整班级号") })
        }
        Plain("实验表来自学院实验中心，不在教务系统里。每份表由你决定要不要放进自己的课表；放进来之后，还可以单独去掉某门实验或某一次。", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
        sheets.forEach { lab ->
            val name = catalog.labSheet(lab)
            val on = name !in choices.off
            KeyRow(null, name, "${dateLabel(java.time.LocalDate.parse(Exams.publishedOn(lab.source)))} 的版本 · 你的班有 ${state.labs.count { catalog.labSheet(it) == name }} 次",
                trailing = { Toggle(on) { next -> update { if (next) it.copy(off = it.off - name) else it.copy(off = (it.off + name).distinct()) } } })
        }
        if (sheets.isEmpty()) Plain("你的班级不在已收到的实验表里。", 13.sp, Ink.faint)
        KeyRow(null, "有新版实验表，或你的班不在里面", "传上来，审核后所有人的课表都会更新", chevron = true, onClick = { onForm(top.hicancan.studev.account.FormRequest("data")) })
        val dropped = state.labs.filter { catalog.labCourseKey(it) in choices.drop }.distinctBy(catalog::labCourseKey)
        if (dropped.isNotEmpty()) Plain("去掉的实验", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
        dropped.forEach { lab -> val key = catalog.labCourseKey(lab)
            KeyRow(null, Names.course(lab.course.name), "整门实验", trailing = { Chip("恢复", { update { it.copy(drop = it.drop - key) } }) }) }
        val skipped = state.labs.filter { it.id in choices.skip }
        if (skipped.isNotEmpty()) Plain("不上的几次", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
        skipped.forEach { lab -> KeyRow(null, Names.course(lab.course.name), "${dateLabel(java.time.LocalDate.parse(lab.date))} ${lab.start} · ${lab.project}", trailing = { Chip("恢复", { update { it.copy(skip = it.skip - lab.id) } }) }) }
    }
}

@Composable fun MeSheet(state: AcademicState, settings: PersonalSettings, model: CampusModel, now: Moment, route: Route, onPickClass: () -> Unit, onAccount: () -> Unit, onForm: (top.hicancan.studev.account.FormRequest) -> Unit, onClose: () -> Unit) {
    var layering by remember { mutableStateOf(false) }
    var labsOpen by remember { mutableStateOf(false) }
    if (layering) { LayerSheet(settings, model) { layering = false }; return }
    var coursesOpen by remember { mutableStateOf(false) }
    if (labsOpen) { LabSheet(state, settings, model, onForm = { onClose(); onForm(it) }) { labsOpen = false }; return }
    if (coursesOpen && state.term != null) {
        top.hicancan.studev.timetable.CustomCourseSheet(settings.timetableEdits(state.term.term), state.term.weeks.size, state.periods.size, model) { coursesOpen = false }
        return
    }
    val context = LocalContext.current
    val term = state.term
    val info = state.classes.find { it.id == settings.klass }
    val edits = term?.let { settings.timetableEdits(it.term) }
    val grade = if (term != null) CampusLine.grade(info?.grade, term) else null
    val runOn = settings.runShown ?: (grade != null && grade <= 2)
    PlainSheet("我", onClose) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            KeyRow("班级", listOfNotNull(settings.klass, info?.major).joinToString(" · ").ifEmpty { "还没有选" }, chevron = true, onClick = onPickClass)
            if (edits != null) {
                KeyRow("改动", listOfNotNull("加了 ${edits.added.size} 门", "隐藏了 ${edits.hidden.size} 门", edits.names.size.takeIf { it > 0 }?.let { "改名 $it 门" }).joinToString("，"),
                    trailing = if (edits.added.size + edits.hidden.size + edits.names.size > 0) ({ Chip("还原", { model.resetTimetableEdits() }) }) else null)
                KeyRow("自己的课", if (edits.custom.isEmpty()) "没有" else "${edits.custom.size} 门", "任选课、实验、整周实习，教务课表里没有的", chevron = true, onClick = { coursesOpen = true })
            }
            Row(Modifier.fillMaxWidth().topHairline(Ink.line).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Plain("外观", 14.sp, Ink.muted, modifier = Modifier.width(80.dp))
                Choice(listOf("system" to "自动", "light" to "浅色", "dark" to "深色"), settings.theme) { next ->
                    model.settings.update { it.copy(theme = next) }
                    if (Build.VERSION.SDK_INT >= 31) context.getSystemService(UiModeManager::class.java).setApplicationNightMode(when (next) { "dark" -> UiModeManager.MODE_NIGHT_YES; "light" -> UiModeManager.MODE_NIGHT_NO; else -> UiModeManager.MODE_NIGHT_AUTO })
                    else (context as? android.app.Activity)?.recreate()
                }
            }
            val account by top.hicancan.studev.account.Accounts.get(context).user.collectAsStateWithLifecycle()
            if (settings.klass != null) {
                val on = state.labs.any { top.hicancan.studev.timetable.CourseCatalog.labSheet(it) !in settings.labs.off }
                KeyRow("实验", if (on) "已放进课表" else "没有放进课表", listOfNotNull(settings.labs.drop.size.takeIf { it > 0 }?.let { "去掉 $it 门" }, settings.labs.skip.size.takeIf { it > 0 }?.let { "不上 $it 次" }).joinToString("，").ifEmpty { "学院实验中心的上机安排" }, chevron = true, onClick = { labsOpen = true })
            }
            KeyRow("叠放", settings.layers.joinToString(" › ") { KIND_NAMES.getValue(it) }, "同一时间有几件事时谁在前面", chevron = true, onClick = { layering = true })
            KeyRow("反馈", "哪里不顺手、哪里不对", "写一句就行，我们会看每一条", chevron = true, onClick = { onClose(); onForm(top.hicancan.studev.account.FormRequest("feedback", "where" to "App ${top.hicancan.studev.BuildConfig.VERSION_NAME} · 我")) })
            KeyRow("补充数据", "实验课表、讲座、校车、营业时间", "教务系统里没有的，审核后放进课表和地图", chevron = true, onClick = { onClose(); onForm(top.hicancan.studev.account.FormRequest("data")) })
            KeyRow("账号", account?.let { "${it.nickname} · ${it.roleName}" } ?: "未登录", chevron = true, onClick = { onClose(); onAccount() })
            KeyRow("同步", if (account != null) "任务在你登录的手机和电脑间自动同步" else "登录后，任务在手机和电脑间自动同步", "课表设置仍只在这台设备上")
            state.run?.let { rule ->
                Plain("早锻炼", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
                KeyRow(null, "显示在课表上", if (grade != null && grade <= 2) "大${"一二"[grade - 1]}必做，本学期 ${rule.required} 次" else "大三大四需要补跑时打开", trailing = { Toggle(runOn) { on -> model.setRun { it.copy(runShown = on) } } })
            }
            Plain("桌面小组件", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Plain("日历显示", 14.sp, Ink.muted, modifier = Modifier.width(80.dp))
                Choice(listOf("auto" to "随大小", "next" to "下一节", "day" to "一天", "week" to "一周", "term" to "学期"), settings.widgetView) { next -> model.settings.update { it.copy(widgetView = next) } }
            }
            KeyRow(null, "添加日历", "课程、实验和考试；也可以长按桌面空白处，在窗口小工具里找 StuDev", chevron = true, onClick = {
                if (!top.hicancan.studev.widget.CampusWidget.pin(context, settings.widgetView)) model.tell("这台手机要从桌面添加：长按空白处，打开窗口小工具，找到 StuDev")
            })
            KeyRow(null, "添加清单", "过期的、这一周要做的和考试，在桌面上直接勾掉", chevron = true, onClick = {
                if (!top.hicancan.studev.widget.CampusWidget.pin(context, "list")) model.tell("这台手机要从桌面添加：长按空白处，打开窗口小工具，找到 StuDev 清单")
            })
            val background = remember(settings) { top.hicancan.studev.device.BackgroundSettings.status(context) }
            KeyRow(null, "后台导航", if (background.batteryExempt) "已允许，息屏也能继续导航；还可以打开自启动" else "允许后，息屏也能继续导航", chevron = true, onClick = {
                if (background.batteryExempt) top.hicancan.studev.device.BackgroundSettings.openOemStartup(context) else top.hicancan.studev.device.BackgroundSettings.requestBatteryExemption(context)
            })
            KeyRow(null, "检查更新", (if (state.appBehind) "有新版本 ${state.app!!.versionName} · " else "") + "App ${top.hicancan.studev.BuildConfig.VERSION_NAME} · 数据 ${state.repository?.release?.data_version.orEmpty()}", chevron = true, onClick = { model.refresh() })
            KeyRow(null, "分享 StuDev", PLATFORM_ORIGIN.removePrefix("https://"), chevron = true, onClick = {
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "$PLATFORM_ORIGIN/"), "分享 StuDev"))
            })
            KeyRow(null, "学生发展中心", "南邮计软网安", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/club/"))) })
            KeyRow(null, "用户协议", "服务条款与免责声明", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/terms/"))) })
            KeyRow(null, "隐私政策", "个人信息保护与权限说明", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/privacy/"))) })
            // The app's ICP filing number, which the rules want in plain sight inside the app.
            Box(Modifier.fillMaxWidth().clickable { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://beian.miit.gov.cn/"))) }.padding(top = 16.dp, bottom = 8.dp), contentAlignment = Alignment.Center) {
                Plain("App 备案号：${top.hicancan.studev.BuildConfig.APP_FILING}", 12.sp, Ink.faint)
            }
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
