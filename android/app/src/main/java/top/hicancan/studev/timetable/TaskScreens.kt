package top.hicancan.studev.timetable

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.Manifest
import android.os.Build
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.zIndex
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
@OptIn(ExperimentalLayoutApi::class)
@Composable fun TaskSheet(task: Task, line: CampusLine, store: TaskStore, settings: top.hicancan.studev.me.CampusSettings, top: (@Composable () -> Unit)?, onClose: () -> Unit) {
    val context = LocalContext.current
    var permissionDenied by remember { mutableStateOf(false) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permissionDenied = !it }
    fun ensureNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    var title by remember(task.id) { mutableStateOf(task.title) }
    var note by remember(task.id) { mutableStateOf(task.note.orEmpty()) }
    var step by remember(task.id) { mutableStateOf("") }
    var duration by remember(task.id, task.start, task.end) { mutableStateOf(if (task.start != null && task.end != null) task.end - task.start else 30) }
    var slots by remember(task, line.preferences) { mutableStateOf<List<TimeSlot>?>(null) }
    fun save(change: (Task) -> Task) = store.save(change(task))
    // Steps are read from the store, so a step added here shows at once.
    val all by store.all.collectAsStateWithLifecycle()
    val steps = TaskStore.live(all).filter { it.parent == task.id }
    val courses = line.meetings.associate { TimetablePresentation.identity(it) to (line.names[TimetablePresentation.identity(it)] ?: Names.courseShort(it.course.name)) }
    val timed = task.start != null
    PlainSheet(task.title, { if (title.isNotBlank() && title.trim() != task.title) save { it.copy(title = title.trim()) }; onClose() }, top, Ink.paper to Ink.text) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Field(title, "任务", big = true, onDone = { if (title.isNotBlank()) save { it.copy(title = title.trim()) } }) { title = it }
            Plain("计划执行", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
            FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val date = task.date?.let(LocalDate::parse)
                Chip(date?.let { "${dateLabel(it)} ${WEEKDAYS[it.dayOfWeek.value]}" } ?: "选日期", {
                    val at = date ?: LocalDate.now(CampusDay.zone)
                    DatePickerDialog(context, { _, y, m, d -> save { it.copy(date = LocalDate.of(y, m + 1, d).toString(), start = it.start ?: 540) } }, at.year, at.monthValue - 1, at.dayOfMonth).show()
                })
                if (date != null) Chip(task.start?.let { hm(it) } ?: "加时间", {
                    val at = task.start ?: (9 * 60)
                    TimePickerDialog(context, { _, h, m -> save { it.copy(start = h * 60 + m, end = it.end?.takeIf { end -> end > h * 60 + m }) } }, at / 60, at % 60, true).show()
                })
                if (timed) Chip(task.end?.let { "到 ${hm(it)}" } ?: "加结束", {
                    val at = (task.end ?: (task.start!! + 60)).coerceAtMost(1439)
                    TimePickerDialog(context, { _, h, m -> val end = h * 60 + m; save { it.copy(end = end.takeIf { it > task.start!! }) } }, (at / 60) % 24, at % 60, true).show()
                })
                if (date != null) Chip("清除", { save { it.copy(date = null, start = null, end = null, remind = null) } })
            }
            Picks(listOf(15 to "15 分钟", 30 to "30 分钟", 60 to "1 小时", 90 to "1.5 小时", 120 to "2 小时"), { it == duration }) { duration = it; slots = null }
            Chip("找合适时间", {
                val at = CampusDay.now()
                val now = Moment(at.toLocalDate(), at.hour * 60 + at.minute)
                val all = Planning.available(line, SlotRequest(now.date, now.date.plusDays(6), duration, exclude = task.id, due = task.due), now)
                slots = all.take(6)
            })
            slots?.let { choices ->
                if (choices.isEmpty()) Plain("截止前的未来七天内没有合适时段，可以调整用时或排程偏好。", 13.sp, Ink.muted)
                choices.forEach { slot -> KeyRow(null, "${dateLabel(slot.date)} ${hm(slot.start)}–${hm(slot.end)}", if (slot.penalty > 0) "与 ${slot.clashes.size} 项尽量避开的安排重叠" else "符合排程偏好", onClick = { save { it.copy(date = slot.date.toString(), start = slot.start, end = slot.end) } }) }
            }
            if (task.date != null) {
                Plain("执行提醒", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                Picks(Tasks.TIMED_REMINDERS, { it in task.remind.orEmpty() }) { minutes ->
                    if (minutes !in task.remind.orEmpty()) ensureNotifications()
                    save { it.copy(remind = (if (minutes in it.remind.orEmpty()) it.remind.orEmpty() - minutes else it.remind.orEmpty() + minutes).sorted().ifEmpty { null }) }
                }
            }
            Plain("截止时间", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val date = task.due?.date?.let(LocalDate::parse)
                Chip(date?.let { dateLabel(it) } ?: "选截止日期", {
                    val at = date ?: LocalDate.now(CampusDay.zone)
                    DatePickerDialog(context, { _, y, m, d -> save { it.copy(due = (it.due ?: TaskDeadline("")).copy(date = LocalDate.of(y, m + 1, d).toString())) } }, at.year, at.monthValue - 1, at.dayOfMonth).show()
                })
                if (date != null) {
                    Chip(task.due?.time?.let(::hm) ?: "当天结束", {
                        val at = task.due?.time ?: 18 * 60
                        TimePickerDialog(context, { _, h, m -> save { it.copy(due = it.due?.copy(time = h * 60 + m, remind = null)) } }, at / 60, at % 60, true).show()
                    })
                    if (task.due?.time != null) Chip("改为当天结束", { save { it.copy(due = it.due?.copy(time = null, remind = null)) } })
                    Chip("清除截止", { save { it.copy(due = null) } })
                }
            }
            task.due?.let { due ->
                Plain("截止提醒", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
                Picks(if (due.time == null) Tasks.DAY_REMINDERS else Tasks.TIMED_REMINDERS, { it in due.remind.orEmpty() }) { minutes ->
                    if (minutes !in due.remind.orEmpty()) ensureNotifications()
                    save { it.copy(due = it.due?.copy(remind = (if (minutes in due.remind.orEmpty()) due.remind.orEmpty() - minutes else due.remind.orEmpty() + minutes).sorted().ifEmpty { null })) }
                }
            }
            EventChoices(taskEvent(task, LocalDate.now(CampusDay.zone)), line, settings)
            if (permissionDenied) Plain("通知权限尚未开启，请在系统设置中允许 StuDev 通知。", 13.sp, marks().danger)
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

/** Where a row or an empty group sits on the screen while a task is dragged. */
private data class Slot(val group: String, val index: Int, val top: Float, val bottom: Float, val empty: Boolean)

/**
 * The line as a list, as src/campus/timetable/views/ListView.tsx: one's tasks by when they are due, the exams among
 * them. A task is added in one line, what it says read back as it is typed; a task held a moment is dragged
 * elsewhere in its group, or into today, tomorrow or no day at all.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun TaskList(line: CampusLine, now: Moment, store: TaskStore, onOpen: (LineEvent) -> Unit) {
    var draft by remember { mutableStateOf("") }
    var showDone by remember { mutableStateOf(false) }
    val top = line.tasks.filter { it.parent == null }
    val open = top.filter { it.done == null }.sortedWith(Tasks.order)
    val done = top.filter { it.done != null }.sortedByDescending { it.done }
    val exams = line.upcomingExams(now.date)
    val courses = line.meetings.associate { TimetablePresentation.identity(it) to (line.names[TimetablePresentation.identity(it)] ?: Names.course(it.course.name)) }
    val quickCourses = remember(line.meetings) { line.meetings.distinctBy { TimetablePresentation.identity(it) }.map { Tasks.QuickCourse(TimetablePresentation.identity(it), listOf(Names.course(it.course.name), Names.courseShort(it.course.name))) } }
    val quick = if (draft.isNotBlank()) Tasks.parse(draft, now, quickCourses) else null
    fun add() {
        val read = quick ?: return
        // A task just added goes first in its group, where it is seen.
        store.save(Task(store.newId(), read.title, date = read.date, start = read.start, end = read.end, due = read.due, priority = read.priority, course = read.course, order = -System.currentTimeMillis().toDouble(), modified = ""))
        draft = ""
    }
    fun dayWord(value: String): String {
        val date = LocalDate.parse(value)
        val days = CampusLine.daysBetween(now.date, date)
        return when { days == 0 -> "今天"; days == 1 -> "明天"; days == -1 -> "昨天"; days in 2..6 -> WEEKDAYS[date.dayOfWeek.value]; else -> dateLabel(date) }
    }
    fun whenText(task: Task) = listOfNotNull(
        task.date?.let { "${dayWord(it)} ${task.start?.let(::hm).orEmpty()}${task.end?.let { end -> "–${hm(end)}" }.orEmpty()}" },
        task.due?.let { "${if (task.date != null) "截止 " else ""}${dayWord(it.date)}${it.time?.let { time -> " ${hm(time)}" }.orEmpty()}${if (task.date != null) "" else " 截止"}" },
    ).joinToString(" · ")
    fun grouped(key: String) = open.filter { Tasks.group(it, now) == key }

    // Dragging: the task held, how far it has moved, where it would go, and where everything it could go sits.
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    var dragId by remember { mutableStateOf<String?>(null) }
    var dragOffset by remember { mutableFloatStateOf(0f) }
    var target by remember { mutableStateOf<Pair<String, Int>?>(null) }
    var dragGroup by remember { mutableStateOf<String?>(null) }
    /** A task goes back into its own group, or into one that gives it a day; the others are not where it can go. */
    fun accepts(group: String) = dragId != null && (group == dragGroup || group in Tasks.DROP_GROUPS)
    val slots = remember { mutableStateMapOf<String, Slot>() }
    val tops = remember { mutableStateMapOf<String, Float>() }
    fun nearest(y: Float): Pair<String, Int>? {
        var best: Pair<String, Int>? = null
        var distance = Float.MAX_VALUE
        for (slot in slots.values.filter { accepts(it.group) }) {
            val edges = if (slot.empty) listOf((slot.top + slot.bottom) / 2 to slot.index) else listOf(slot.top to slot.index, slot.bottom to slot.index + 1)
            for ((edge, at) in edges) { val gap = kotlin.math.abs(y - edge); if (gap < distance) { distance = gap; best = slot.group to at } }
        }
        return best
    }
    var startTop by remember { mutableFloatStateOf(0f) }
    var startY by remember { mutableFloatStateOf(0f) }
    var listBox by remember { mutableStateOf<androidx.compose.ui.layout.LayoutCoordinates?>(null) }
    // The gesture is the list's, not a row's: a row moves when an empty group above it opens to take a drop, and a
    // gesture on something that moves is cancelled. It reads the tasks as they are when it ends.
    val latestOpen by rememberUpdatedState(open)
    val latestNow by rememberUpdatedState(now)
    val hold = Modifier.onGloballyPositioned { listBox = it }.pointerInput(Unit) {
        detectDragGesturesAfterLongPress(
            onDragStart = { at ->
                val y = listBox?.localToRoot(at)?.y ?: return@detectDragGesturesAfterLongPress
                val (key, slot) = slots.entries.firstOrNull { (key, slot) -> key.startsWith("t:") && y >= slot.top && y <= slot.bottom } ?: return@detectDragGesturesAfterLongPress
                haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
                startY = y; startTop = slot.top; dragGroup = slot.group; dragOffset = 0f; dragId = key.removePrefix("t:"); slots.remove(key)
            },
            onDrag = { change, amount -> if (dragId != null) { change.consume(); dragOffset += amount.y; target = nearest(startY + dragOffset) } },
            onDragEnd = {
                val goal = target
                val task = latestOpen.firstOrNull { it.id == dragId }
                if (goal != null && task != null) store.saveAll(Tasks.move(task, goal.first, goal.second, latestOpen.filter { Tasks.group(it, latestNow) == goal.first }, latestNow))
                dragId = null; dragGroup = null; target = null; dragOffset = 0f
            },
            onDragCancel = { dragId = null; dragGroup = null; target = null; dragOffset = 0f },
        )
    }
    val brand = Ink.brand

    @Composable fun row(task: Task, group: String?, index: Int) {
        val parts = line.tasks.filter { it.parent == task.id }
        val lifted = task.id == dragId
        val key = "t:${task.id}"
        val dropAbove = group != null && !lifted && target == (group to index)
        val dropBelow = group != null && !lifted && target == (group to index + 1) && grouped(group).filter { it.id != dragId }.lastOrNull()?.id == task.id
        // The row's place in the layout, which the list reads to know what a finger holds and where it can go.
        var modifier = Modifier.fillMaxWidth()
        if (group != null) modifier = modifier.onGloballyPositioned { box ->
            val top = box.positionInRoot().y
            tops[task.id] = top
            if (lifted) slots.remove(key) else slots[key] = Slot(group, index, top, top + box.size.height, false)
        }
        if (lifted) modifier = modifier.zIndex(1f)
        // Where it is drawn follows the finger even when what is above it grows as the drag begins.
        val drawn = if (lifted) Modifier.graphicsLayer { translationY = dragOffset + startTop - (tops[task.id] ?: startTop); shadowElevation = 16f; scaleX = 1.02f; scaleY = 1.02f; shape = RoundedCornerShape(10.dp); clip = true }
            else if (group != null && dragId != null && !accepts(group)) Modifier.graphicsLayer { alpha = .4f } else Modifier
        val paper = Ink.paper
        val hair = Ink.line
        Box(modifier) { Row(drawn.fillMaxWidth().background(paper).drawBehind {
            if (!lifted) drawLine(hair, androidx.compose.ui.geometry.Offset(0f, 0f), androidx.compose.ui.geometry.Offset(size.width, 0f), 1f)
            if (dropAbove) drawRect(brand, androidx.compose.ui.geometry.Offset(32.dp.toPx(), -1.dp.toPx()), androidx.compose.ui.geometry.Size(size.width - 32.dp.toPx(), 2.dp.toPx()))
            if (dropBelow) drawRect(brand, androidx.compose.ui.geometry.Offset(32.dp.toPx(), size.height - 1.dp.toPx()), androidx.compose.ui.geometry.Size(size.width - 32.dp.toPx(), 2.dp.toPx()))
        }.padding(horizontal = if (lifted) 10.dp else 0.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TaskCheck(task, store)
            Row(Modifier.weight(1f).clickable(enabled = dragId == null) { onOpen(taskEvent(task, now.date)) }.padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Title(task, Modifier.weight(1f))
                task.course?.let { courses[it] }?.let { Plain(Names.courseShort(it), 12.sp, Ink.faint, maxLines = 1) }
                if (parts.isNotEmpty()) Plain("${parts.count { it.done != null }}/${parts.size}", 12.sp, Ink.faint)
                if (task.note != null) Plain("≡", 12.sp, Ink.faint)
                val text = whenText(task)
                if (text.isNotEmpty()) {
                    val tone = when (Tasks.group(task, now)) { "overdue" -> marks().danger; "today" -> brand; else -> Ink.muted }
                    Plain(text, 12.sp, tone, maxLines = 1)
                }
            }
        } }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState(), enabled = dragId == null).then(hold)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Field(draft, "添加任务，如：明天下午3点 交毛概作业 #毛概 !!", Modifier.weight(1f), onDone = ::add) { draft = it }
            if (draft.isNotBlank()) Chip("添加", ::add, Modifier.padding(start = 8.dp))
        }
        quick?.let { read ->
            val said = listOfNotNull(
                read.date?.let { "${dayWord(it)} ${read.start?.let(::hm).orEmpty()}${read.end?.let { end -> "–${hm(end)}" }.orEmpty()}" },
                read.due?.let { "${dayWord(it.date)}${it.time?.let { time -> " ${hm(time)}" }.orEmpty()} 截止" },
                read.priority?.let { listOf("", "低优先级", "中优先级", "高优先级")[it] },
                read.course?.let { courses[it] }?.let(Names::courseShort),
            )
            FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (said.isEmpty()) Plain("没有读出日期，会放进“还没排日期”", 12.5.sp, Ink.faint)
                said.forEach { Box(Modifier.clip(RoundedCornerShape(6.dp)).background(brand.copy(alpha = .12f)).padding(horizontal = 8.dp, vertical = 2.dp)) { Plain(it, 12.5.sp, brand) } }
                if (said.isNotEmpty()) Plain(read.title, 12.5.sp, Ink.muted, FontWeight.Medium)
            }
        }
        Spacer(Modifier.height(8.dp))
        Tasks.GROUPS.forEach { (key, name) ->
            val tasks = grouped(key)
            val shown = tasks.filter { it.id != dragId }
            val dated = if (key == "overdue" || key == "someday") emptyList() else exams.filter { exam ->
                val days = CampusLine.daysBetween(now.date, LocalDate.parse(exam.date))
                key == when { days == 0 -> "today"; days == 1 -> "tomorrow"; days <= 7 -> "week"; else -> "later" }
            }
            val dropHere = dragId != null && key in Tasks.DROP_GROUPS
            if (tasks.isEmpty() && dated.isEmpty() && !dropHere) { slots.remove("e:$key"); return@forEach }
            Row(Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 6.dp)) {
                Plain(name, 13.sp, if (key == "overdue") marks().danger else Ink.muted, FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (shown.size + dated.size > 0) Plain("${shown.size + dated.size}", 13.sp, Ink.faint)
            }
            dated.forEach { exam ->
                val event = line.on(LocalDate.parse(exam.date)).firstOrNull { it.exam?.id == exam.id }
                Row(Modifier.fillMaxWidth().topHairline(Ink.line).clickable { event?.let(onOpen) }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    SmallTag("考试", marks().exam, marks().onExam)
                    Plain(Names.course(exam.course.name), 15.sp, maxLines = 1, modifier = Modifier.weight(1f))
                    Plain("${dayWord(exam.date)} ${exam.start} · ${Names.room(exam.room ?: exam.location)}", 12.sp, if (key == "today") brand else Ink.muted, maxLines = 1)
                }
            }
            var at = 0
            // Keyed, so that a row keeps its gesture when an empty group above it opens to take a drop.
            tasks.forEach { task -> val slot = if (task.id == dragId) -1 else at++; key(task.id) { row(task, key, slot) } }
            if (shown.isEmpty() && dropHere) {
                val active = target?.first == key
                Box(Modifier.fillMaxWidth().padding(vertical = 4.dp).heightIn(min = 46.dp).border(1.5.dp, if (active) brand else Ink.line, RoundedCornerShape(10.dp))
                    .onGloballyPositioned { box -> val y = box.positionInRoot().y; slots["e:$key"] = Slot(key, 0, y, y + box.size.height, true) }, contentAlignment = Alignment.Center) {
                    Plain(if (key == "someday") "放到这里，去掉日期" else "放到这里，改到$name", 13.sp, if (active) brand else Ink.faint)
                }
            } else slots.remove("e:$key")
        }
        if (open.isEmpty() && exams.isEmpty()) Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain("没有要做的事。在上面输入一件，回车就加上了。", 14.sp, Ink.faint) }
        if (done.isNotEmpty()) {
            Plain("已完成 ${done.size} 项 ${if (showDone) "⌃" else "⌄"}", 13.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp).clickable { showDone = !showDone })
            if (showDone) done.forEach { key(it.id) { row(it, null, 0) } }
        }
        Spacer(Modifier.height(24.dp))
    }
}
