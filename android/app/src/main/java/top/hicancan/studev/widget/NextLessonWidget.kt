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
import top.hicancan.studev.navigation.*
import top.hicancan.studev.timetable.*
import top.hicancan.studev.ui.theme.Tokens
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
        var unavailable = false
        val events = try {
            if (settings.klass == null) emptyList() else {
                val repo = AcademicRepository.open(context)
                val schedule = try { repo.schedule(settings.klass) }
                    catch (e: CancellationException) { throw e } catch (_: Exception) { unavailable = true; null }
                val exams = try { repo.exams(settings.klass) }
                    catch (e: CancellationException) { throw e } catch (_: Exception) { unavailable = true; emptyList() }
                CampusEvents.build(repo.term(), repo.periods(), schedule, exams)
            }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { unavailable = true; emptyList() }
        val next = WidgetLesson.next(events, now)
        val walk = if (settings.homeDorm != null && next?.room != null) withContext(Dispatchers.IO) {
            runCatching {
                val campus = CampusPackage.load(context.assets)
                val home = campus.byId[settings.homeDorm] ?: return@runCatching null
                val destination = campus.byId[next.room] ?: return@runCatching null
                Wayfind.load(context.assets).use { engine ->
                    engine.route(RouteRequest(home.routing, destination.routing, alternatives = 1)).firstOrNull()?.let { minutes(it.duration_s) }
                }
            }.getOrNull()
        } else null
        val headline = next?.let { WidgetLesson.headline(it, now, walk) } ?: when {
            settings.klass == null -> "下一节课，抬眼可见"
            unavailable -> "课表还未下载"
            else -> "今天和明天没有课"
        }
        val detail = next?.let(WidgetLesson::detail) ?: when {
            settings.klass == null -> "在「我的」选择班级，让课表来到桌面"
            unavailable -> "请联网打开课表；新版本可能尚未发布"
            else -> "好好休息，按自己的节奏来"
        }
        val journey = when {
            settings.homeDorm == null -> "在「我的」选择宿舍，即可显示出门时间"
            next == null -> "出发地 · ${settings.homeDorm}"
            walk != null -> "从${settings.homeDorm}步行 $walk 分钟"
            next.room == null -> "上课地点待公布"
            else -> "步行路线暂不可用，打开地图查看"
        }
        for (id in ids) {
            updateAppWidgetState(context, id) { state ->
                state[stringPreferencesKey("headline")] = headline
                state[stringPreferencesKey("detail")] = detail
                state[stringPreferencesKey("journey")] = journey
                state[stringPreferencesKey("room")] = next?.room.orEmpty()
                state[stringPreferencesKey("theme")] = settings.theme
            }
            update(context, id)
        }
        // Replace the boundary job only after publishing; replacing a currently
        // running boundary worker cancels that worker's coroutine.
        val boundary = WidgetLesson.refreshAt(events, now)
        if (scheduleBoundary) WidgetRefreshWorker.at(context, boundary, now)
        boundary
    }

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val state = currentState<Preferences>()
            val headline = state[stringPreferencesKey("headline")] ?: "下一节课，抬眼可见"
            val detail = state[stringPreferencesKey("detail")] ?: "在「我的」选择班级，让课表来到桌面"
            val journey = state[stringPreferencesKey("journey")] ?: "在「我的」选择宿舍，即可显示出门时间"
            val room = state[stringPreferencesKey("room")].orEmpty()
            val theme = state[stringPreferencesKey("theme")] ?: "system"
            val open = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("$PLATFORM_ORIGIN/search/timetable/"))
            val go = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("$PLATFORM_ORIGIN/map/?place=${Uri.encode(room)}&route=true"))
            fun color(light: Color, dark: Color): androidx.glance.unit.ColorProvider = when (theme) {
                "light" -> androidx.glance.unit.ColorProvider(light)
                "dark" -> androidx.glance.unit.ColorProvider(dark)
                else -> ColorProvider(light, dark)
            }
            val ink = color(Tokens.Color.Light.ink, Tokens.Color.Dark.ink)
            val muted = color(Tokens.Color.Light.muted, Tokens.Color.Dark.muted)
            val paper = color(Tokens.Color.Light.surfaceRaised, Tokens.Color.Dark.surfaceRaised)
            val button = color(Tokens.Color.Light.brandContainer, Tokens.Color.Dark.brandContainer)
            val onButton = color(Tokens.Color.Light.onBrandContainer, Tokens.Color.Dark.onBrandContainer)
            val compact = LocalSize.current.height < 160.dp
            val shape = if (Build.VERSION.SDK_INT >= 31) GlanceModifier.cornerRadius(android.R.dimen.system_app_widget_background_radius) else GlanceModifier
            val bounds = if (compact) GlanceModifier.fillMaxWidth().height(80.dp) else GlanceModifier.fillMaxSize()
            Column(bounds.then(shape).background(paper).appWidgetBackground()
                .clickable(actionStartActivity(open)).padding(horizontal = 18.dp, vertical = if (compact) 6.dp else 12.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (compact) headline.removePrefix("明天 ") else headline, style = TextStyle(color = ink, fontSize = if (compact) { if (room.isEmpty()) 18.sp else 20.sp } else 26.sp, fontWeight = FontWeight.Bold),
                        maxLines = 1, modifier = GlanceModifier.defaultWeight())
                    if (compact) {
                        Spacer(GlanceModifier.width(8.dp))
                        WidgetAction(if (room.isNotEmpty()) "导航" else "课表", if (room.isNotEmpty()) go else open, button, onButton)
                        if (room.isNotEmpty()) {
                            Spacer(GlanceModifier.width(4.dp))
                            WidgetAction("课表", open, button, onButton)
                        }
                    }
                }
                Spacer(GlanceModifier.height(if (compact) 2.dp else 6.dp))
                Text(if (compact && headline.startsWith("明天 ")) "明天 · $detail" else detail, style = TextStyle(color = ink, fontSize = if (compact) 12.sp else 13.sp), maxLines = if (compact) 1 else 2)
                Spacer(GlanceModifier.height(if (compact) 2.dp else 4.dp))
                Text(journey, style = TextStyle(color = muted, fontSize = 12.sp), maxLines = 1)
                if (!compact) {
                    Spacer(GlanceModifier.height(8.dp))
                    Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        if (room.isNotEmpty()) {
                            Box(GlanceModifier.defaultWeight()) { WidgetAction("导航", go, button, onButton, true) }
                            Spacer(GlanceModifier.width(8.dp))
                        }
                        Box(GlanceModifier.defaultWeight()) { WidgetAction("课表", open, button, onButton, true) }
                    }
                }
            }
        }
    }
}

@Composable private fun WidgetAction(label: String, intent: Intent, background: androidx.glance.unit.ColorProvider,
                                    foreground: androidx.glance.unit.ColorProvider, wide: Boolean = false) {
    Box((if (wide) GlanceModifier.fillMaxWidth() else GlanceModifier).height(if (wide) 36.dp else 32.dp)
        .cornerRadius(Tokens.Radius.control.dp).background(background).clickable(actionStartActivity(intent)).padding(horizontal = if (wide) 18.dp else 8.dp),
        contentAlignment = Alignment.Center) {
        Text(label, style = TextStyle(color = foreground, fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1)
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
