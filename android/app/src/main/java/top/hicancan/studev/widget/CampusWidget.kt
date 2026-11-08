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
 * The one widget. What it shows follows its size, or the person's preference: the next lesson,
 * today, or the week. The three receivers differ only in the size they start at, since not every
 * launcher resizes a widget once it is placed.
 */
open class CampusWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(setOf(DpSize(110.dp, 40.dp), DpSize(250.dp, 40.dp), DpSize(250.dp, 110.dp), DpSize(250.dp, 180.dp), DpSize(250.dp, 250.dp), DpSize(320.dp, 330.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) = provideContent {
        val state = currentState<Preferences>()
        val line = state[KEY]?.let { Json.parseToJsonElement(it).jsonObject } ?: placeholder("studev", "打开 studev 选择班级")
        Body(context, line)
    }

    companion object {
        private val all = listOf(LineWidget(), DayWidget(), WeekWidget())
        val receivers = listOf(LineWidgetReceiver::class.java, DayWidgetReceiver::class.java, WeekWidgetReceiver::class.java)

        /** Asks the launcher to place one. False when it cannot be asked. */
        fun pin(context: Context, view: String): Boolean {
            val manager = context.getSystemService(AppWidgetManager::class.java)
            if (!manager.isRequestPinAppWidgetSupported) return false
            val receiver = when (view) { "next" -> LineWidgetReceiver::class.java; "week" -> WeekWidgetReceiver::class.java; else -> DayWidgetReceiver::class.java }
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
                if (settings.klass == null) null else AcademicRepository.open(context).line(settings)
            } catch (e: CancellationException) { throw e } catch (_: Exception) { unavailable = true; null }
            val json = when {
                settings.klass == null -> placeholder("studev", "打开 studev 选择班级")
                line == null || unavailable -> placeholder("课表还没下载", "联网打开一次就有了")
                else -> published(line, moment, settings.widgetView, settings.theme)
            }.toString()
            for ((widget, id) in placed) {
                updateAppWidgetState(context, id) { it[KEY] = json }
                widget.update(context, id)
            }
            // Replace the boundary job only after publishing; replacing a currently
            // running boundary worker cancels that worker's coroutine.
            val boundary = line?.let { WidgetDay.nextChange(it, moment) } ?: moment.date.plusDays(1).atStartOfDay(CampusDay.zone).toInstant()
            if (scheduleBoundary) WidgetRefreshWorker.at(context, boundary, now)
            boundary
        }
    }
}
class LineWidget : CampusWidget()
class DayWidget : CampusWidget()
class WeekWidget : CampusWidget()

private fun placeholder(title: String, hint: String) = buildJsonObject { put("title", title); put("hint", hint); put("view", "auto"); put("theme", "system") }

private fun row(event: LineEvent) = buildJsonObject {
    put("start", event.start); put("end", event.end); put("name", event.short)
    put("room", event.room?.let(Names::room).orEmpty()); put("place", event.room?.let(Names::roomShort).orEmpty())
    put("tone", event.meeting?.let(TimetablePresentation::colourIndex) ?: -1)
    put("exam", event.kind == "exam")
    event.room?.let { put("nav", it) }
}

private fun published(line: CampusLine, now: Moment, view: String, theme: String) = buildJsonObject {
    val shown = WidgetDay.of(line, now)
    put("title", shown.firstOrNull()?.date?.let { date -> (when (date) { now.date -> "今天"; now.date.plusDays(1) -> "明天"; else -> "${date.monthValue}月${date.dayOfMonth}日" }) + " " + WEEKDAYS[date.dayOfWeek.value] } ?: "近期没有课")
    put("hint", ""); put("view", view); put("theme", theme)
    put("rows", buildJsonArray { shown.take(5).forEach { add(row(it)) } })
    val monday = line.weekShown(now)
    val ahead = CampusLine.daysBetween(now.date.minusDays(now.date.dayOfWeek.value - 1L), monday) / 7
    put("weekTitle", (if (ahead == 1) "下周 · " else if (ahead > 1) "$ahead 周后 · " else "") + (line.weekOf(monday)?.let { "第 $it 周" } ?: "假期"))
    put("week", buildJsonArray { WidgetDay.week(line, now).forEach { (date, events) ->
        addJsonObject {
            put("label", WEEKDAYS[date.dayOfWeek.value].drop(1)); put("today", date == now.date)
            // An exam outranks a lesson at the same time: the widget shows the exam alone.
            val exams = events.filter { it.kind == "exam" }
            put("events", buildJsonArray { events.filter { it.kind == "exam" || (it.kind == "class" && exams.none { exam -> exam.start < it.end && it.start < exam.end }) }.forEach { add(row(it)) } })
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
        else -> if (short) "next" else if (size.height < 200.dp) "day" else "week"
    }
    val shape = if (Build.VERSION.SDK_INT >= 31) GlanceModifier.cornerRadius(android.R.dimen.system_app_widget_background_radius) else GlanceModifier
    val rows = line["rows"]?.jsonArray?.map { it.jsonObject }.orEmpty()
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
                rows.take(((size.height - 44.dp) / 32.dp).toInt().coerceIn(1, 5)).forEach { LessonRow(context, it, paint, false) }
            }
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
    val bar = if (row["exam"]?.jsonPrimitive?.boolean == true) examTone(paint.dark).bg else if (index < 0) (if (paint.dark) Tokens.Color.Dark.ink else Tokens.Color.Light.ink) else tone(index, paint.dark).border
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

/** The week as the timetable draws it: a column for each day, tiles placed by the clock. */
@Composable private fun WeekGrid(week: List<JsonObject>, paint: Paint, height: Dp) {
    val events = week.flatMap { it.getValue("events").jsonArray.map { event -> event.jsonObject } }
    val first = events.minOfOrNull { it.getValue("start").jsonPrimitive.int } ?: (8 * 60)
    val last = events.maxOfOrNull { it.getValue("end").jsonPrimitive.int } ?: (18 * 60)
    val perMinute = height.value / maxOf(60, last - first)
    Row(GlanceModifier.fillMaxWidth()) {
        week.forEach { day ->
            val today = day.getValue("today").jsonPrimitive.boolean
            Column(GlanceModifier.defaultWeight().padding(horizontal = 1.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(day.getValue("label").jsonPrimitive.content, style = TextStyle(color = if (today) paint.brand else paint.muted, fontSize = 11.sp, fontWeight = if (today) FontWeight.Bold else FontWeight.Normal), maxLines = 1)
                var cursor = first
                var placedAny = false
                // A Glance column holds at most ten children, so a full day nests.
                day.getValue("events").jsonArray.map { it.jsonObject }.chunked(4).forEach { part ->
                    Column(GlanceModifier.fillMaxWidth()) {
                        part.forEach { event ->
                            val start = event.getValue("start").jsonPrimitive.int
                            val end = event.getValue("end").jsonPrimitive.int
                            // A tile stops 2 dp short of its end, and the next gap gives that back, so the clock stays true.
                            if (start > cursor || placedAny) Spacer(GlanceModifier.height(((start - cursor) * perMinute + if (placedAny) 2f else 0f).dp))
                            val index = event.getValue("tone").jsonPrimitive.int
                            val mark = if (event["exam"]?.jsonPrimitive?.boolean == true) examTone(paint.dark) else tone(maxOf(index, 0), paint.dark)
                            Box(GlanceModifier.fillMaxWidth().height(((end - start) * perMinute - 2).coerceAtLeast(14f).dp).cornerRadius(4.dp).background(androidx.glance.unit.ColorProvider(mark.bg)).padding(horizontal = 2.dp, vertical = 2.dp)) {
                                val tall = ((end - start) * perMinute - 2) >= 30f
                                val place = event.getValue("place").jsonPrimitive.content
                                Column {
                                    if (tall || place.isEmpty()) Text(event.getValue("name").jsonPrimitive.content, style = TextStyle(color = androidx.glance.unit.ColorProvider(mark.fg), fontSize = 10.sp), maxLines = if (place.isEmpty()) 3 else 2)
                                    if (place.isNotEmpty()) Text(place, style = TextStyle(color = androidx.glance.unit.ColorProvider(mark.fg), fontSize = 10.sp, fontWeight = FontWeight.Bold), maxLines = 1)
                                }
                            }
                            cursor = maxOf(cursor, end)
                            placedAny = true
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
