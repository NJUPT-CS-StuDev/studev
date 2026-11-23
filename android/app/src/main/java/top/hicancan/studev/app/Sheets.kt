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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Surface
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import top.hicancan.studev.BuildConfig
import top.hicancan.studev.account.Accounts
import top.hicancan.studev.account.AccountPresence
import top.hicancan.studev.account.PLATFORM_ORIGIN
import top.hicancan.studev.app.AcademicState
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.data.Practice
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
/** Who teaches it, in one row as the classes are: each name opens that teacher's timetable. */
@Composable private fun KnowledgeRow(code: String?, course: String, repo: top.hicancan.studev.data.AcademicRepository?, onOpen: (String) -> Unit) {
    val index by produceState<top.hicancan.studev.knowledge.KnowledgeIndex?>(null, repo) { value = repo?.let { runCatching { it.read<top.hicancan.studev.knowledge.KnowledgeIndex>("knowledge/knowledge.json") }.getOrNull() } }
    val norm = code?.trim()?.uppercase()
    val found = index?.courses?.firstOrNull { c -> (norm != null && norm in c.codes) || c.name == course || course in c.former } ?: return
    val topics = found.chapters.sumOf { it.topics.size }
    KeyRow("知识", "查看这门课的知识与真题", "${found.chapters.size} 章 · $topics 个知识点", chevron = true, onClick = { onOpen(found.id) })
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun TeacherRow(teachers: List<String>, onOpen: (String) -> Unit) {
    val names = teachers.flatMap { it.split("、") }.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    if (names.isEmpty()) return
    Row(Modifier.fillMaxWidth().topHairline(Ink.line).padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Plain("老师", 12.5.sp, Ink.faint, maxLines = 1, modifier = Modifier.width(56.dp))
        FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            names.forEach { name ->
                Surface({ onOpen(name) }, shape = RoundedCornerShape(50), color = Ink.sunken, modifier = Modifier.semantics { contentDescription = "$name 的课表" }) {
                    Plain(name, 13.5.sp, Ink.text, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                }
            }
        }
    }
}

@Composable fun PracticeSheet(practice: Practice, line: CampusLine, week: Int?, state: AcademicState, route: Route, onClose: () -> Unit) {
    val context = LocalContext.current
    val first = line.term.weeks.firstOrNull { it.week == practice.weeks.min() }
    val last = line.term.weeks.firstOrNull { it.week == practice.weeks.max() }
    val course = Practices.resources(practice)
    PlainSheet("实践 · ${Practices.name(practice)}", onClose, head = Ink.sunken to Ink.text) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            val dates = if (first != null && last != null) "${dateLabel(java.time.LocalDate.parse(first.start))} – ${dateLabel(java.time.LocalDate.parse(last.end))}" else null
            KeyRow("周次", Exams.weeksText(practice.weeks), dates)
            KeyRow("进度", Practices.progress(practice.weeks, week))
            TeacherRow(Practices.teachers(practice)) { onClose(); route.timetable("teacher", it) }
            KeyRow("安排", "课表没有固定时段", "具体时间、地点和要求以指导老师的安排为准。")
            KnowledgeRow(null, course, state.repository) { onClose(); route.knowledge(course = it) }
            MaterialsRow(course, state.repository) { url ->
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
            }
        }
    }
}

@Composable fun EventSheet(event: LineEvent, line: CampusLine, isMe: Boolean, route: Route, model: CampusModel, settings: PersonalSettings, state: AcademicState, now: Moment, onOpen: (LineEvent) -> Unit, onClose: () -> Unit) {
    val mark = marks()
    val date = event.date
    val whenText = "${WEEKDAYS[date.dayOfWeek.value]} ${dateLabel(date)} · ${hm(event.start)}–${hm(event.end)}"
    val plan = line.run
    val classId = if (isMe) settings.klass else if (route.whoType == "class") route.whoId else null
    val recordState = top.hicancan.studev.timetable.examRecordOf(state, classId)
    val record = recordState.record
    // The sheet is the tile it opened from, enlarged: the same colour. Things on at the same time sit in a strip above
    // it, in the order they are stacked, and switch in place.
    val tones = remember(line) { top.hicancan.studev.timetable.TimetablePresentation.tones(line) }
    @Composable fun colours(item: LineEvent): Pair<Color, Color> = when (item.kind) {
        "exam" -> mark.exam to mark.onExam
        "run", "task" -> Ink.sunken to Ink.text
        else -> top.hicancan.studev.timetable.TimetablePresentation.toneOf(item, tones, line.courseMeetings)?.let { tone(it) }?.let { it.bg to it.fg } ?: (Ink.sunken to Ink.text)
    }
    val group = CampusLine.clusters(line.on(date), settings.layers).firstOrNull { run -> run.events.any { it.id == event.id } }
    val stacked = group?.events?.takeIf { it.size > 1 }?.sortedWith(compareByDescending<LineEvent> { it.layer }.thenBy { settings.layers.indexOf(it.kind) }.thenBy { it.start }.thenBy { it.id }).orEmpty()
    // An exam also switches among the day's other exams, wherever it was tapped: two exams on one day are seen together.
    val dayExams = if (event.kind == "exam") line.on(date).filter { it.kind == "exam" } else emptyList()
    val together = if (dayExams.size > 1) (stacked + dayExams).distinctBy { it.id }.sortedWith(compareBy<LineEvent> { it.start }.thenBy { settings.layers.indexOf(it.kind) }.thenBy { it.id }) else stacked
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
            Plain(whenText, 13.5.sp, Ink.muted)
            if (place != null) Row(Modifier.padding(top = 16.dp, bottom = 8.dp)) { ActionButton("去起点", go = true, modifier = Modifier.weight(1f)) { onClose(); route.map(nav = "仙林/${place.route[0]}") } }
            if (place != null) {
                KeyRow("路线", "${place.route.joinToString(" ↔ ")}，约 ${place.metres} 米")
                KeyRow("刷脸", "起点 ${place.start_scan_end} 前，终点 ${place.end_scan_end} 前", if (place.male_minutes == place.female_minutes) "${place.male_minutes} 分钟内跑完" else "男生 ${place.male_minutes} 分钟、女生 ${place.female_minutes} 分钟内跑完")
            }
            KeyRow("次数", "${CampusLine.tally(plan, now).count} / ${plan.rule.required}", "编排整个学期", chevron = true, onClick = { onClose(); route.scale = "term"; route.termMode = "run"; route.tab = "timetable" })
            if (isMe) top.hicancan.studev.timetable.EventChoices(event, line, model.settings)
            KeyRow(null, "这天没跑", color = mark.danger, onClick = { model.setRun { it.copy(runDays = CampusLine.toggleRun(it.runDays, date)) }; onClose() })
        }
        return
    }
    val exam = event.exam
    val lab = event.lab
    val currentCourseName = if (isMe && event.meeting != null && !top.hicancan.studev.timetable.Courses.isCustom(event.meeting.teaching_class.id))
        settings.timetableEdits(line.term.term).names[top.hicancan.studev.timetable.TimetablePresentation.identity(event.meeting)] ?: Names.course(event.meeting.course.name) else event.name
    val kinds = mapOf("class" to "课", "lab" to "实验", "exam" to "考试")
    PlainSheet(if (exam != null) "考试 · ${event.name}" else if (lab != null) "实验 · ${event.name}" else currentCourseName, onClose, strip, head) {
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
        if (lab != null) line.holidays[date]?.let { Plain("这天是$it，实验表上仍有安排，请以老师通知为准", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp)) }
        if (exam != null) {
            Exams.changesOf(record, exam).forEach { change ->
                KeyRow(if (change.change == "added") "新发布" else "改过", Exams.versionTime(record!!.history.first { it.id == change.version }), if (change.change == "changed") Exams.changeLines(change).joinToString("\n") else null)
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
        TeacherRow(event.teachers) { teacher -> onClose(); route.timetable("teacher", teacher) }
        if (lab != null) KeyRow("来源", Exams.sheetName(lab.source), "实验中心排课表，${dateLabel(java.time.LocalDate.parse(Exams.publishedOn(lab.source)))} 的版本；调整以老师通知为准")
        if (Names.isRoom(event.room)) KeyRow(if (exam != null) "考场" else "教室", "$roomName 的课表", chevron = true, onClick = { onClose(); route.timetable("room", event.room!!) })
        val courseTitle = Names.course(event.meeting?.course?.name ?: event.lab?.course?.name ?: event.exam?.course?.name ?: event.name)
        val courseCode = event.meeting?.course?.code ?: event.lab?.course?.code ?: event.exam?.course?.code
        KeyRow("课程", "这门课的全部时段", chevron = true, onClick = { onClose(); route.timetable("course", courseTitle) })
        KnowledgeRow(courseCode, courseTitle, state.repository) { id -> onClose(); route.knowledge(course = id) }
        val context = androidx.compose.ui.platform.LocalContext.current
        MaterialsRow(courseTitle, state.repository) { url -> context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))) }
        line.sharingSlot(event).forEach { other ->
            KeyRow("同时段", Names.course(other.course.name), "${Exams.weeksText(other.weeks)} · 本周不上", chevron = true, onClick = { line.meetingAround(other.id, event.date)?.let(onOpen) })
        }
        if (exam != null) {
            KeyRow("考试", "全部考试 · ${line.exams.map { it.course.code ?: it.course.name }.distinct().size} 门", chevron = true, onClick = { onClose(); route.tab = "timetable"; route.scale = "exam" })
            record?.sources?.firstOrNull { it.file == exam.source }?.let { sheet ->
                KeyRow("来源", Exams.fileName(sheet.file), sheet.published?.let { "${Exams.time(it.take(10))} 官方发布" })
                KeyRow(null, "查看官方公告", chevron = true, onClick = { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(sheet.notice))) })
                KeyRow(null, "查看官方附件", chevron = true, onClick = { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(sheet.url))) })
            }
            if (recordState.failed) KeyRow("来源", "暂时无法加载 · 重试", onClick = recordState.retry)
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
            if (typed == null) KeyRow("名称", currentCourseName, trailing = { TextAction("编辑名称", { naming = currentCourseName }) })
            else Column {
                val id = top.hicancan.studev.timetable.TimetablePresentation.identity(meeting)
                val focus = remember { androidx.compose.ui.focus.FocusRequester() }
                LaunchedEffect(Unit) { focus.requestFocus() }
                fun save() { if (typed.isNotBlank() && typed.trim() != currentCourseName) { model.renameCourse(id, typed.trim()); naming = null } }
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    top.hicancan.studev.timetable.Field(typed, "课程名称", Modifier.weight(1f).focusRequester(focus), onDone = ::save) { naming = it.take(60) }
                    TextAction("保存名称", ::save, enabled = typed.isNotBlank() && typed.trim() != currentCourseName)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    TextAction("取消", { naming = null }, muted = true)
                    if (id in settings.timetableEdits(line.term.term).names) TextAction("恢复原名", { model.renameCourse(id, ""); naming = null }, muted = true)
                }
            }
        }
        if (isMe) top.hicancan.studev.timetable.EventChoices(event, line, model.settings)
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
    PlainSheet("时间冲突时的显示顺序", onClose) {
        Plain("同时有多项安排时，优先显示排在前面的类型。点击安排可查看同时段的其他事项。", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
        settings.layers.forEachIndexed { at, kind ->
            KeyRow("${at + 1}", KIND_NAMES.getValue(kind), trailing = if (at > 0) ({ Chip("上移", { model.settings.update { current ->
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
@Composable fun LabSheet(state: AcademicState, settings: PersonalSettings, model: CampusModel, onClose: () -> Unit) {
    val browser = LocalUriHandler.current
    var extraClass by remember { mutableStateOf("") }
    val choices = settings.labs
    val catalog = top.hicancan.studev.timetable.CourseCatalog
    val sheets = state.labs.distinctBy(catalog::labSheet)
    fun update(change: (top.hicancan.studev.me.LabChoices) -> top.hicancan.studev.me.LabChoices) = model.setLabs(change)
    PlainSheet("实验安排", onClose) {
        Plain("实验单独选。增删理论课，这里的实验安排照旧。", 13.sp, Ink.muted, modifier = Modifier.padding(bottom = 8.dp))
        settings.labs.classes.forEach { name -> KeyRow("其他班", name, trailing = { Chip("移除", { update { it.copy(classes = it.classes - name) } }) }) }
        Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            top.hicancan.studev.timetable.Field(extraClass, "添加其他班实验，如 B240402", Modifier.weight(1f)) { extraClass = it.uppercase() }
            Chip("添加", { val name = extraClass.trim(); if (Regex("^[A-Z]\\d{6}(\\([A-Z]{2}\\))?$").matches(name)) { update { it.copy(classes = (it.classes + name).distinct()) }; extraClass = "" } else model.tell("请填写完整班级号") })
        }
        sheets.forEach { lab ->
            val name = catalog.labSheet(lab)
            val on = name !in choices.off
            KeyRow(null, name, "${dateLabel(java.time.LocalDate.parse(Exams.publishedOn(lab.source)))} 的版本 · 你的班有 ${state.labs.count { catalog.labSheet(it) == name }} 次",
                trailing = { Toggle(on) { next -> update { if (next) it.copy(off = it.off - name) else it.copy(off = (it.off + name).distinct()) } } })
        }
        if (sheets.isEmpty()) Plain("暂时没在实验表里找到你的班级。", 13.sp, Ink.faint)
        KeyRow(null, "有新版实验表，或你的班不在里面", "在浏览器提交，审核后更新课表", chevron = true, onClick = { browser.openUri(collectionLink(BuildConfig.FORM_DATA)) })
        val dropped = state.labs.filter { catalog.labCourseKey(it) in choices.drop }.distinctBy(catalog::labCourseKey)
        if (dropped.isNotEmpty()) Plain("去掉的实验", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
        dropped.forEach { lab -> val key = catalog.labCourseKey(lab)
            KeyRow(null, Names.course(lab.course.name), "整门实验", trailing = { TextAction("恢复", { update { it.copy(drop = it.drop - key) } }) }) }
        val skipped = state.labs.filter { it.id in choices.skip }
        if (skipped.isNotEmpty()) Plain("已隐藏的实验安排", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
        skipped.forEach { lab -> KeyRow(null, Names.course(lab.course.name), "${dateLabel(java.time.LocalDate.parse(lab.date))} ${lab.start} · ${lab.project}", trailing = { TextAction("恢复", { update { it.copy(skip = it.skip - lab.id) } }) }) }
    }
}

@Composable fun MeSheet(state: AcademicState, settings: PersonalSettings, model: CampusModel, now: Moment, route: Route, onPickClass: () -> Unit, onAccount: () -> Unit, onClose: () -> Unit) {
    val browser = LocalUriHandler.current
    var section by remember { mutableStateOf("home") }
    var layering by remember { mutableStateOf(false) }
    var labsOpen by remember { mutableStateOf(false) }
    if (layering) { LayerSheet(settings, model) { layering = false }; return }
    var coursesOpen by remember { mutableStateOf(false) }
    var calendarOpen by remember { mutableStateOf(false) }
    if (calendarOpen) { top.hicancan.studev.timetable.CalendarSheet(state, settings, model) { calendarOpen = false }; return }
    if (labsOpen) { LabSheet(state, settings, model) { labsOpen = false }; return }
    if (coursesOpen && state.term != null) {
        top.hicancan.studev.timetable.ManagedCoursesSheet(state, settings, model, onAdd = { onClose(); route.search(scope = "academic", source = "courses", focus = true) }) { coursesOpen = false }
        return
    }
    val context = LocalContext.current
    val term = state.term
    val info = state.classes.find { it.id == settings.klass }
    val edits = term?.let { settings.timetableEdits(it.term) }
    val grade = if (term != null) CampusLine.grade(info?.grade, term) else null
    val runOn = settings.runShown ?: (grade != null && grade <= 2)
    val presence by Accounts.get(context).presence.collectAsStateWithLifecycle()
    var background by remember { mutableStateOf(top.hicancan.studev.device.BackgroundSettings.status(context)) }
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_RESUME) { background = top.hicancan.studev.device.BackgroundSettings.status(context) }
    val title = when (section) { "timetable" -> "课表设置"; "widgets" -> "桌面小组件"; "appearance" -> "外观"; "permissions" -> "提醒与权限"; "about" -> "帮助与关于"; else -> "我" }
    key(section) {
    PlainSheet(title, { if (section == "home") onClose() else section = "home" }, back = if (section == "home") null else ({ section = "home" })) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (section == "home") {
                val (name, note) = when (val shown = presence) {
                    AccountPresence.Loading -> "正在读取账号…" to null
                    AccountPresence.Unavailable -> "账号暂不可用" to "打开账号页，再试一次"
                    AccountPresence.SignedOut -> "未登录" to "登录后同步任务和课表设置"
                    is AccountPresence.SignedIn -> shown.user.nickname to "管理账号 · 任务和课表设置自动同步"
                }
                KeyRow(null, name, note, chevron = true, onClick = { onClose(); onAccount() })
                Spacer(Modifier.height(12.dp))
                KeyRow(null, "收集", "在浏览器打开收集页面", chevron = true, onClick = { browser.openUri("$PLATFORM_ORIGIN/forms/") })
                KeyRow(null, "成员", "在浏览器查看成员", chevron = true, onClick = { browser.openUri("$PLATFORM_ORIGIN/members/") })
                KeyRow(null, "课表设置", listOfNotNull(settings.klass, info?.major).joinToString(" · ").ifEmpty { "选择班级、调整课程与实验" }, chevron = true, onClick = { section = "timetable" })
                KeyRow(null, "外观", "跟随系统、浅色或深色", chevron = true, onClick = { section = "appearance" })
                KeyRow(null, "桌面小组件", "把课表和任务放到桌面", chevron = true, onClick = { section = "widgets" })
                KeyRow(null, "提醒与权限", "课前提醒、通知和后台导航", chevron = true, onClick = { section = "permissions" })
                KeyRow(null, "检查更新", (if (state.appBehind) "有新版本 ${state.app!!.versionName} · " else "") + "App ${top.hicancan.studev.BuildConfig.VERSION_NAME} · 数据 ${state.repository?.release?.data_version.orEmpty()}", chevron = true, onClick = { model.refresh() })
                KeyRow(null, "分享 StuDev", trailing = { CampusGlyph("share", 18.dp, Ink.muted) }, onClick = {
                    context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "$PLATFORM_ORIGIN/"), "分享 StuDev"))
                })
                KeyRow(null, "帮助与关于", "反馈、资料提交、协议与备案", chevron = true, onClick = { section = "about" })
            }
            if (section == "timetable") {
            KeyRow("班级", listOfNotNull(settings.klass, info?.major).joinToString(" · ").ifEmpty { "还没有选" }, chevron = true, onClick = onPickClass)
            if (edits != null) {
                KeyRow(null, "我的课程", "查看课程详情，添加、隐藏或修改个人安排", chevron = true, onClick = { coursesOpen = true })
            }
            if (settings.klass != null) {
                val on = state.labs.any { top.hicancan.studev.timetable.CourseCatalog.labSheet(it) !in settings.labs.off }
                KeyRow(null, "实验安排", if (on) "已显示在课表" else "选择要显示的实验", chevron = true, onClick = { labsOpen = true })
            }
            KeyRow(null, "时间冲突时的显示顺序", settings.layers.joinToString(" › ") { KIND_NAMES.getValue(it) }, chevron = true, onClick = { layering = true })
            state.run?.let { rule ->
                Plain("早锻炼", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
                KeyRow(null, "显示早锻炼", if (grade != null && grade <= 2) "本学期需完成 ${rule.required} 次" else "需要补跑时开启", trailing = { Toggle(runOn) { on -> model.setRun { it.copy(runShown = on) } } })
            }
            KeyRow(null, "写入手机日历", "选择同步到系统日历的课程、考试和任务", chevron = true, onClick = { calendarOpen = true })
            if (edits != null && edits.added.size + edits.hidden.size + edits.names.size > 0) {
                KeyRow(null, "恢复班级课程", "撤销选课、隐藏和名称调整，保留自定义课程", onClick = { model.resetTimetableEdits() })
            }
            }
            if (section == "appearance") {
            Row(Modifier.fillMaxWidth().topHairline(Ink.line).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Plain("外观", 14.sp, Ink.muted, modifier = Modifier.width(80.dp))
                Choice(listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色"), settings.theme) { next ->
                    model.settings.update { it.copy(theme = next) }
                    if (Build.VERSION.SDK_INT >= 31) context.getSystemService(UiModeManager::class.java).setApplicationNightMode(when (next) { "dark" -> UiModeManager.MODE_NIGHT_YES; "light" -> UiModeManager.MODE_NIGHT_NO; else -> UiModeManager.MODE_NIGHT_AUTO })
                    else (context as? android.app.Activity)?.recreate()
                }
            }
            }
            if (section == "permissions") {
            KeyRow(null, "课前提醒", "课程、实验和考试开始前提醒", trailing = { Toggle(settings.reminders) { on ->
                model.setRun { it.copy(reminders = on) }
                if (on && !background.notificationsEnabled) top.hicancan.studev.device.BackgroundSettings.openNotifications(context)
            } })
            if (settings.reminders) {
                Plain("提前时间", 13.sp, Ink.muted, modifier = Modifier.padding(top = 8.dp, bottom = 6.dp))
                Choice(listOf("5" to "5 分钟", "10" to "10 分钟", "15" to "15 分钟", "30" to "30 分钟"), settings.leadMinutes.toString()) { value -> model.setRun { it.copy(leadMinutes = value.toInt()) } }
            }
            KeyRow(null, "通知权限", if (background.notificationsEnabled) "已允许" else "未允许，提醒无法显示", chevron = true, onClick = { top.hicancan.studev.device.BackgroundSettings.openNotifications(context) })
            KeyRow(null, "后台导航", if (background.batteryExempt) "已允许在息屏后继续导航" else "允许在息屏后继续导航", chevron = true, onClick = {
                if (background.batteryExempt) top.hicancan.studev.device.BackgroundSettings.openOemStartup(context) else top.hicancan.studev.device.BackgroundSettings.requestBatteryExemption(context)
            })
            }
            if (section == "widgets") {
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Plain("课表显示范围", 14.sp, Ink.muted)
                val views = listOf("auto" to "自适应", "next" to "下一项安排", "day" to "当天", "week" to "本周", "term" to "本学期")
                var choosing by remember { mutableStateOf(false) }
                Box {
                    Chip("${views.find { it.first == settings.widgetView }?.second ?: views.first().second} ▾", { choosing = true }, Modifier.fillMaxWidth().semantics { contentDescription = "课表显示范围" })
                    androidx.compose.material3.DropdownMenu(expanded = choosing, onDismissRequest = { choosing = false }, containerColor = Ink.paper) {
                        views.forEach { (value, label) -> androidx.compose.material3.DropdownMenuItem(text = { Plain(label, 14.sp) }, onClick = { model.settings.update { it.copy(widgetView = value) }; choosing = false }) }
                    }
                }
            }
            KeyRow(null, "添加课表小组件", "查看课程、实验和考试", chevron = true, onClick = {
                if (!top.hicancan.studev.widget.CampusWidget.pin(context, settings.widgetView)) model.tell("这台手机要从桌面添加：长按空白处，打开窗口小工具，找到 StuDev")
            })
            KeyRow(null, "添加任务小组件", "查看待办和考试，勾选已完成的任务", chevron = true, onClick = {
                if (!top.hicancan.studev.widget.CampusWidget.pin(context, "list")) model.tell("长按桌面空白处，打开窗口小工具，找到 StuDev 任务")
            })
            }
            if (section == "about") {
            KeyRow(null, "意见反馈", "在浏览器报告问题或提出建议", chevron = true, onClick = {
                browser.openUri(collectionLink(BuildConfig.FORM_FEEDBACK, listOf("where" to "App ${BuildConfig.VERSION_NAME} · 我")))
            })
            KeyRow(null, "提供校园资料", "在浏览器提交实验课表、讲座、校车或营业时间", chevron = true, onClick = { browser.openUri(collectionLink(BuildConfig.FORM_DATA)) })
            KeyRow(null, "学生发展中心", "南邮计软网安", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/club/"))) })
            KeyRow(null, "用户协议", "服务条款与免责声明", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/terms/"))) })
            KeyRow(null, "隐私政策", "个人信息保护与权限说明", chevron = true, onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/privacy/"))) })
            // The app's ICP filing number, which the rules want in plain sight inside the app.
            Box(Modifier.fillMaxWidth().clickable { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://beian.miit.gov.cn/"))) }.padding(top = 16.dp, bottom = 8.dp), contentAlignment = Alignment.Center) {
                Plain("App 备案号：${top.hicancan.studev.BuildConfig.APP_FILING}", 12.sp, Ink.faint)
            }
            }
            Spacer(Modifier.height(8.dp))
        }
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
