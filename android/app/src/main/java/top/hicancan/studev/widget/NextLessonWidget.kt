package top.hicancan.studev.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.*
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.*
import androidx.glance.layout.*
import androidx.glance.text.*
import androidx.glance.color.ColorProvider
import androidx.glance.material3.ColorProviders
import top.hicancan.studev.ui.theme.LightColors
import top.hicancan.studev.ui.theme.DarkColors
import top.hicancan.studev.MainActivity
import top.hicancan.studev.data.AcademicRepository
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.timetable.*
import top.hicancan.studev.ui.theme.Tokens
import java.time.Instant
import java.time.format.DateTimeFormatter

class NextLessonWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val selectedClass = CampusSettings(context).state.value.klass
        val next = runCatching {
            val repo = AcademicRepository.open(context)
            val klass = CampusSettings(context).state.value.klass ?: return@runCatching null
            CampusEvents.build(repo.term(), repo.periods(), repo.schedule(klass), emptyList()).firstOrNull { it.start > Instant.now() }
        }.getOrNull()
        val saved = context.getSharedPreferences("next-lesson-walk", Context.MODE_PRIVATE)
        val walk = saved.getInt("minutes", 0).takeIf { next?.id == saved.getString("id", null) && System.currentTimeMillis() - saved.getLong("at", 0) < 30 * 60_000 }
        val open = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://studev.hicancan.top/search/timetable/"))
        val go = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://studev.hicancan.top/map/?place=${Uri.encode(next?.room.orEmpty())}&route=true"))
        val ink = ColorProvider(Tokens.Color.Light.ink, Tokens.Color.Dark.ink)
        val muted = ColorProvider(Tokens.Color.Light.muted, Tokens.Color.Dark.muted)
        provideContent {
            GlanceTheme(colors = ColorProviders(light = LightColors, dark = DarkColors)) {
            Column(GlanceModifier.fillMaxSize().background(ColorProvider(Tokens.Color.Light.paper, Tokens.Color.Dark.paper))
                .appWidgetBackground().padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("studev · 下一节课", style = TextStyle(color = ColorProvider(Tokens.Color.Light.brand, Tokens.Color.Dark.brand), fontSize = 14.sp, fontWeight = FontWeight.Medium))
                Spacer(GlanceModifier.height(12.dp))
                Text(next?.title ?: if (selectedClass == null) "先选好你的班级" else "接下来没有课程", maxLines = 2,
                    style = TextStyle(color = ink, fontSize = 20.sp, fontWeight = FontWeight.Bold))
                Spacer(GlanceModifier.height(8.dp))
                Text(next?.let { "${it.start.atZone(CampusDay.zone).format(DateTimeFormatter.ofPattern("M月d日 HH:mm"))} · ${it.room ?: it.location ?: "地点待定"}" } ?: "打开 studev 查看课表", style = TextStyle(color = muted, fontSize = 13.sp))
                Spacer(GlanceModifier.height(8.dp))
                Text(walk?.let { "上次位置步行约 $it 分钟" } ?: "打开应用查看步行时间", style = TextStyle(color = muted, fontSize = 12.sp))
                Spacer(GlanceModifier.height(20.dp))
                Row {
                    Button("查看课表", actionStartActivity(open), modifier = GlanceModifier.defaultWeight())
                    if (next?.room != null) { Spacer(GlanceModifier.width(8.dp)); Button("去这里", actionStartActivity(go)) }
                }
            }
            }
        }
    }
}
class NextLessonWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget = NextLessonWidget() }
