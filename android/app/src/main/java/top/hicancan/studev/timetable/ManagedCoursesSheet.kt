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
import top.hicancan.studev.app.*
import top.hicancan.studev.me.PersonalSettings
import top.hicancan.studev.world.*

/** All courses chosen for one term. Public teaching groups retain their identity and published arrangements. */
@Composable fun ManagedCoursesSheet(state: AcademicState, settings: PersonalSettings, model: CampusModel, onAdd: () -> Unit, onClose: () -> Unit) {
    val term = state.term ?: return
    val edits = settings.timetableEdits(term.term)
    LaunchedEffect(state.repository) { model.openCourseManager() }
    val courses = CourseCatalog.managedCourses(state.rawSchedule?.meetings.orEmpty(), state.catalog, edits)
    var selected by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var showHidden by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<CustomCourse?>(null) }
    if (adding || editing != null) {
        CustomCourseSheet(term.weeks.size, state.periods.size, model, editing) { adding = false; editing = null }
        return
    }
    val chosen = courses.find { it.id == selected }
    if (chosen != null) {
        val first = chosen.meetings.first()
        val identity = TimetablePresentation.identity(first)
        val display = if (chosen.source == "custom") first.course.name else edits.names[identity] ?: Names.course(first.course.name)
        var name by remember(chosen.id, display) { mutableStateOf(display) }
        var naming by remember(chosen.id) { mutableStateOf(false) }
        val custom = edits.custom.find { "custom:${it.id}" == chosen.id }
        val labs = state.labs.filter { TimetablePresentation.sameCourse(it, first) }
        PlainSheet(display, { selected = null }) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                KeyRow("来源", when (chosen.source) { "class" -> "班级课表 · ${settings.klass.orEmpty()}"; "custom" -> "自定义课程"; else -> "从全校课程添加" }, if (chosen.hidden) "已从个人课表隐藏" else null)
                if (custom == null && first.course.name != display) KeyRow("原名", first.course.name)
                first.course.code?.let { KeyRow("课程代码", it) }
                chosen.meetings.flatMap { it.teachers }.map { it.name }.distinct().takeIf { it.isNotEmpty() }?.let { KeyRow("教师", it.joinToString("、")) }
                Plain("上课安排", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
                chosen.meetings.forEach { meeting ->
                    val start = state.periods.find { it.period == meeting.periods.first() }?.start
                    val end = state.periods.find { it.period == meeting.periods.last() }?.end
                    KeyRow(null, "${WEEKDAYS[meeting.weekday]} · 第 ${meeting.periods.first()}–${meeting.periods.last()} 节${if (start != null && end != null) " · $start–$end" else ""}",
                        "${CourseCatalog.formatWeekNumbers(meeting.weeks)} · ${meeting.room?.let(Names::room) ?: meeting.location ?: "地点未定"}")
                }
                if (custom != null) {
                    KeyRow(null, "编辑课程", "修改名称、时间、地点或教师", chevron = true, onClick = { editing = custom })
                } else {
                    if (!naming) KeyRow("名称", display, trailing = { TextAction("编辑名称", { naming = true }) })
                    else {
                        Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Field(name, "课程名称", Modifier.weight(1f).semantics { contentDescription = "课表中的名称" }) { name = it.take(60) }
                            TextAction("保存名称", { model.renameCourse(identity, name.trim()); naming = false }, enabled = name.isNotBlank() && name.trim() != display)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            TextAction("取消", { name = display; naming = false }, muted = true)
                            if (identity in edits.names) TextAction("恢复原名", { model.renameCourse(identity, ""); naming = false }, muted = true)
                        }
                    }
                }
                if (labs.isNotEmpty()) {
                    Plain("相关实验", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
                    labs.forEach { lab ->
                        val sheetOff = CourseCatalog.labSheet(lab) in settings.labs.off
                        val courseOff = CourseCatalog.labCourseKey(lab) in settings.labs.drop
                        val skipped = lab.id in settings.labs.skip
                        KeyRow(null, "${dateLabel(java.time.LocalDate.parse(lab.date))} ${lab.start}–${lab.end}", "${lab.project} · ${lab.room?.let(Names::room) ?: lab.location ?: "地点未定"}" + if (sheetOff || courseOff) " · 已隐藏整${if (sheetOff) "份实验表" else "门实验"}" else "",
                            trailing = if (!sheetOff && !courseOff) ({ Toggle(!skipped) { on -> model.setLabs { if (on) it.copy(skip = it.skip - lab.id) else it.copy(skip = (it.skip + lab.id).distinct()) } } }) else null)
                    }
                    labs.distinctBy(CourseCatalog::labCourseKey).forEach { lab ->
                        val key = CourseCatalog.labCourseKey(lab)
                        KeyRow(null, if (key in settings.labs.drop) "恢复这门实验" else "隐藏这门实验", "理论课的选择不受影响", onClick = { model.setLabs { if (key in it.drop) it.copy(drop = it.drop - key) else it.copy(drop = (it.drop + key).distinct()) } })
                    }
                }
                Spacer(Modifier.height(16.dp))
                if (custom != null) KeyRow(null, "删除自定义课程", color = marks().danger, onClick = { model.removeCourse(chosen.id); selected = null })
                else KeyRow(null, if (chosen.hidden) "恢复到课表" else if (chosen.source == "added") "移除添加的课程" else "隐藏这门课", "只调整个人课表，实验另行选择", color = if (chosen.hidden) Ink.brand else marks().danger,
                    onClick = { if (chosen.hidden) model.restoreCourse(chosen.id) else model.removeCourse(chosen.id); selected = null })
            }
        }
        return
    }
    PlainSheet("我的课程", onClose) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                Chip("从全校添加", onAdd)
                Chip("自定义课程", { adding = true })
            }
            SearchField(query, "搜索课程、代码或教师") { query = it }
            KeyRow(null, "显示已隐藏的课程", trailing = { Toggle(showHidden) { showHidden = it } })
            val rows = courses.filter { course -> (showHidden || !course.hidden) && course.meetings.any { meeting ->
                val identity = TimetablePresentation.identity(meeting)
                "$identity ${meeting.course.name} ${edits.names[identity].orEmpty()} ${meeting.teachers.joinToString(" ") { it.name }}".contains(query.trim(), true)
            } }
            rows.forEach { course ->
                val first = course.meetings.first()
                val display = if (course.source == "custom") first.course.name else edits.names[TimetablePresentation.identity(first)] ?: Names.course(first.course.name)
                KeyRow(null, display, (if (course.hidden) "已隐藏 · " else "") + when (course.source) { "class" -> "班级课程"; "custom" -> "自定义课程"; else -> "全校选课" } + " · " + course.meetings.joinToString("、") { WEEKDAYS[it.weekday] }.let { it.split('、').distinct().joinToString("、") }, chevron = true, onClick = { selected = course.id })
            }
            if (rows.isEmpty()) Plain(if (query.isBlank()) "暂无课程，可从全校添加或自定义课程。" else "没有找到这门课程。", 14.sp, Ink.muted, modifier = Modifier.padding(vertical = 20.dp))
            state.catalogError?.let { KeyRow(null, it, trailing = { TextAction("重试", model::openCourseManager, refresh = true) }) }
        }
    }
}
