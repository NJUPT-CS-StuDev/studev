package top.hicancan.studev.app

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

/** Three entries over one shell, the same as the website. */
@Composable fun CampusApp(deepLink: String?, onDeepLinkHandled: () -> Unit, onAccount: () -> Unit, onForm: (top.hicancan.studev.account.FormRequest) -> Unit, model: CampusModel = viewModel()) {
    val context = LocalContext.current
    val state by model.state.collectAsStateWithLifecycle()
    val settings by model.settings.state.collectAsStateWithLifecycle()
    val notice by model.notice.collectAsStateWithLifecycle()
    val route = remember { Route() }
    val snackbar = remember { SnackbarHostState() }
    var campus by remember { mutableStateOf<CampusPackage?>(null) }
    LaunchedEffect(Unit) { campus = runCatching { CampusPackage.load(context) }.getOrNull() }
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
    val walk: suspend (String) -> Int? = walk@{ target ->
        val fix = location.fix.value ?: return@walk null
        val place = campus?.byId?.get(target) ?: return@walk null
        runCatching { runtime.walkMinutes(Endpoint.Position(fix.position), place.endpoint) }.getOrNull()
    }
    BackHandler(enabled = route.tab != "timetable" || route.whoType != "me" || route.preview != null) {
        when {
            route.tab != "timetable" -> route.tab = "timetable"
            route.preview != null -> route.preview = null
            else -> { route.whoType = "me"; route.whoId = "" }
        }
    }
    Scaffold(containerColor = Ink.paper, snackbarHost = { SnackbarHost(snackbar) }, bottomBar = {
        if (!navigation.active) Row(Modifier.fillMaxWidth().background(Ink.paper).topHairline(Ink.line).navigationBarsPadding().height(50.dp)) {
            listOf("timetable" to "课表", "map" to "地图", "search" to "搜索", "ai" to "AI").forEach { (key, label) ->
                val on = route.tab == key
                Box(Modifier.weight(1f).fillMaxHeight().clickable { route.tab = key }.testTag("tab-$key"), contentAlignment = Alignment.Center) {
                    Plain(label, 14.sp, if (on) Ink.text else Ink.muted, if (on) FontWeight.SemiBold else FontWeight.Medium)
                }
            }
        }
    }) { padding ->
        Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            // The native map keeps its surface while another entry is on top of it.
            if (mapOpened) campus?.let { loaded -> MapScreen(route, state, settings, loaded, now, runtime, onPick = { route.tab = "map" }, onHinted = { model.settings.update { it.copy(ballHinted = true) } }, onForm = onForm) }
            when (route.tab) {
                "timetable" -> Surface(Modifier.fillMaxSize(), color = Ink.paper) { TimetableScreen(route, model, state, settings, now, walk) { event, line -> open = event to line } }
                "search" -> Surface(Modifier.fillMaxSize(), color = Ink.paper) { SearchScreen(route, state, campus, model) }
                "ai" -> Surface(Modifier.fillMaxSize(), color = Ink.paper) { top.hicancan.studev.ai.AiScreen(model) }
            }
            if (route.tab != "map" && route.tab != "ai") Surface({ me = true }, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 12.dp, end = 14.dp).size(32.dp).testTag("me"), shape = CircleShape, color = Ink.sunken) {
                MeAvatar()
            }
        }
    }
    open?.let { (event, line) -> EventSheet(event, line, route.whoType == "me", route, model, settings, state, now, onOpen = { open = it to line }) { open = null } }
    if (me) MeSheet(state, settings, model, now, route, onPickClass = { picking = true }, onAccount = onAccount, onForm = onForm) { me = false }
    if (picking) ClassPickSheet(state, { model.chooseClass(it) }) { picking = false }
    if (state.appRequired) AppRequired(state.app!!)
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
