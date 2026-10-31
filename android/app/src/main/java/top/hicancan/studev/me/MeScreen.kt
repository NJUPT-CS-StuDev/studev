package top.hicancan.studev.me

import android.Manifest
import android.app.Activity
import android.app.UiModeManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch
import top.hicancan.studev.BuildConfig
import top.hicancan.studev.account.PLATFORM_ORIGIN
import top.hicancan.studev.calendar.TimetableCalendar
import top.hicancan.studev.campus.*
import top.hicancan.studev.reminders.LessonReminders
import top.hicancan.studev.widget.NextLessonWidgetReceiver
import top.hicancan.studev.widget.CompactLessonWidgetReceiver
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.data.Place
import androidx.compose.foundation.lazy.items

@Composable fun MeScreen(model: CampusModel, state: AcademicState, preferences: PersonalSettings, calendarPage: Boolean, onClass: () -> Unit, onCalendar: () -> Unit, onAccount: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var removal by remember { mutableStateOf(false) }
    var dormPicker by remember { mutableStateOf(false) }
    var dormQuery by remember { mutableStateOf("") }
    var dorms by remember { mutableStateOf<List<Place>>(emptyList()) }
    var backgroundSettings by remember { mutableStateOf(false) }
    var backgroundStatus by remember { mutableStateOf<BackgroundRunStatus?>(null) }
    LaunchedEffect(Unit) {
        dorms = CampusPackage.load(context.assets).places.filter { it.kind == "building" && it.category == "宿舍" }
    }
    LaunchedEffect(preferences.navigationGuidancePending) {
        if (preferences.navigationGuidancePending && !preferences.navigationGuidanceShown) {
            backgroundStatus = BackgroundRunSettings.status(context)
            backgroundSettings = true
            model.settings.update { it.copy(navigationGuidancePending = false, navigationGuidanceShown = true) }
        }
    }
    val calendarPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (TimetableCalendar.permitted(context)) model.calendar(!removal) else model.tell("需要日历权限才能同步或移除 studev 日历")
    }
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            val first = !preferences.reminderGuidanceShown
            model.settings.update { it.copy(reminders = true, reminderGuidanceShown = true) }
            model.syncPhone()
            if (first) { backgroundStatus = BackgroundRunSettings.status(context); backgroundSettings = true }
        }
        else model.tell("通知未开启，课程提醒暂时无法送达")
    }
    fun enableReminders() {
        val first = !preferences.reminderGuidanceShown
        model.settings.update { it.copy(reminders = true, reminderGuidanceShown = true) }
        model.syncPhone()
        if (first) { backgroundStatus = BackgroundRunSettings.status(context); backgroundSettings = true }
    }
    fun toggleCalendar(enabled: Boolean) {
        removal = !enabled
        if (TimetableCalendar.permitted(context)) model.calendar(enabled)
        else calendarPermission.launch(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR))
    }
    LazyColumn(Modifier.fillMaxSize().testTag(if (calendarPage) "calendar-settings" else "me"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Text(if (calendarPage) "课表放进系统日历" else "我的校园", style = MaterialTheme.typography.headlineSmall)
            Supporting(if (calendarPage) "课程与考试，都在你常用的日历里。" else "让校园生活更顺手", Modifier.padding(top = 6.dp))
        }
        if (!calendarPage) {
            item { OutlinedCard(onAccount, Modifier.fillMaxWidth().testTag("open-account")) {
                ListItem(headlineContent = { Text("账号与安全") }, supportingContent = { Text("登录、设备与账号设置") }, leadingContent = { Icon(Icons.Outlined.PersonOutline, null) }, trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null) })
            } }
            item { OutlinedCard(onClass, Modifier.fillMaxWidth()) {
                ListItem(headlineContent = { Text(preferences.klass ?: "选择你的班级") }, supportingContent = { Text(state.classes.find { it.id == preferences.klass }?.major ?: "课表、考试与提醒将跟随这个班级") }, leadingContent = { Icon(Icons.Outlined.Groups, null) }, trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null) })
            } }
            item { OutlinedCard({ dormQuery = ""; dormPicker = true }, Modifier.fillMaxWidth().testTag("home-dorm")) {
                ListItem(headlineContent = { Text(preferences.homeDorm ?: "选择你的宿舍") },
                    supportingContent = { Text("小组件从这里计算步行和出门时间 · 预留 3 分钟") },
                    leadingContent = { Icon(Icons.Outlined.Home, null) }, trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null) })
            } }
            item {
                SectionLabel("常用校区")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { state.rooms?.campuses?.forEach { campus -> FilterChip(campus.id == preferences.campus, { model.settings.update { it.copy(campus = campus.id) } }, { Text(campus.id) }) } }
            }
            item {
                SectionLabel("外观")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色").forEach { (key, label) ->
                        FilterChip(preferences.theme == key, {
                            model.settings.update { it.copy(theme = key) }
                            if (Build.VERSION.SDK_INT >= 31) context.getSystemService(UiModeManager::class.java).setApplicationNightMode(when (key) { "light" -> UiModeManager.MODE_NIGHT_NO; "dark" -> UiModeManager.MODE_NIGHT_YES; else -> UiModeManager.MODE_NIGHT_AUTO })
                            else (context as? Activity)?.recreate()
                        }, { Text(label) })
                    }
                }
            }
            item { OutlinedCard(onCalendar, Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text("系统日历同步") }, supportingContent = { Text(if (preferences.calendar) "已开启 · 课表与考试" else "同步课程与考试到本机日历") }, leadingContent = { Icon(Icons.Outlined.EventAvailable, null) }, trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null) }) } }
            item { OutlinedCard({ backgroundStatus = BackgroundRunSettings.status(context); backgroundSettings = true }, Modifier.fillMaxWidth().testTag("background-settings")) {
                val manufacturer = Build.MANUFACTURER.ifBlank { "Android" }
                ListItem(headlineContent = { Text("后台运行设置") }, supportingContent = { Text("导航、提醒和小组件在 $manufacturer 上更稳定") }, leadingContent = { Icon(Icons.Outlined.BatteryChargingFull, null) }, trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null) })
            } }
        } else {
            item { Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Outlined.EventAvailable, null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.primary)
                    Text("studev 课表与考试", style = MaterialTheme.typography.titleMedium)
                    Text("创建独立的本地日历。重复同步会更新已有安排；切换班级会移除原班级的安排。关闭后，移除整个 studev 日历。", style = MaterialTheme.typography.bodyMedium)
                    Supporting("${preferences.klass ?: "尚未选择班级"} · ${state.events.size} 项安排 · 南京时间")
                }
            } }
            item { SettingsSwitch("同步到系统日历", "仅写入 studev 创建的日历", preferences.calendar, preferences.klass != null, ::toggleCalendar) }
            if (preferences.calendar) item { FilledTonalButton(model::syncPhone, Modifier.fillMaxWidth()) { Text("立即重新同步") } }
        }
        if (!calendarPage) {
            item {
                SectionLabel("上课与考试提醒")
                SettingsSwitch("本地提醒", if (LessonReminders.exact(context)) "可使用准时提醒" else "当前使用系统后台任务，可能延迟", preferences.reminders, preferences.klass != null) { enabled ->
                    if (enabled && Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                    else if (enabled) enableReminders()
                    else { model.settings.update { it.copy(reminders = false) }; model.syncPhone() }
                }
                if (preferences.reminders) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(5, 10, 15, 30).forEach { minutes -> FilterChip(preferences.leadMinutes == minutes, { model.settings.update { it.copy(leadMinutes = minutes) }; model.syncPhone() }, { Text("提前 $minutes 分钟") }) } }
                    if (Build.VERSION.SDK_INT >= 31 && !LessonReminders.exact(context)) TextButton({ context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))) }) { Text("允许准时提醒") }
                    Supporting("无需网络。系统省电策略可能影响送达，通知可直接打开教室导航。")
                }
            }
            item {
                SectionLabel("桌面小组件")
                EmptyCard("抬眼就是下一节课", "从宿舍走到教室要多久，几点出门，桌面上一眼可见。", "添加到桌面") {
                    val manager = context.getSystemService(AppWidgetManager::class.java)
                    if (manager.isRequestPinAppWidgetSupported)
                        manager.requestPinAppWidget(ComponentName(context, NextLessonWidgetReceiver::class.java), null, null)
                    else model.tell("请在桌面长按空白处，选择小组件并找到 studev")
                }
                TextButton({
                    val manager = context.getSystemService(AppWidgetManager::class.java)
                    if (manager.isRequestPinAppWidgetSupported)
                        manager.requestPinAppWidget(ComponentName(context, CompactLessonWidgetReceiver::class.java), null, null)
                    else model.tell("请在桌面的小组件列表中选择「下一节课 · 紧凑」")
                }) { Text("添加紧凑版（4×1）") }
            }
            item {
                SectionLabel("数据与版本")
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("校园数据 · 离线可用", style = MaterialTheme.typography.titleSmall)
                        Supporting(state.repository?.release?.version.orEmpty())
                        Supporting("校园地图与地点搜索已内置。课表、考试和其他数据按需下载，下载后可离线使用。新版本尚未发布时，请稍后联网重试。")
                        TextButton(model::refresh) { Text("检查数据更新") }
                        HorizontalDivider()
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("studev ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium)
                            TextButton({ context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/download/"))) }) { Text("下载新版本") }
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
    if (dormPicker) AlertDialog(onDismissRequest = { dormPicker = false }, title = { Text("从哪栋宿舍出发") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(dormQuery, { dormQuery = it }, Modifier.fillMaxWidth().testTag("dorm-query"), singleLine = true,
                placeholder = { Text("搜索宿舍，如荷苑48栋") }, leadingIcon = { Icon(Icons.Outlined.Search, null) })
            LazyColumn(Modifier.heightIn(max = 320.dp)) {
                items(dorms.filter { place -> (listOf(place.id) + place.names).any { it.contains(dormQuery, true) } }, key = { it.id }) { dorm ->
                    TextButton({ model.settings.update { it.copy(homeDorm = dorm.id) }; dormPicker = false }, Modifier.fillMaxWidth().testTag("dorm-${dorm.id}")) {
                        Text(dorm.id, Modifier.weight(1f))
                        if (dorm.id == preferences.homeDorm) Icon(Icons.Outlined.Check, "已选择")
                    }
                }
            }
        }
    }, confirmButton = { TextButton({ dormPicker = false }) { Text("完成") } },
        dismissButton = { if (preferences.homeDorm != null) TextButton({ model.settings.update { it.copy(homeDorm = null) }; dormPicker = false }) { Text("清除选择") } })
    if (backgroundSettings) {
        val status = backgroundStatus ?: BackgroundRunSettings.status(context).also { backgroundStatus = it }
        AlertDialog(
            onDismissRequest = { backgroundSettings = false },
            title = { Text("后台运行设置") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("导航需要持续定位，提醒和小组件需要系统在后台唤醒 studev。请按设备提示设置一次，之后不会反复打扰。")
                    Text("电池优化：${if (status.batteryExempt) "已豁免" else "可能限制后台运行"}")
                    Text("通知：${if (status.notificationsEnabled) "已开启" else "已关闭"}")
                    Text("准时提醒：${if (status.exactAlarms) "可用" else "需允许准时提醒"}")
                    TextButton({ BackgroundRunSettings.requestBatteryExemption(context); backgroundStatus = BackgroundRunSettings.status(context) }) { Text("允许后台运行") }
                    TextButton({ BackgroundRunSettings.openOemStartup(context) }) { Text("打开${status.manufacturer}应用启动管理") }
                    TextButton({ BackgroundRunSettings.openNotifications(context) }) { Text("检查通知权限和通知分类") }
                    if (Build.VERSION.SDK_INT >= 31 && !status.exactAlarms) TextButton({ context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))) }) { Text("允许准时提醒") }
                }
            },
            confirmButton = { TextButton({ backgroundSettings = false }) { Text("完成") } },
        )
    }
}
@Composable private fun SettingsSwitch(title: String, detail: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) { Text(title, style = MaterialTheme.typography.titleSmall); Supporting(detail) }
        Switch(checked, onChange, enabled = enabled)
    }
}
