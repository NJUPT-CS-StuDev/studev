package top.hicancan.studev.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.datastore.preferences.core.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.*
import androidx.glance.action.clickable
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.*
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.layout.*
import top.hicancan.studev.account.PLATFORM_ORIGIN
import androidx.glance.text.*
import androidx.glance.color.ColorProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.hicancan.studev.MainActivity
import top.hicancan.studev.data.*
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.timetable.*
import top.hicancan.studev.ui.theme.Tokens
import top.hicancan.studev.ui.theme.darkTone
import top.hicancan.studev.ui.theme.lightTone

import top.hicancan.studev.world.*

import kotlinx.serialization.json.*
import java.time.format.DateTimeFormatter
import java.time.Clock
import java.time.Instant

open class NextLessonWidget(private val clock: Clock = Clock.systemUTC()) : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(setOf(DpSize(250.dp, 80.dp), DpSize(250.dp, 160.dp)))

    suspend fun refreshAll(context: Context, scheduleBoundary: Boolean = true): Instant? = withContext(Dispatchers.IO) {
        val ids = GlanceAppWidgetManager(context).getGlanceIds(this@NextLessonWidget.javaClass)
        if (ids.isEmpty()) return@withContext null
        WidgetRefreshWorker.enable(context)
        val settings = CampusSettings(context).state.value
        val now = clock.instant()
        val moment = now.atZone(CampusDay.zone).let { Moment(it.toLocalDate(), it.hour * 60 + it.minute) }
        var unavailable = false
        val line = try {
            if (settings.klass == null) null else {
                val repo = AcademicRepository.open(context)
                val term = repo.term()
                val schedule = try { repo.effectiveSchedule(settings.klass, settings.timetableEdits(term.term)) }
                    catch (e: CancellationException) { throw e } catch (_: Exception) { unavailable = true; null }
                val exams = try { repo.effectiveExams(settings.klass, settings) }
                    catch (e: CancellationException) { throw e } catch (_: Exception) { unavailable = true; emptyList() }
                CampusLine(term, repo.periods(), schedule?.meetings.orEmpty(), exams, CampusLine.holidays(repo.calendar()), null)
            }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { unavailable = true; null }
        val shown = line?.let { WidgetDay.of(it, moment) }.orEmpty()
        val title = when {
            settings.klass == null -> "studev"
            unavailable -> "课表还没下载"
            shown.isEmpty() -> "这两天没有课"
            else -> (if (shown.first().date == moment.date) "今天" else "明天") + " " + WEEKDAYS[shown.first().date.dayOfWeek.value]
        }
        val hint = when {
            settings.klass == null -> "打开 studev 选择班级"
            unavailable -> "联网打开一次就有了"
            else -> ""
        }
        val rows = buildJsonArray {
            shown.take(4).forEach { event ->
                addJsonObject {
                    put("time", hm(event.start))
                    put("name", event.short)
                    put("room", event.room?.let(Names::room).orEmpty())
                    put("tone", event.meeting?.let(TimetablePresentation::colourIndex) ?: -1)
                    event.room?.let { put("nav", it) }
                }
            }
        }.toString()
        for (id in ids) {
            updateAppWidgetState(context, id) { state ->
                state[stringPreferencesKey("title")] = title
                state[stringPreferencesKey("hint")] = hint
                state[stringPreferencesKey("rows")] = rows
                state[stringPreferencesKey("theme")] = settings.theme
            }
            update(context, id)
        }
        // Replace the boundary job only after publishing; replacing a currently
        // running boundary worker cancels that worker's coroutine.
        val boundary = line?.let { WidgetDay.nextChange(it, moment) } ?: moment.date.plusDays(1).atStartOfDay(CampusDay.zone).toInstant()
        if (scheduleBoundary) WidgetRefreshWorker.at(context, boundary, now)
        boundary
    }

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val state = currentState<Preferences>()
            val title = state[stringPreferencesKey("title")] ?: "studev"
            val hint = state[stringPreferencesKey("hint")] ?: "打开 studev 选择班级"
            val rows = runCatching { Json.parseToJsonElement(state[stringPreferencesKey("rows")] ?: "[]").jsonArray.map { it.jsonObject } }.getOrDefault(emptyList())
            val theme = state[stringPreferencesKey("theme")] ?: "system"
            val open = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("$PLATFORM_ORIGIN/"))
            fun color(light: Color, dark: Color): androidx.glance.unit.ColorProvider = when (theme) {
                "light" -> androidx.glance.unit.ColorProvider(light)
                "dark" -> androidx.glance.unit.ColorProvider(dark)
                else -> ColorProvider(light, dark)
            }
            val ink = color(Tokens.Color.Light.ink, Tokens.Color.Dark.ink)
            val muted = color(Tokens.Color.Light.muted, Tokens.Color.Dark.muted)
            val paper = color(Tokens.Color.Light.paper, Tokens.Color.Dark.paper)
            val compact = LocalSize.current.height < 120.dp
            val shape = if (Build.VERSION.SDK_INT >= 31) GlanceModifier.cornerRadius(android.R.dimen.system_app_widget_background_radius) else GlanceModifier
            Column(GlanceModifier.fillMaxSize().then(shape).background(paper).appWidgetBackground().clickable(actionStartActivity(open)).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = if (compact || rows.isEmpty()) Alignment.CenterVertically else Alignment.Top) {
                if (rows.isEmpty()) {
                    Text(title, style = TextStyle(color = ink, fontSize = 15.sp, fontWeight = FontWeight.Medium), maxLines = 1)
                    if (hint.isNotEmpty()) Text(hint, style = TextStyle(color = muted, fontSize = 12.sp), maxLines = 1)
                } else if (compact) {
                    WidgetRow(context, rows.first(), ink, muted, theme, headline = true)
                } else {
                    Row(GlanceModifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(title, style = TextStyle(color = ink, fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1, modifier = GlanceModifier.defaultWeight())
                        if (hint.isNotEmpty()) Text(hint, style = TextStyle(color = muted, fontSize = 12.sp), maxLines = 1)
                    }
                    rows.forEach { row -> WidgetRow(context, row, ink, muted, theme, headline = false) }
                }
            }
        }
    }
}

/** A course's tile colour, then its time, name and room; tapping it starts navigation there. */
@Composable private fun WidgetRow(context: Context, row: JsonObject, ink: androidx.glance.unit.ColorProvider, muted: androidx.glance.unit.ColorProvider, theme: String, headline: Boolean) {
    val toneIndex = row.getValue("tone").jsonPrimitive.int
    val dark = theme == "dark" || (theme == "system" && (context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES)
    val bar = if (toneIndex < 0) (if (dark) Tokens.Color.Dark.ink else Tokens.Color.Light.ink) else (if (dark) darkTone(toneIndex) else lightTone(toneIndex)).border
    val nav = row["nav"]?.jsonPrimitive?.content
    val tap = if (nav != null) GlanceModifier.clickable(actionStartActivity(Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("$PLATFORM_ORIGIN/map/?nav=${Uri.encode(nav)}")))) else GlanceModifier
    Row(GlanceModifier.fillMaxWidth().padding(vertical = 3.dp).then(tap), verticalAlignment = Alignment.CenterVertically) {
        Box(GlanceModifier.width(3.dp).height(if (headline) 36.dp else 26.dp).cornerRadius(2.dp).background(androidx.glance.unit.ColorProvider(bar))) {}
        Spacer(GlanceModifier.width(10.dp))
        if (headline) Column(GlanceModifier.defaultWeight()) {
            Text(row.getValue("name").jsonPrimitive.content, style = TextStyle(color = ink, fontSize = 15.sp, fontWeight = FontWeight.Medium), maxLines = 1)
            Text("${row.getValue("time").jsonPrimitive.content}  ${row.getValue("room").jsonPrimitive.content}", style = TextStyle(color = muted, fontSize = 12.sp), maxLines = 1)
        } else {
            Text(row.getValue("time").jsonPrimitive.content, style = TextStyle(color = muted, fontSize = 12.sp), maxLines = 1, modifier = GlanceModifier.width(44.dp))
            Text(row.getValue("name").jsonPrimitive.content, style = TextStyle(color = ink, fontSize = 13.5.sp), maxLines = 1, modifier = GlanceModifier.defaultWeight())
            Text(row.getValue("room").jsonPrimitive.content, style = TextStyle(color = muted, fontSize = 12.sp), maxLines = 1)
        }
    }
}

/** A fixed 4×1 entry also works on launchers that lock an existing widget's cell span. */
class CompactLessonWidget(clock: Clock = Clock.systemUTC()) : NextLessonWidget(clock) {
    override val sizeMode = SizeMode.Single
}

open class NextLessonWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget = NextLessonWidget()
    override fun onUpdate(context: Context, appWidgetManager: android.appwidget.AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        WidgetRefreshWorker.refresh(context)
    }
    override fun onEnabled(context: Context) { super.onEnabled(context); WidgetRefreshWorker.enable(context) }
    override fun onDisabled(context: Context) { super.onDisabled(context); WidgetRefreshWorker.disable(context) }
}

class CompactLessonWidgetReceiver : NextLessonWidgetReceiver() {
    override val glanceAppWidget = CompactLessonWidget()
}
