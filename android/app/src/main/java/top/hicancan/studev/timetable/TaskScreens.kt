package top.hicancan.studev.timetable

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import top.hicancan.studev.app.*
import top.hicancan.studev.me.TaskStore
import top.hicancan.studev.world.*
import java.time.LocalDate

/** A task as something to open: a sheet opens events, and a task is one, whether or not it has a time. */
fun taskEvent(task: Task, today: LocalDate) = LineEvent("task", task.id, task.date?.let(LocalDate::parse) ?: today, task.title, task.title,
    task.start ?: 0, task.end ?: ((task.start ?: 0) + Tasks.MINUTES), null, emptyList(), task = task)

private val PRIORITY_COLORS = listOf(Color.Unspecified, Color(0xFF4F8CFF), Color(0xFFE8A33A))

/** The box a task is ticked in; its edge takes the task's importance. */
@Composable fun TaskCheck(task: Task, store: TaskStore) {
    val edge = when (task.priority ?: 0) { 0 -> Ink.faint; 3 -> marks().danger; else -> PRIORITY_COLORS[task.priority!!] }
    Box(Modifier.size(22.dp).clip(RoundedCornerShape(5.dp)).background(if (task.done != null) Ink.faint else Color.Transparent)
        .border(1.5.dp, if (task.done != null) Ink.faint else edge, RoundedCornerShape(5.dp)).clickable { store.toggleDone(task) }, contentAlignment = Alignment.Center) {
        if (task.done != null) Plain("✓", 13.sp, Ink.paper, FontWeight.Bold)
    }
}

@Composable internal fun Field(value: String, hint: String, modifier: Modifier = Modifier, big: Boolean = false, single: Boolean = true, onDone: () -> Unit = {}, onChange: (String) -> Unit) {
    BasicTextField(value, onChange, modifier.fillMaxWidth().border(1.dp, Ink.line, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 10.dp),
        singleLine = single, textStyle = TextStyle(fontSize = if (big) 17.sp else 14.5.sp, fontWeight = if (big) FontWeight.SemiBold else FontWeight.Normal, color = Ink.text),
        keyboardOptions = KeyboardOptions(imeAction = if (single) ImeAction.Done else ImeAction.Default), keyboardActions = KeyboardActions(onDone = { onDone() }),
        cursorBrush = androidx.compose.ui.graphics.SolidColor(Ink.text), decorationBox = { inner -> if (value.isEmpty()) Plain(hint, if (big) 17.sp else 14.5.sp, Ink.faint); inner() })
}

@Composable internal fun Picks(items: List<Pair<Int, String>>, on: (Int) -> Boolean, onTap: (Int) -> Unit) {
    @OptIn(ExperimentalLayoutApi::class)
    FlowRow(Modifier.padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { (value, name) ->
            val active = on(value)
            Box(Modifier.height(32.dp).clip(RoundedCornerShape(8.dp)).background(if (active) Ink.brand else Ink.paper).border(1.dp, if (active) Ink.brand else Ink.line, RoundedCornerShape(8.dp))
                .clickable { onTap(value) }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                Plain(name, 13.sp, if (active) androidx.compose.material3.MaterialTheme.colorScheme.onPrimary else Ink.text)
            }
        }
    }
}

/** One's own task: everything about it changed in place and kept at once. The same as src/campus/timetable/TaskSheet.tsx. */
@Composable fun TaskSheet(task: Task, line: CampusLine, store: TaskStore, top: (@Composable () -> Unit)?, onClose: () -> Unit) {
    val context = LocalContext.current
    var title by remember(task.id) { mutableStateOf(task.title) }
    var note by remember(task.id) { mutableStateOf(task.note.orEmpty()) }
    var step by remember(task.id) { mutableStateOf("") }
    fun save(change: (Task) -> Task) = store.save(change(task))
    // Steps are read from the store, so a step added here shows at once.
    val all by store.all.collectAsStateWithLifecycle()
    val steps = TaskStore.live(all).filter { it.parent == task.id }
    val courses = line.meetings.associate { TimetablePresentation.identity(it) to Names.courseShort(it.course.name) }
    val timed = task.start != null
    PlainSheet(task.title, { if (title.isNotBlank() && title.trim() != task.title) save { it.copy(title = title.trim()) }; onClose() }, top, Ink.paper to Ink.text) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Field(title, "任务", big = true, onDone = { if (title.isNotBlank()) save { it.copy(title = title.trim()) } }) { title = it }
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val date = task.date?.let(LocalDate::parse)
                Chip(date?.let { "${dateLabel(it)} ${WEEKDAYS[it.dayOfWeek.value]}" } ?: "选日期", {
                    val at = date ?: LocalDate.now(CampusDay.zone)
                    DatePickerDialog(context, { _, y, m, d -> save { it.copy(date = LocalDate.of(y, m + 1, d).toString()) } }, at.year, at.monthValue - 1, at.dayOfMonth).show()
                })
                if (date != null) Chip(task.start?.let { hm(it) } ?: "加时间", {
                    val at = task.start ?: (9 * 60)
                    TimePickerDialog(context, { _, h, m -> save { it.copy(start = h * 60 + m, end = null, remind = null) } }, at / 60, at % 60, true).show()
                })
                if (timed) Chip(task.end?.let { "到 ${hm(it)}" } ?: "加结束", {
                    val at = task.end ?: (task.start!! + 60)
                    TimePickerDialog(context, { _, h, m -> val end = h * 60 + m; save { it.copy(end = end.takeIf { it > task.start!! }) } }, (at / 60) % 24, at % 60, true).show()
                })
                if (date != null) Chip("清除", { save { it.copy(date = null, start = null, end = null, remind = null) } })
            }
            if (task.date != null) {
                Plain(if (timed) "提醒" else "提醒 · 当天截止的任务在这些时刻提醒", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                Picks(if (timed) Tasks.TIMED_REMINDERS else Tasks.DAY_REMINDERS, { it in task.remind.orEmpty() }) { minutes ->
                    save { it.copy(remind = (if (minutes in it.remind.orEmpty()) it.remind.orEmpty() - minutes else it.remind.orEmpty() + minutes).sorted().ifEmpty { null }) }
                }
            }
            Plain("优先级", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
            Picks(listOf(0 to "无", 1 to "低", 2 to "中", 3 to "高"), { (task.priority ?: 0) == it }) { value -> save { it.copy(priority = value.takeIf { it > 0 }) } }
            if (courses.isNotEmpty()) {
                Plain("课程", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
                val keys = courses.keys.toList()
                Picks(listOf(-1 to "不属于哪门课") + keys.mapIndexed { index, key -> index to courses.getValue(key) }, { if (it < 0) task.course == null else task.course == keys[it] }) { index ->
                    save { it.copy(course = if (index < 0) null else keys[index]) }
                }
            }
            Plain("步骤", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
            steps.forEach { item ->
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TaskCheck(item, store)
                    Title(item, Modifier.weight(1f))
                    Plain("删除", 13.sp, Ink.muted, modifier = Modifier.clickable { store.delete(item.id) })
                }
            }
            Field(step, "加一个步骤，回车", onDone = { if (step.isNotBlank()) { store.save(Task(store.newId(), step.trim(), parent = task.id, modified = "")); step = "" } }) { step = it }
            Plain("备注", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
            Field(note, "", single = false, modifier = Modifier.heightIn(min = 72.dp)) { note = it; save { current -> current.copy(note = it.trim().ifEmpty { null }) } }
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton("删除", modifier = Modifier.weight(1f)) { store.delete(task.id); onClose() }
                ActionButton(if (task.done != null) "标为未完成" else "完成", go = true, modifier = Modifier.weight(1f)) { store.toggleDone(task) }
            }
        }
    }
}

/** A task's title, struck through once it is done. */
@Composable private fun Title(task: Task, modifier: Modifier = Modifier) = androidx.compose.material3.Text(task.title, modifier, maxLines = 1,
    style = TextStyle(fontSize = 15.sp, color = if (task.done != null) Ink.faint else Ink.text, textDecoration = if (task.done != null) TextDecoration.LineThrough else null))

/** The line as a list: one's tasks by when they are due, the exams among them. A task is added here in one line. */
@Composable fun TaskList(line: CampusLine, now: Moment, store: TaskStore, onOpen: (LineEvent) -> Unit) {
    var draft by remember { mutableStateOf("") }
    var showDone by remember { mutableStateOf(false) }
    val top = line.tasks.filter { it.parent == null }
    val open = top.filter { it.done == null }.sortedWith(Tasks.order)
    val done = top.filter { it.done != null }.sortedByDescending { it.done }
    val exams = line.upcomingExams(now.date)
    val courses = line.meetings.associate { TimetablePresentation.identity(it) to Names.course(it.course.name) }
    fun add() { if (draft.isBlank()) return; val quick = Tasks.parse(draft, now); store.save(Task(store.newId(), quick.title, date = quick.date, start = quick.start, modified = "")); draft = "" }
    fun whenText(task: Task): String {
        val date = task.date?.let(LocalDate::parse) ?: return ""
        val days = CampusLine.daysBetween(now.date, date)
        return listOf(if (days == 0) "今天" else if (days == 1) "明天" else "${dateLabel(date)} ${WEEKDAYS[date.dayOfWeek.value]}",
            task.start?.let { hm(it) + (task.end?.let { end -> "–${hm(end)}" } ?: "") }.orEmpty()).filter { it.isNotEmpty() }.joinToString(" ")
    }
    @Composable fun row(task: Task) {
        val parts = line.tasks.filter { it.parent == task.id }
        Row(Modifier.fillMaxWidth().topHairline(Ink.line).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TaskCheck(task, store)
            Column(Modifier.weight(1f).clickable { onOpen(taskEvent(task, now.date)) }) {
                Title(task)
                val meta = listOf(whenText(task), task.course?.let { courses[it] }.orEmpty(), if (parts.isNotEmpty()) "步骤 ${parts.count { it.done != null }}/${parts.size}" else "", if (task.note != null) "有备注" else "").filter { it.isNotEmpty() }.joinToString(" · ")
                if (meta.isNotEmpty()) Plain(meta, 12.sp, Ink.muted, maxLines = 1)
            }
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Field(draft, "添加任务，如：明天 14:00 交毛概作业", Modifier.weight(1f), onDone = ::add) { draft = it }
            if (draft.isNotBlank()) Chip("添加", ::add, Modifier.padding(start = 8.dp))
        }
        Tasks.GROUPS.forEach { (key, name) ->
            val tasks = open.filter { Tasks.group(it, now) == key }
            val dated = if (key == "overdue" || key == "someday") emptyList() else exams.filter { exam ->
                val days = CampusLine.daysBetween(now.date, LocalDate.parse(exam.date))
                key == when { days == 0 -> "today"; days == 1 -> "tomorrow"; days <= 7 -> "week"; else -> "later" }
            }
            if (tasks.isEmpty() && dated.isEmpty()) return@forEach
            Row(Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 6.dp)) {
                Plain(name, 13.sp, if (key == "overdue") marks().danger else Ink.muted, FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Plain("${tasks.size + dated.size}", 13.sp, Ink.faint)
            }
            dated.forEach { exam ->
                val event = line.on(LocalDate.parse(exam.date)).firstOrNull { it.exam?.id == exam.id }
                Row(Modifier.fillMaxWidth().topHairline(Ink.line).clickable { event?.let(onOpen) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    SmallTag("考试", marks().exam, marks().onExam)
                    Column(Modifier.weight(1f)) {
                        Plain(Names.course(exam.course.name), 15.sp, maxLines = 1)
                        Plain("${dateLabel(LocalDate.parse(exam.date))} ${WEEKDAYS[LocalDate.parse(exam.date).dayOfWeek.value]} ${exam.start} · ${Names.room(exam.room ?: exam.location)}", 12.sp, Ink.muted, maxLines = 1)
                    }
                }
            }
            tasks.forEach { row(it) }
        }
        if (open.isEmpty() && exams.isEmpty()) Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain("没有要做的事。在上面输入一件，回车就加上了。", 14.sp, Ink.faint) }
        if (done.isNotEmpty()) {
            Plain("已完成 ${done.size} 项 ${if (showDone) "⌃" else "⌄"}", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp).clickable { showDone = !showDone })
            if (showDone) done.forEach { row(it) }
        }
        Spacer(Modifier.height(24.dp))
    }
}
