package top.hicancan.studev.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.*
import androidx.glance.action.clickable
import androidx.glance.appwidget.*
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.color.ColorProvider
import androidx.glance.layout.*
import androidx.glance.text.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.studev.MainActivity
import top.hicancan.studev.account.PLATFORM_ORIGIN
import top.hicancan.studev.app.Tokens
import top.hicancan.studev.app.Tone
import top.hicancan.studev.app.darkTone
import top.hicancan.studev.app.lightTone
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.timetable.TimetablePresentation
import top.hicancan.studev.world.*
import java.time.Clock
import java.time.Instant
import java.time.LocalDate

private val KEY = stringPreferencesKey("line")

/**
 * The calendar widget and the list widget, the app's two kinds of view on the home screen, as on the Windows desktop.
 * The calendar shows the next lesson, a day, the week or the term, as its size or the person's preference has it; the
 * three calendar receivers differ only in the size they start at, since not every launcher resizes a widget once it
 * is placed. The list shows what is late and what falls in the coming week, with the exams, ticked off where it is.
 * Both read the same published line, made with the shared glance rules.
 */
open class CampusWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(setOf(DpSize(110.dp, 40.dp), DpSize(250.dp, 40.dp), DpSize(250.dp, 110.dp), DpSize(250.dp, 180.dp), DpSize(250.dp, 250.dp), DpSize(320.dp, 330.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        val state = currentState<Preferences>()
        val line = state[KEY]?.let { Json.parseToJsonElement(it).jsonObject } ?: placeholder("StuDev", "正在更新…")
        if (this@CampusWidget is ListWidget) ListBody(context, line) else Body(context, line)
    }

    companion object {
        private val all = listOf(LineWidget(), DayWidget(), WeekWidget(), ListWidget())
        val receivers = listOf(LineWidgetReceiver::class.java, DayWidgetReceiver::class.java, WeekWidgetReceiver::class.java, ListWidgetReceiver::class.java)

        /** Asks the launcher to place one. False when it cannot be asked. */
        fun pin(context: Context, view: String): Boolean {
            val manager = context.getSystemService(AppWidgetManager::class.java)
            if (!manager.isRequestPinAppWidgetSupported) return false
            val receiver = when (view) { "list" -> ListWidgetReceiver::class.java; "next" -> LineWidgetReceiver::class.java; "week", "term" -> WeekWidgetReceiver::class.java; else -> DayWidgetReceiver::class.java }
            return manager.requestPinAppWidget(ComponentName(context, receiver), null, null)
        }

        suspend fun refreshAll(context: Context, scheduleBoundary: Boolean = true, clock: Clock = Clock.systemUTC()): Instant? = withContext(Dispatchers.IO) {
            val manager = GlanceAppWidgetManager(context)
            val placed = all.flatMap { widget -> manager.getGlanceIds(widget.javaClass).map { widget to it } }
            if (placed.isEmpty()) return@withContext null
            WidgetRefreshWorker.enable(context)
            val settings = CampusSettings(context).state.value
            val now = clock.instant()
            val moment = now.atZone(CampusDay.zone).let { Moment(it.toLocalDate(), it.hour * 60 + it.minute) }
            var unavailable = false
            val line = try {
                if (settings.klass == null) null else AcademicRepository.open(context).line(settings, top.hicancan.studev.me.TaskStore.live(top.hicancan.studev.me.TaskStore(context).all.value))
            } catch (e: CancellationException) { throw e } catch (_: Exception) { unavailable = true; null }
            val json = when {
                settings.klass == null -> placeholder("StuDev", "打开 StuDev 选择班级")
                line == null || unavailable -> placeholder("课表还没下载", "联网打开一次就有了")
                else -> published(line, moment, settings.widgetView, settings.theme, settings.layers)
            }.toString()
            for ((widget, id) in placed) {
                updateAppWidgetState(context, id) { it[KEY] = json }
                widget.update(context, id)
            }
            // Replace the boundary job only after publishing; replacing a currently
            // running boundary worker cancels that worker's coroutine.
            val boundary = (line?.let { Glance.nextChange(it, moment) } ?: Moment(moment.date.plusDays(1), 0)).let { it.date.atStartOfDay(CampusDay.zone).plusMinutes(it.min.toLong()).toInstant() }
            if (scheduleBoundary) WidgetRefreshWorker.at(context, boundary, now)
            boundary
        }
    }
}
class LineWidget : CampusWidget()
class DayWidget : CampusWidget()
class WeekWidget : CampusWidget()
class ListWidget : CampusWidget()

private val TASK = ActionParameters.Key<String>("task")

/** A task ticked off on the home screen is done in the app too, and every widget redraws. */
class ToggleTask : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val id = parameters[TASK] ?: return
        val store = top.hicancan.studev.me.TaskStore(context)
        store.all.value.firstOrNull { it.id == id }?.let(store::toggleDone)
        CampusWidget.refreshAll(context)
    }
}

private fun placeholder(title: String, hint: String) = buildJsonObject { put("title", title); put("hint", hint); put("view", "auto"); put("theme", "system") }

/** One thing for the widget: a lab's place is said short, and only a place on the map can be navigated to. */
private fun row(event: LineEvent, tones: Map<String, Int>, meetings: List<top.hicancan.studev.data.TeachingMeeting>) = buildJsonObject {
    val short = event.lab?.let { lab -> lab.room?.let(Names::roomShort) ?: lab.short } ?: event.room?.let(Names::roomShort).orEmpty()
    put("start", event.start); put("end", event.end); put("name", event.short)
    put("room", event.lab?.short ?: event.room?.let(Names::room).orEmpty()); put("place", short)
    put("tone", TimetablePresentation.toneOf(event, tones, meetings) ?: -1)
    put("kind", event.kind)
    event.room?.takeIf(Names::placed)?.let { put("nav", it) }
}

private fun published(line: CampusLine, now: Moment, view: String, theme: String, order: List<String>) = buildJsonObject {
    val tones = TimetablePresentation.tones(line)
    val due = line.dueOn(now.date).filter { it.done == null }
    val shown = if (due.isEmpty()) Glance.day(line, now).events else line.on(now.date).filter { it.end > now.min && it.task?.done == null }
    put("due", buildJsonArray { due.forEach { add(it.title + (it.due?.time?.let { time -> " ${hm(time)}" } ?: "")) } })
    put("title", shown.firstOrNull()?.date?.let { date -> (when (date) { now.date -> "今天"; now.date.plusDays(1) -> "明天"; else -> "${date.monthValue}月${date.dayOfMonth}日" }) + " " + WEEKDAYS[date.dayOfWeek.value] } ?: if (due.isNotEmpty()) "今天 · ${due.size} 项截止" else "近期没有课")
    put("hint", if (shown.isEmpty() && due.isNotEmpty()) "今天截止 · " + due.joinToString("、") { it.title } else ""); put("view", view); put("theme", theme)
    put("rows", buildJsonArray { shown.take(5).forEach { add(row(it, tones, line.courseMeetings)) } })
    val monday = line.weekShown(now)
    val ahead = CampusLine.daysBetween(now.date.minusDays(now.date.dayOfWeek.value - 1L), monday) / 7
    put("weekTitle", (if (ahead == 1) "下周 · " else if (ahead > 1) "$ahead 周后 · " else "") + (line.weekOf(monday)?.let { "第 $it 周" } ?: "假期"))
    put("term", buildJsonArray { Glance.term(line).forEach { week -> addJsonObject {
        put("week", week.week); put("current", week.days.any { it.date == now.date })
        put("days", buildJsonArray { week.days.forEach { day -> addJsonObject { put("lessons", day.lessons); put("exam", day.exam); put("off", day.off); put("today", day.date == now.date); put("past", day.date < now.date) } } })
    } } })
    // The list: the app's own groups of what is late and the coming week, exams in the group of their day.
    val examsAhead = (0L..Glance.EXAM_DAYS.toLong()).map { now.date.plusDays(it) }.flatMap { date -> line.on(date).filter { it.kind == "exam" && (date > now.date || it.end > now.min) } }
    fun examGroup(event: LineEvent) = when (val days = java.time.temporal.ChronoUnit.DAYS.between(now.date, event.date).toInt()) { 0 -> "today"; 1 -> "tomorrow"; in 2..6 -> "week"; else -> "later" }
    val dueTasks = Glance.due(line, now)
    put("list", buildJsonArray { Tasks.GROUPS.forEach { (key, name) ->
        val tasks = dueTasks.filter { Tasks.group(it, now) == key }
        val exams = examsAhead.filter { examGroup(it) == key }
        if (tasks.isEmpty() && exams.isEmpty()) return@forEach
        addJsonObject {
            put("name", name)
            put("items", buildJsonArray {
                exams.forEach { exam -> addJsonObject { put("kind", "exam"); put("title", exam.name); put("when", (if (exam.date == now.date) "今天 " else if (exam.date == now.date.plusDays(1)) "明天 " else "${WEEKDAYS[exam.date.dayOfWeek.value]} ") + hm(exam.start)); put("late", false) } }
                tasks.forEach { task -> addJsonObject {
                    put("kind", "task"); put("id", task.id); put("title", task.title); put("priority", task.priority ?: 0); put("late", key == "overdue")
                    val at = Tasks.at(task)
                    val minute = if (task.date != null && task.date == at?.first && task.start != null) task.start else at?.second?.takeIf { it < 1440 }
                    put("when", at?.let { (date, _) -> dayWord(java.time.LocalDate.parse(date), now.date) + (minute?.let { " ${hm(it)}" } ?: "") } ?: "")
                } }
            })
        }
    } })
    put("week", buildJsonArray { Glance.week(line, now).forEach { (date, events) ->
        addJsonObject {
            val count = line.dueOn(date).count { it.done == null }
            put("label", WEEKDAYS[date.dayOfWeek.value].drop(1) + if (count > 0) "·截$count" else ""); put("today", date == now.date)
            // A compact tile names the front event and counts the others; none is cancelled.
            put("events", buildJsonArray { CampusLine.clusters(events.filter { it.kind != "run" }, order).forEach { run ->
                add(JsonObject(row(run.front, tones, line.courseMeetings) + mapOf("start" to JsonPrimitive(run.start), "end" to JsonPrimitive(run.end), "more" to JsonPrimitive(run.events.size - 1))))
            } })
        }
    } })
}

private class Paint(val ink: androidx.glance.unit.ColorProvider, val muted: androidx.glance.unit.ColorProvider, val brand: androidx.glance.unit.ColorProvider, val dark: Boolean)

private fun open(context: Context, path: String) = actionStartActivity(Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("$PLATFORM_ORIGIN$path")))

@Composable private fun Body(context: Context, line: JsonObject) {
    val theme = line.getValue("theme").jsonPrimitive.content
    fun color(light: Color, dark: Color): androidx.glance.unit.ColorProvider = when (theme) {
        "light" -> androidx.glance.unit.ColorProvider(light)
        "dark" -> androidx.glance.unit.ColorProvider(dark)
        else -> ColorProvider(light, dark)
    }
    val paint = Paint(color(Tokens.Color.Light.ink, Tokens.Color.Dark.ink), color(Tokens.Color.Light.muted, Tokens.Color.Dark.muted), color(Tokens.Color.Light.brand, Tokens.Color.Dark.brand),
        theme == "dark" || (theme == "system" && (context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES))
    val size = LocalSize.current
    val short = size.height < 100.dp
    // A preference decides what is shown; the size decides how much of it fits.
    val view = when (line.getValue("view").jsonPrimitive.content) {
        "next" -> "next"
        "day" -> if (short) "next" else "day"
        "week" -> if (short) "next" else "week"
        "term" -> if (short) "next" else "term"
        else -> if (short) "next" else if (size.height < 200.dp) "day" else "week"
    }
    val shape = if (Build.VERSION.SDK_INT >= 31) GlanceModifier.cornerRadius(android.R.dimen.system_app_widget_background_radius) else GlanceModifier
    val rows = line["rows"]?.jsonArray?.map { it.jsonObject }.orEmpty()
    val due = line["due"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
    val week = line["week"]?.jsonArray?.map { it.jsonObject }.orEmpty()
    val empty = week.isEmpty()
    Column(GlanceModifier.fillMaxSize().then(shape).background(color(Tokens.Color.Light.paper, Tokens.Color.Dark.paper)).appWidgetBackground()
        .clickable(open(context, if (view == "week") "/?scale=week" else "/?scale=day")).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = if (empty || short) Alignment.CenterVertically else Alignment.Top) {
        when {
            empty || (rows.isEmpty() && view != "week") -> {
                Text(line.getValue("title").jsonPrimitive.content, style = TextStyle(color = paint.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium), maxLines = 1)
                val hint = line.getValue("hint").jsonPrimitive.content
                if (hint.isNotEmpty()) Text(hint, style = TextStyle(color = paint.muted, fontSize = 12.sp), maxLines = 1)
            }
            view == "next" -> {
                Text(line.getValue("title").jsonPrimitive.content, style = TextStyle(color = paint.muted, fontSize = 11.sp), maxLines = 1)
                LessonRow(context, rows.first(), paint, true)
            }
            view == "day" -> {
                Text(line.getValue("title").jsonPrimitive.content, style = TextStyle(color = paint.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1, modifier = GlanceModifier.padding(bottom = 6.dp))
                if (due.isNotEmpty()) Text("今天截止 · " + due.joinToString("、"), style = TextStyle(color = paint.brand, fontSize = 12.sp), maxLines = 1)
                rows.take(((size.height - (if (due.isNotEmpty()) 62.dp else 44.dp)) / 32.dp).toInt().coerceIn(1, 5)).forEach { LessonRow(context, it, paint, false) }
            }
            view == "term" -> TermGrid(context, line["term"]?.jsonArray?.map { it.jsonObject }.orEmpty(), paint, size.height - 20.dp)
            else -> {
                Text(line.getValue("weekTitle").jsonPrimitive.content, style = TextStyle(color = paint.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1, modifier = GlanceModifier.padding(bottom = 6.dp))
                WeekGrid(week, paint, size.height - 54.dp)
            }
        }
    }
}

private fun tone(index: Int, dark: Boolean) = if (dark) darkTone(index) else lightTone(index)
/** An exam looks the same on the home screen as in the app. */
private fun examTone(dark: Boolean) = if (dark) Tone(Tokens.Color.Dark.exam, Tokens.Color.Dark.exam, Tokens.Color.Dark.onExam) else Tone(Tokens.Color.Light.exam, Tokens.Color.Light.exam, Tokens.Color.Light.onExam)

/** A course's colour, then its time, name and room; tapping it starts navigation there. */
@Composable private fun LessonRow(context: Context, row: JsonObject, paint: Paint, headline: Boolean) {
    val index = row.getValue("tone").jsonPrimitive.int
    val bar = if (row["kind"]?.jsonPrimitive?.content == "exam") examTone(paint.dark).bg else if (index < 0) (if (paint.dark) Tokens.Color.Dark.ink else Tokens.Color.Light.ink) else tone(index, paint.dark).border
    val nav = row["nav"]?.jsonPrimitive?.content
    val tap = if (nav != null) GlanceModifier.clickable(open(context, "/map/?nav=${Uri.encode(nav)}")) else GlanceModifier
    val time = hm(row.getValue("start").jsonPrimitive.int)
    val name = row.getValue("name").jsonPrimitive.content
    val room = row.getValue("room").jsonPrimitive.content
    Row(GlanceModifier.fillMaxWidth().padding(vertical = 3.dp).then(tap), verticalAlignment = Alignment.CenterVertically) {
        Box(GlanceModifier.width(3.dp).height(if (headline) 36.dp else 26.dp).cornerRadius(2.dp).background(androidx.glance.unit.ColorProvider(bar))) {}
        Spacer(GlanceModifier.width(10.dp))
        if (headline) Column(GlanceModifier.defaultWeight()) {
            Text(room.ifEmpty { name }, style = TextStyle(color = paint.ink, fontSize = 15.sp, fontWeight = FontWeight.Bold), maxLines = 1)
            Text(if (room.isEmpty()) time else "$time  $name", style = TextStyle(color = paint.muted, fontSize = 12.sp), maxLines = 1)
        } else {
            Text(time, style = TextStyle(color = paint.muted, fontSize = 12.sp), maxLines = 1, modifier = GlanceModifier.width(44.dp))
            Text(name, style = TextStyle(color = paint.ink, fontSize = 13.5.sp), maxLines = 1, modifier = GlanceModifier.defaultWeight())
            Text(room, style = TextStyle(color = paint.ink, fontSize = 12.sp, fontWeight = FontWeight.Medium), maxLines = 1)
        }
    }
}

/** All days share one clock. Empty spans across the whole week fold down so late tasks do not squash lessons. */
@Composable private fun WeekGrid(week: List<JsonObject>, paint: Paint, height: Dp) {
    val events = week.flatMap { it.getValue("events").jsonArray.map { event -> event.jsonObject } }
    val bands = mutableListOf<Pair<Int, Int>>()
    events.sortedBy { it.getValue("start").jsonPrimitive.int }.forEach { event ->
        val start = event.getValue("start").jsonPrimitive.int
        val end = event.getValue("end").jsonPrimitive.int
        val last = bands.lastOrNull()
        if (last != null && start <= last.second) bands[bands.lastIndex] = last.first to maxOf(last.second, end)
        else bands.add(start to end)
    }
    val gap = 6f
    val room = (height.value - 18f - gap * maxOf(0, bands.size - 1)).coerceAtLeast(0f)
    val minimum = minOf(32f, room / maxOf(1, bands.size))
    val extra = (room - minimum * bands.size).coerceAtLeast(0f)
    val minutes = bands.sumOf { it.second - it.first }.coerceAtLeast(1)
    fun position(minute: Int): Float {
        var y = 0f
        for ((start, end) in bands) {
            val tall = minimum + extra * (end - start) / minutes
            if (minute <= end) return y + tall * ((minute - start).toFloat() / (end - start).coerceAtLeast(1)).coerceIn(0f, 1f)
            y += tall + gap
        }
        return y
    }
    Row(GlanceModifier.fillMaxWidth()) {
        week.forEach { day ->
            val today = day.getValue("today").jsonPrimitive.boolean
            Column(GlanceModifier.defaultWeight().padding(horizontal = 1.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(day.getValue("label").jsonPrimitive.content, style = TextStyle(color = if (today) paint.brand else paint.muted, fontSize = 11.sp, fontWeight = if (today) FontWeight.Bold else FontWeight.Normal), maxLines = 1)
                var cursor = 0f
                // A Glance column holds at most ten children, so a full day nests.
                day.getValue("events").jsonArray.map { it.jsonObject }.chunked(4).forEach { part ->
                    Column(GlanceModifier.fillMaxWidth()) {
                        part.forEach { event ->
                            val start = event.getValue("start").jsonPrimitive.int
                            val end = event.getValue("end").jsonPrimitive.int
                            val top = position(start)
                            if (top > cursor) Spacer(GlanceModifier.height((top - cursor).dp))
                            val tileHeight = (position(end) - top - 2).coerceAtLeast(26f)
                            val index = event.getValue("tone").jsonPrimitive.int
                            val mark = if (event["kind"]?.jsonPrimitive?.content == "exam") examTone(paint.dark) else tone(maxOf(index, 0), paint.dark)
                            Box(GlanceModifier.fillMaxWidth().height(tileHeight.dp).cornerRadius(4.dp).background(androidx.glance.unit.ColorProvider(mark.bg)).padding(horizontal = 2.dp, vertical = 2.dp)) {
                                val tall = tileHeight >= 42f
                                val place = event.getValue("place").jsonPrimitive.content
                                Column {
                                    if (tall || place.isEmpty()) Text(event.getValue("name").jsonPrimitive.content, style = TextStyle(color = androidx.glance.unit.ColorProvider(mark.fg), fontSize = 10.sp), maxLines = if (place.isEmpty()) 2 else 1)
                                    if (place.isNotEmpty()) Text(Names.compactPlace(place).replaceFirst("-", "\n"), style = TextStyle(color = androidx.glance.unit.ColorProvider(mark.fg), fontSize = 9.sp, fontWeight = FontWeight.Bold), maxLines = 2)
                                }
                                val more = event["more"]?.jsonPrimitive?.int ?: 0
                                if (more > 0) Box(GlanceModifier.fillMaxSize(), contentAlignment = Alignment.TopEnd) {
                                    Text("+$more", modifier = GlanceModifier.background(androidx.glance.unit.ColorProvider(mark.bg)), style = TextStyle(color = androidx.glance.unit.ColorProvider(mark.fg), fontSize = 9.sp, fontWeight = FontWeight.Bold), maxLines = 1)
                                }
                            }
                            cursor = maxOf(cursor, top) + tileHeight
                        }
                    }
                }
            }
        }
    }
}

/** The term as weeks of days: a dot a day, heavier with more lessons; exams in the exam colour, today ringed. */
@Composable private fun TermGrid(context: Context, weeks: List<JsonObject>, paint: Paint, height: Dp) {
    val current = weeks.indexOfFirst { it["current"]?.jsonPrimitive?.boolean == true }.coerceAtLeast(0)
    // As many weeks as fit, the current one among the first shown.
    val fit = ((height.value - 18f) / 16f).toInt().coerceIn(3, weeks.size.coerceAtLeast(3))
    val first = (current - 1).coerceIn(0, (weeks.size - fit).coerceAtLeast(0))
    Column(GlanceModifier.fillMaxWidth().clickable(open(context, "/?scale=term"))) {
        Text("学期 · 第 ${weeks.getOrNull(current)?.get("week")?.jsonPrimitive?.int ?: "-"} 周", style = TextStyle(color = paint.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1, modifier = GlanceModifier.padding(bottom = 4.dp))
        weeks.drop(first).take(fit).chunked(9).forEach { part ->
            Column(GlanceModifier.fillMaxWidth()) {
                part.forEach { week ->
                    Row(GlanceModifier.fillMaxWidth().height(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(week.getValue("week").jsonPrimitive.int.toString(), style = TextStyle(color = if (week["current"]?.jsonPrimitive?.boolean == true) paint.ink else paint.muted, fontSize = 10.sp), modifier = GlanceModifier.width(22.dp))
                        week.getValue("days").jsonArray.map { it.jsonObject }.forEach { day ->
                            val lessons = day.getValue("lessons").jsonPrimitive.int
                            val exam = day.getValue("exam").jsonPrimitive.boolean
                            val keep = when { exam -> 1f; lessons == 0 || day.getValue("off").jsonPrimitive.boolean -> 0f; lessons <= 2 -> .35f; lessons <= 4 -> .6f; else -> .9f }
                            val brand = if (paint.dark) Tokens.Color.Dark.brand else Tokens.Color.Light.brand
                            val exams = if (paint.dark) Tokens.Color.Dark.exam else Tokens.Color.Light.exam
                            val dot = (if (exam) exams else brand).copy(alpha = if (day.getValue("past").jsonPrimitive.boolean) keep * .45f else keep)
                            Box(GlanceModifier.defaultWeight(), contentAlignment = Alignment.Center) {
                                val ring = day.getValue("today").jsonPrimitive.boolean
                                Box(GlanceModifier.size(12.dp).cornerRadius(6.dp).background(if (ring) paint.ink else androidx.glance.unit.ColorProvider(Color.Transparent)).padding(if (ring) 2.dp else 0.dp)) {
                                    Box(GlanceModifier.fillMaxSize().cornerRadius(6.dp).background(androidx.glance.unit.ColorProvider(dot))) {}
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** The list: groups of what is late and what falls in the coming week, exams among them; a box ticks a task off here. */
@Composable private fun ListBody(context: Context, line: JsonObject) {
    val theme = line.getValue("theme").jsonPrimitive.content
    fun color(light: Color, dark: Color): androidx.glance.unit.ColorProvider = when (theme) {
        "light" -> androidx.glance.unit.ColorProvider(light); "dark" -> androidx.glance.unit.ColorProvider(dark); else -> ColorProvider(light, dark)
    }
    val ink = color(Tokens.Color.Light.ink, Tokens.Color.Dark.ink); val muted = color(Tokens.Color.Light.muted, Tokens.Color.Dark.muted)
    val brand = color(Tokens.Color.Light.brand, Tokens.Color.Dark.brand); val danger = color(Tokens.Color.Light.danger, Tokens.Color.Dark.danger)
    val exam = color(Tokens.Color.Light.exam, Tokens.Color.Dark.exam); val onExam = color(Tokens.Color.Light.onExam, Tokens.Color.Dark.onExam)
    val ring = listOf(color(Tokens.Color.Light.faint, Tokens.Color.Dark.faint), androidx.glance.unit.ColorProvider(Color(0xFF4F8CFF)), androidx.glance.unit.ColorProvider(Color(0xFFE8A33A)), danger)
    val shape = if (Build.VERSION.SDK_INT >= 31) GlanceModifier.cornerRadius(android.R.dimen.system_app_widget_background_radius) else GlanceModifier
    val groups = line["list"]?.jsonArray?.map { it.jsonObject }.orEmpty()
    val size = LocalSize.current
    var room = ((size.height.value - 44f) / 30f).toInt().coerceAtLeast(1)
    Column(GlanceModifier.fillMaxSize().then(shape).background(color(Tokens.Color.Light.paper, Tokens.Color.Dark.paper)).appWidgetBackground().padding(horizontal = 14.dp, vertical = 10.dp)) {
        Row(GlanceModifier.fillMaxWidth().padding(bottom = 4.dp).clickable(open(context, "/?scale=list")), verticalAlignment = Alignment.CenterVertically) {
            Text("清单", style = TextStyle(color = ink, fontSize = 15.sp, fontWeight = FontWeight.Bold), modifier = GlanceModifier.defaultWeight())
            Text("＋", style = TextStyle(color = muted, fontSize = 18.sp))
        }
        if (groups.isEmpty()) { Text(line["hint"]?.jsonPrimitive?.content?.takeIf { line["list"] == null } ?: "这一周没有要做的事", style = TextStyle(color = muted, fontSize = 13.sp)); return@Column }
        groups.forEach { group ->
            // A group's name goes only with at least one of its items under it.
            if (room < 2) return@forEach
            Text(group.getValue("name").jsonPrimitive.content, style = TextStyle(color = muted, fontSize = 11.5.sp, fontWeight = FontWeight.Medium), modifier = GlanceModifier.padding(top = 4.dp))
            room--
            group.getValue("items").jsonArray.map { it.jsonObject }.take(room.coerceAtLeast(0)).chunked(8).forEach { part ->
                Column(GlanceModifier.fillMaxWidth()) {
                    part.forEach { item ->
                        room--
                        val isExam = item.getValue("kind").jsonPrimitive.content == "exam"
                        Row(GlanceModifier.fillMaxWidth().height(30.dp).clickable(open(context, "/?scale=list")), verticalAlignment = Alignment.CenterVertically) {
                            if (isExam) Box(GlanceModifier.cornerRadius(4.dp).background(exam).padding(horizontal = 3.dp)) { Text("考", style = TextStyle(color = onExam, fontSize = 10.sp, fontWeight = FontWeight.Bold)) }
                            else {
                                val id = item.getValue("id").jsonPrimitive.content
                                Box(GlanceModifier.size(26.dp).clickable(actionRunCallback<ToggleTask>(actionParametersOf(TASK to id))), contentAlignment = Alignment.Center) {
                                    Box(GlanceModifier.size(16.dp).cornerRadius(4.dp).background(ring[item.getValue("priority").jsonPrimitive.int.coerceIn(0, 3)]).padding(1.5.dp)) {
                                        Box(GlanceModifier.fillMaxSize().cornerRadius(3.dp).background(color(Tokens.Color.Light.paper, Tokens.Color.Dark.paper))) {}
                                    }
                                }
                            }
                            Spacer(GlanceModifier.width(6.dp))
                            Text(item.getValue("title").jsonPrimitive.content, style = TextStyle(color = ink, fontSize = 13.5.sp), maxLines = 1, modifier = GlanceModifier.defaultWeight())
                            Text(item.getValue("when").jsonPrimitive.content, style = TextStyle(color = if (item.getValue("late").jsonPrimitive.boolean) danger else if (isExam) exam else brand, fontSize = 12.sp), maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

open class CampusWidgetReceiver(override val glanceAppWidget: GlanceAppWidget) : GlanceAppWidgetReceiver() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        WidgetRefreshWorker.refresh(context)
    }
    override fun onEnabled(context: Context) { super.onEnabled(context); WidgetRefreshWorker.enable(context) }
    override fun onDisabled(context: Context) { super.onDisabled(context); WidgetRefreshWorker.disable(context) }
}
class LineWidgetReceiver : CampusWidgetReceiver(LineWidget())
class DayWidgetReceiver : CampusWidgetReceiver(DayWidget())
class WeekWidgetReceiver : CampusWidgetReceiver(WeekWidget())
class ListWidgetReceiver : CampusWidgetReceiver(ListWidget())
