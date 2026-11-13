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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Notes
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.Icon
import androidx.compose.ui.graphics.compositeOver
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
/** The days most often meant, as quickDays in src/campus/timetable/TaskSheet.tsx: today, tomorrow, the day after, this Friday, next Monday. */
private fun quickDays(today: LocalDate): List<Pair<String, LocalDate>> {
    val weekday = today.dayOfWeek.value
    val friday = today.plusDays(((5 - weekday + 7) % 7).toLong())
    return listOfNotNull("今天" to today, "明天" to today.plusDays(1), "后天" to today.plusDays(2), ("周五" to friday).takeIf { friday > today.plusDays(2) }, "下周一" to today.plusDays((8 - weekday).toLong()))
}

/**
 * One's own task, as src/campus/timetable/TaskSheet.tsx: its title edited where it stands; when it is planned, when it
 * is due, how important it is and its course in one row, each opening its own few choices in place; then its steps
 * and a note. Everything is kept as it is changed.
 */
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
    var panel by remember(task.id) { mutableStateOf<String?>(null) }
    var slots by remember(task, line.preferences) { mutableStateOf<List<TimeSlot>?>(null) }
    fun save(change: (Task) -> Task) = store.save(change(task))
    // Steps are read from the store, so a step added here shows at once.
    val all by store.all.collectAsStateWithLifecycle()
    val steps = TaskStore.live(all).filter { it.parent == task.id }
    val courses = line.meetings.associate { TimetablePresentation.identity(it) to (line.names[TimetablePresentation.identity(it)] ?: Names.course(it.course.name)) }
    val at = CampusDay.now()
    val now = Moment(at.toLocalDate(), at.hour * 60 + at.minute)
    fun day(value: String): String { val date = LocalDate.parse(value); val days = CampusLine.daysBetween(now.date, date); return when { days == 0 -> "今天"; days == 1 -> "明天"; days == -1 -> "昨天"; days in 2..6 -> WEEKDAYS[date.dayOfWeek.value]; else -> dateLabel(date) } }
    val duration = if (task.start != null && task.end != null) task.end - task.start else 30
    fun planOn(date: LocalDate) = save { it.copy(date = date.toString(), start = it.start ?: 540, end = it.end ?: ((it.start ?: 540) + duration)) }
    fun toggle(list: List<Int>?, minutes: Int) = (if (minutes in list.orEmpty()) list.orEmpty() - minutes else list.orEmpty() + minutes).sorted().ifEmpty { null }
    val late = task.due != null && task.done == null && (task.due.date < now.date.toString() || (task.due.date == now.date.toString() && (task.due.time ?: 1440) <= now.min))
    val brand = Ink.brand
    @Composable fun TagChip(text: String, set: Boolean, key: String, color: Color = Ink.text) {
        val open = panel == key
        Box(Modifier.clip(RoundedCornerShape(16.dp)).border(1.dp, if (open) brand else if (late && key == "due") marks().danger else if (set) Ink.faint else Ink.line, RoundedCornerShape(16.dp))
            .clickable { panel = if (open) null else key }.padding(horizontal = 12.dp, vertical = 6.dp)) {
            Plain(text, 13.5.sp, if (open) brand else if (late && key == "due") marks().danger else if (set) color else Ink.muted)
        }
    }
    @Composable fun Panel(content: @Composable ColumnScope.() -> Unit) = Column(Modifier.fillMaxWidth().padding(bottom = 12.dp).clip(RoundedCornerShape(12.dp)).background(Ink.sunken).padding(12.dp), content = content)
    PlainSheet("", { if (title.isNotBlank() && title.trim() != task.title) save { it.copy(title = title.trim()) }; onClose() }, top) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TaskCheck(task, store)
                Field(title, "任务", Modifier.weight(1f), big = true, onDone = { if (title.isNotBlank()) save { it.copy(title = title.trim()) } }) { title = it }
            }
            FlowRow(Modifier.padding(top = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                TagChip(task.date?.let { "${day(it)} ${task.start?.let(::hm).orEmpty()}${task.end?.let { end -> "–${hm(end)}" }.orEmpty()}" } ?: "安排时间", task.date != null, "plan")
                TagChip(task.due?.let { "${day(it.date)}${it.time?.let { time -> " ${hm(time)}" }.orEmpty()} 截止" } ?: "截止", task.due != null, "due")
                TagChip(task.priority?.let { listOf("", "低", "中", "高")[it] + "优先级" } ?: "优先级", task.priority != null, "priority", task.priority?.let { if (it == 3) marks().danger else PRIORITY_COLORS[it] } ?: Ink.text)
                if (courses.isNotEmpty()) TagChip(task.course?.let { courses[it] }?.let(Names::courseShort) ?: "课程", task.course != null, "course")
            }
            when (panel) {
                "plan" -> Panel {
                    Picks(quickDays(now.date).mapIndexed { index, (name, _) -> index to name }, { quickDays(now.date)[it].second.toString() == task.date }) { planOn(quickDays(now.date)[it].second) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip(task.date?.let { "${dateLabel(LocalDate.parse(it))} ${WEEKDAYS[LocalDate.parse(it).dayOfWeek.value]}" } ?: "选日期", {
                            val start = task.date?.let(LocalDate::parse) ?: now.date
                            DatePickerDialog(context, { _, y, m, d -> planOn(LocalDate.of(y, m + 1, d)) }, start.year, start.monthValue - 1, start.dayOfMonth).show()
                        })
                        if (task.date != null) Chip("开始 ${hm(task.start!!)}", {
                            TimePickerDialog(context, { _, h, m -> val start = h * 60 + m; save { it.copy(start = start, end = (start + duration).coerceAtMost(1440)) } }, task.start / 60, task.start % 60, true).show()
                        })
                    }
                    if (task.date != null) {
                        Plain("用时", 12.5.sp, Ink.muted, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
                        Picks(listOf(15 to "15 分钟", 30 to "30 分钟", 60 to "1 小时", 90 to "1.5 小时", 120 to "2 小时"), { it == duration }) { minutes -> save { it.copy(end = (it.start!! + minutes).coerceAtMost(1440)) } }
                        Plain("提醒", 12.5.sp, Ink.muted, modifier = Modifier.padding(bottom = 4.dp))
                        Picks(Tasks.TIMED_REMINDERS, { it in task.remind.orEmpty() }) { minutes -> if (minutes !in task.remind.orEmpty()) ensureNotifications(); save { it.copy(remind = toggle(it.remind, minutes)) } }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip("找一段空闲", { slots = Planning.available(line, SlotRequest(now.date, now.date.plusDays(6), duration, exclude = task.id, due = task.due), now).take(6) })
                        if (task.date != null) Chip("不安排时间", { save { it.copy(date = null, start = null, end = null, remind = null) } })
                    }
                    slots?.let { choices ->
                        if (choices.isEmpty()) Plain("截止前的七天里没有合适的空闲，可以缩短用时。", 13.sp, Ink.muted, modifier = Modifier.padding(top = 8.dp))
                        choices.forEach { slot -> KeyRow(null, "${day(slot.date.toString())} ${hm(slot.start)}–${hm(slot.end)}", if (slot.penalty > 0) "与 ${slot.clashes.size} 项尽量避开的安排重叠" else "这段时间没有别的安排", chevron = true, onClick = { save { it.copy(date = slot.date.toString(), start = slot.start, end = slot.end) }; slots = null }) }
                    }
                }
                "due" -> Panel {
                    Picks(quickDays(now.date).mapIndexed { index, (name, _) -> index to name }, { quickDays(now.date)[it].second.toString() == task.due?.date }) { index -> save { it.copy(due = (it.due ?: TaskDeadline("")).copy(date = quickDays(now.date)[index].second.toString())) } }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip(task.due?.date?.let { dateLabel(LocalDate.parse(it)) } ?: "选日期", {
                            val start = task.due?.date?.let(LocalDate::parse) ?: now.date
                            DatePickerDialog(context, { _, y, m, d -> save { it.copy(due = (it.due ?: TaskDeadline("")).copy(date = LocalDate.of(y, m + 1, d).toString())) } }, start.year, start.monthValue - 1, start.dayOfMonth).show()
                        })
                        if (task.due != null) Chip(task.due.time?.let { "时间 ${hm(it)}" } ?: "当天结束前", {
                            val time = task.due.time ?: (18 * 60)
                            TimePickerDialog(context, { _, h, m -> save { it.copy(due = it.due?.copy(time = h * 60 + m, remind = null)) } }, time / 60, time % 60, true).show()
                        })
                    }
                    task.due?.let { due ->
                        Plain("提醒", 12.5.sp, Ink.muted, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
                        Picks(if (due.time == null) Tasks.DAY_REMINDERS else Tasks.TIMED_REMINDERS, { it in due.remind.orEmpty() }) { minutes -> if (minutes !in due.remind.orEmpty()) ensureNotifications(); save { it.copy(due = it.due?.copy(remind = toggle(it.due.remind, minutes))) } }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (due.time != null) Chip("改为当天结束前", { save { it.copy(due = it.due?.copy(time = null, remind = null)) } })
                            Chip("不设截止", { save { it.copy(due = null) } })
                        }
                    }
                }
                "priority" -> Panel { Picks(listOf(0 to "无", 1 to "低", 2 to "中", 3 to "高"), { (task.priority ?: 0) == it }) { value -> save { it.copy(priority = value.takeIf { it > 0 }) }; panel = null } }
                "course" -> Panel {
                    val keys = courses.keys.toList()
                    Picks(listOf(-1 to "不属于哪门课") + keys.mapIndexed { index, key -> index to Names.courseShort(courses.getValue(key)) }, { if (it < 0) task.course == null else task.course == keys[it] }) { index -> save { it.copy(course = if (index < 0) null else keys[index]) }; panel = null }
                }
            }
            if (permissionDenied) Plain("通知权限尚未开启，请在系统设置中允许 StuDev 通知。", 13.sp, marks().danger)
            steps.forEach { item ->
                Row(Modifier.fillMaxWidth().bottomHairline(Ink.line).padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TaskCheck(item, store)
                    Title(item, Modifier.weight(1f))
                    Plain("×", 16.sp, Ink.faint, modifier = Modifier.clickable { store.delete(item.id) }.padding(horizontal = 6.dp))
                }
            }
            Field(step, "+ 添加步骤", Modifier.padding(top = 6.dp), onDone = { if (step.isNotBlank()) { store.save(Task(store.newId(), step.trim(), parent = task.id, modified = "")); step = "" } }) { step = it }
            Field(note, "备注", Modifier.padding(top = 10.dp).heightIn(min = 72.dp), single = false) { note = it; save { current -> current.copy(note = it.trim().ifEmpty { null }) } }
            var more by remember(task.id) { mutableStateOf(false) }
            Plain(if (more) "更多 ⌃" else "更多 ⌄", 13.sp, Ink.muted, modifier = Modifier.padding(top = 12.dp).clickable { more = !more })
            if (more) EventChoices(taskEvent(task, now.date), line, settings)
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton("删除", modifier = Modifier.weight(1f)) { store.delete(task.id); onClose() }
                ActionButton(if (task.done != null) "标为未完成" else "完成", go = true, modifier = Modifier.weight(1f)) { store.toggleDone(task); if (task.done == null) onClose() }
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
    // Groups folded away, as a list keeps them closed while one works on another.
    var folded by remember { mutableStateOf(emptySet<String>()) }
    val tones = remember(line) { TimetablePresentation.tones(line) }
    val top = line.tasks.filter { it.parent == null }
    val open = top.filter { it.done == null }.sortedWith(Tasks.order)
    val done = top.filter { it.done != null }.sortedByDescending { it.done }
    val exams = line.upcomingExams(now.date)
    val courses = line.meetings.associate { TimetablePresentation.identity(it) to (line.names[TimetablePresentation.identity(it)] ?: Names.course(it.course.name)) }
    val quickCourses = remember(line.meetings) { line.meetings.distinctBy { TimetablePresentation.identity(it) }.map { Tasks.QuickCourse(TimetablePresentation.identity(it), listOf(Names.course(it.course.name), Names.courseShort(it.course.name))) } }
    val quick = if (draft.isNotBlank()) Tasks.parse(draft, now, quickCourses) else null
    // What the list was told to stop offering, kept on this device, as readHints in src/campus/world/suggestions.ts.
    val prefs = LocalContext.current.getSharedPreferences("task_hints", android.content.Context.MODE_PRIVATE)
    var setAside by remember { mutableStateOf(prefs.getStringSet("setAside", emptySet()).orEmpty()) }
    var dragTold by remember { mutableStateOf(prefs.getBoolean("dragTold", false)) }
    val suggested = Suggestions.suggest(line, now, setAside)
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
                task.course?.let { id -> courses[id]?.let { CourseTag(Names.courseShort(it), tones[id]) } }
                if (parts.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Checklist, "步骤", Modifier.size(13.dp), tint = Ink.faint); Plain("${parts.count { it.done != null }}/${parts.size}", 12.sp, Ink.faint) }
                if (task.note != null) Icon(Icons.Outlined.Notes, "有备注", Modifier.size(13.dp), tint = Ink.faint)
                if (!task.remind.isNullOrEmpty() || !task.due?.remind.isNullOrEmpty()) Icon(Icons.Outlined.NotificationsNone, "有提醒", Modifier.size(13.dp), tint = Ink.faint)
                val text = whenText(task)
                if (text.isNotEmpty()) {
                    val group = Tasks.group(task, now)
                    Plain(text, 12.sp, when (group) { "overdue" -> marks().danger; "today" -> brand; else -> brand.copy(alpha = .78f).compositeOver(Ink.text) }, if (group == "today") FontWeight.Medium else FontWeight.Normal, maxLines = 1)
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
        if (draft.isEmpty() && open.isEmpty()) FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Suggestions.EXAMPLES.forEach { example -> Box(Modifier.clip(RoundedCornerShape(14.dp)).border(1.dp, Ink.line, RoundedCornerShape(14.dp)).clickable { draft = example }.padding(horizontal = 10.dp, vertical = 4.dp)) { Plain(example, 12.5.sp, Ink.muted) } }
        }
        if (open.size > 1 && !dragTold) Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Plain("按住一件事可以拖动，拖到“今天”“明天”就改了日期", 12.5.sp, Ink.faint, modifier = Modifier.weight(1f))
            Plain("×", 15.sp, Ink.faint, modifier = Modifier.clickable { dragTold = true; prefs.edit().putBoolean("dragTold", true).apply() }.padding(horizontal = 6.dp))
        }
        Spacer(Modifier.height(8.dp))
        if (suggested.isNotEmpty() && dragId == null) {
            Plain("从你的安排里", 13.sp, brand, FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp, bottom = 6.dp))
            suggested.forEach { (key, task) ->
                Row(Modifier.fillMaxWidth().topHairline(Ink.line).padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(22.dp).clip(RoundedCornerShape(5.dp)).border(1.5.dp, brand, RoundedCornerShape(5.dp)).clickable { store.save(task.copy(id = store.newId(), order = -System.currentTimeMillis().toDouble())) }, contentAlignment = Alignment.Center) { Plain("+", 15.sp, brand) }
                    Plain(task.title, 15.sp, maxLines = 1, modifier = Modifier.weight(1f))
                    task.course?.let { id -> courses[id]?.let { CourseTag(Names.courseShort(it), tones[id]) } }
                    Plain("${dayWord(task.due!!.date)} 截止", 12.sp, Ink.muted, maxLines = 1)
                    Plain("×", 15.sp, Ink.faint, modifier = Modifier.clickable { setAside = setAside + key; prefs.edit().putStringSet("setAside", setAside).apply() }.padding(horizontal = 4.dp))
                }
            }
        }
        Tasks.GROUPS.forEach { (key, name) ->
            val tasks = grouped(key)
            val shown = tasks.filter { it.id != dragId }
            val dated = if (key == "overdue" || key == "someday") emptyList() else exams.filter { exam ->
                val days = CampusLine.daysBetween(now.date, LocalDate.parse(exam.date))
                key == when { days == 0 -> "today"; days == 1 -> "tomorrow"; days <= 7 -> "week"; else -> "later" }
            }
            val dropHere = dragId != null && key in Tasks.DROP_GROUPS
            if (tasks.isEmpty() && dated.isEmpty() && !dropHere) { slots.remove("e:$key"); return@forEach }
            val shut = key in folded && dragId == null
            Row(Modifier.fillMaxWidth().clickable { folded = if (key in folded) folded - key else folded + key }.padding(top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                val ink = if (key == "overdue") marks().danger else Ink.muted
                Icon(Icons.Outlined.ChevronRight, if (shut) "展开" else "收起", Modifier.size(16.dp).graphicsLayer { rotationZ = if (shut) 0f else 90f }, tint = ink)
                Spacer(Modifier.width(4.dp))
                Plain(name, 13.sp, ink, FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (shown.size + dated.size > 0) Plain("${shown.size + dated.size}", 13.sp, Ink.faint)
            }
            if (shut) { tasks.forEach { slots.remove("t:${it.id}") }; slots.remove("e:$key"); return@forEach }
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

/** A task's course as a small tag in the course's colour, as .tcourse on the web. */
@Composable private fun CourseTag(name: String, toneIndex: Int?) {
    val mark = toneIndex?.let { tone(it) }
    Box(Modifier.widthIn(max = 84.dp).clip(RoundedCornerShape(9.dp)).background(mark?.bg ?: Ink.sunken).padding(horizontal = 7.dp, vertical = 1.dp)) { Plain(name, 11.5.sp, mark?.fg ?: Ink.muted, FontWeight.Medium, maxLines = 1) }
}
