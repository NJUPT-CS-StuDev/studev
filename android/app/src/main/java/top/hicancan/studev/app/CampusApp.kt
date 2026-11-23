package top.hicancan.studev.app

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import top.hicancan.studev.account.PLATFORM_ORIGIN
import top.hicancan.studev.app.*
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.location.CampusLocation
import top.hicancan.studev.map.MapScreen
import top.hicancan.studev.navigation.*
import top.hicancan.studev.search.SearchScreen
import top.hicancan.studev.world.CampusDay
import top.hicancan.studev.timetable.TimetableScreen
import top.hicancan.studev.world.CampusLine
import top.hicancan.studev.world.LineEvent
import top.hicancan.studev.world.Moment

@Composable internal fun CampusGlyph(entry: String, size: androidx.compose.ui.unit.Dp, tint: Color) {
    val glyph = remember(entry) {
        val path = when (entry) {
            "timetable" -> Tokens.Glyph.timetable
            "map" -> Tokens.Glyph.map
            "knowledge" -> Tokens.Glyph.knowledge
            "search" -> Tokens.Glyph.search
            "ai" -> Tokens.Glyph.ai
            "share" -> Tokens.Glyph.share
            else -> error("Unknown campus entry: $entry")
        }
        ImageVector.Builder(entry, 24.dp, 24.dp, 24f, 24f)
            .addPath(PathParser().parsePathString(path).toNodes(), stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.8f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
            .build()
    }
    Icon(glyph, null, Modifier.size(size), tint = tint)
}

/** The five campus entries share one shell. */
@Composable fun CampusApp(deepLink: String?, onDeepLinkHandled: () -> Unit, onAccount: () -> Unit, model: CampusModel = viewModel()) {
    val context = LocalContext.current
    LifecycleResumeEffect(model) {
        model.resume()
        onPauseOrDispose { model.pause() }
    }
    val state by model.state.collectAsStateWithLifecycle()
    val settings by model.settings.state.collectAsStateWithLifecycle()
    val notice by model.notice.collectAsStateWithLifecycle()
    val route = remember { Route() }
    val snackbar = remember { SnackbarHostState() }
    var campus by remember { mutableStateOf<CampusPackage?>(null) }
    LaunchedEffect(state.repository?.release?.version) {
        state.repository?.let { repository ->
            runCatching { CampusPackage.load(context, repository) }.getOrNull()?.let { campus = it }
        }
    }
    var now by remember { mutableStateOf(Moment.of(CampusDay.now())) }
    LaunchedEffect(Unit) { while (true) { now = Moment.of(CampusDay.now()); delay(30_000) } }
    LaunchedEffect(notice) { notice?.let { snackbar.showSnackbar(it); model.clearNotice() } }
    LaunchedEffect(deepLink) {
        if (deepLink != null) { route.open(deepLink, PLATFORM_ORIGIN); onDeepLinkHandled() }
    }
    val runtime = remember(context) { NavigationRuntime.get(context) }
    val navigation by runtime.state.collectAsStateWithLifecycle()
    LaunchedEffect(navigation.active) { if (navigation.active) route.tab = "map" }
    var mapOpened by remember { mutableStateOf(false) }
    if (route.tab == "map") mapOpened = true
    var open by remember { mutableStateOf<Pair<LineEvent, CampusLine>?>(null) }
    var me by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    val location = remember(context) { CampusLocation.get(context) }
    val walk: suspend (String) -> top.hicancan.studev.navigation.WalkEstimate? = walk@{ target ->
        val fix = location.fix.value ?: return@walk null
        val places = campus?.byId ?: return@walk null
        val place = places[target] ?: return@walk null
        runCatching { runtime.walk(Endpoint.Position(fix.position), place) }.getOrNull()
    }
    BackHandler(enabled = route.tab != "timetable" || route.whoType != "me" || route.preview != null) {
        when {
            route.tab != "timetable" -> route.tab = "timetable"
            route.preview != null -> route.preview = null
            else -> route.myTimetable()
        }
    }
    CompositionLocalProvider(LocalMeAction provides { me = true }) {
    val views = rememberSaveableStateHolder()
    Scaffold(containerColor = Ink.paper, snackbarHost = { SnackbarHost(snackbar) }, bottomBar = {
        if (!navigation.active) Row(Modifier.fillMaxWidth().background(Ink.paper).topHairline(Ink.line).navigationBarsPadding().height(50.dp).selectableGroup()) {
            listOf("timetable" to "课表", "map" to "地图", "knowledge" to "知识", "search" to "搜索", "ai" to "AI").forEach { (key, label) ->
                val on = route.tab == key
                val color = if (on) Ink.brand else Ink.muted
                Column(Modifier.weight(1f).fillMaxHeight().selectable(on, role = Role.Tab) { route.tab = key }.testTag("tab-$key"),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically)) {
                    CampusGlyph(key, 20.dp, color)
                    Plain(label, 12.sp, color, if (on) FontWeight.SemiBold else FontWeight.Medium)
                }
            }
        }
    }) { padding ->
        // The bar below counts as room already given: a keyboard rising over it lifts the page only by what it covers beyond.
        Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding()).consumeWindowInsets(PaddingValues(bottom = padding.calculateBottomPadding()))) {
            // The native map keeps its surface while another entry is on top of it.
            if (mapOpened) campus?.let { loaded -> key(loaded.repository.release.map_base) { MapScreen(route, state, settings, loaded, now, runtime, onPick = { route.tab = "map" }, onHinted = { model.settings.update { it.copy(ballHinted = true) } }) } }
            when (route.tab) {
                "timetable" -> views.SaveableStateProvider("timetable") {
                    Surface(Modifier.fillMaxSize(), color = Ink.paper) { TimetableScreen(route, model, state, settings, now, walk) { event, line -> open = event to line } }
                }
                "knowledge" -> views.SaveableStateProvider("knowledge") {
                    Surface(Modifier.fillMaxSize(), color = Ink.paper) { top.hicancan.studev.knowledge.KnowledgeScreen(route, state, settings) }
                }
                "search" -> Surface(Modifier.fillMaxSize(), color = Ink.paper) { SearchScreen(route, state, model) }
                "ai" -> Surface(Modifier.fillMaxSize(), color = Ink.paper) { top.hicancan.studev.ai.AiScreen(model, route) }
            }
        }
    }
    }
    open?.let { (event, line) -> EventSheet(event, line, route.whoType == "me", route, model, settings, state, now, onOpen = { open = it to line }) { open = null } }
    if (me) MeSheet(state, settings, model, now, route, onPickClass = { picking = true }, onAccount = onAccount) { me = false }
    if (picking) ClassPickSheet(state, { model.chooseClass(it) }) { picking = false }
    if (state.appRequired) AppRequired(state.app!!)
    else model.update.collectAsStateWithLifecycle().value?.let { news -> UpdateDialog(news, model::closeUpdate) }
}

/** A check for updates answers here, above every sheet and tab, so the answer is seen where it was asked. */
@Composable private fun UpdateDialog(news: UpdateNews, onClose: () -> Unit) {
    val context = LocalContext.current
    val found = news as? UpdateNews.Found
    androidx.compose.material3.AlertDialog(onDismissRequest = onClose, containerColor = Ink.paper,
        title = { androidx.compose.material3.Text(found?.title ?: "正在检查更新") },
        text = {
            if (found == null) Row(verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.material3.CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Ink.brand)
                Plain("正在检查更新…", 14.sp, Ink.muted, modifier = Modifier.padding(start = 12.dp))
            } else Plain(found.detail, 14.sp, Ink.muted, lineHeight = 21.sp)
        },
        confirmButton = {
            val app = found?.app
            if (app != null) TextAction("去下载", {
                onClose(); context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/download/")))
            }) else if (found != null) TextAction("好", onClose)
        },
        dismissButton = { if (found?.app != null) TextAction("稍后", onClose, muted = true) else if (found == null) TextAction("取消", onClose, muted = true) })
}

/** The website now publishes data this app cannot read: only the newer app can go on. */
@Composable private fun AppRequired(app: top.hicancan.studev.data.AppRelease) {
    val context = LocalContext.current
    Surface(Modifier.fillMaxSize(), color = Ink.paper) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center) {
            Plain("请更新到 ${app.versionName}", 24.sp, weight = FontWeight.SemiBold)
            Plain("校园数据已经更新，这个版本（${top.hicancan.studev.BuildConfig.VERSION_NAME}）读不了新的数据。下载安装新版本后，你的班级和设置都会保留。", 15.sp, Ink.muted, modifier = Modifier.padding(top = 10.dp, bottom = 24.dp))
            ActionButton("下载 ${app.versionName}", go = true, modifier = Modifier.fillMaxWidth()) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$PLATFORM_ORIGIN/download/"))) }
        }
    }
}
