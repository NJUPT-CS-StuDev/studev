package top.hicancan.studev.app

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
@Composable fun CampusApp(deepLink: String?, onDeepLinkHandled: () -> Unit, onAccount: () -> Unit, model: CampusModel = viewModel()) {
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
            listOf("timetable" to "课表", "map" to "地图", "search" to "搜索").forEach { (key, label) ->
                val on = route.tab == key
                Box(Modifier.weight(1f).fillMaxHeight().clickable { route.tab = key }.testTag("tab-$key"), contentAlignment = Alignment.Center) {
                    Plain(label, 14.sp, if (on) Ink.text else Ink.muted, if (on) FontWeight.SemiBold else FontWeight.Medium)
                }
            }
        }
    }) { padding ->
        Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            // The native map keeps its surface while another entry is on top of it.
            if (mapOpened) campus?.let { loaded -> MapScreen(route, state, settings, loaded, now, runtime, onPick = { route.tab = "map" }) }
            when (route.tab) {
                "timetable" -> Surface(Modifier.fillMaxSize(), color = Ink.paper) { TimetableScreen(route, model, state, settings, now, walk) { event, line -> open = event to line } }
                "search" -> Surface(Modifier.fillMaxSize(), color = Ink.paper) { SearchScreen(route, state, campus, model) }
            }
            if (route.tab != "map") Surface({ me = true }, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 12.dp, end = 14.dp).size(32.dp).testTag("me"), shape = CircleShape, color = Ink.sunken) {
                MeAvatar()
            }
        }
    }
    open?.let { (event, line) -> EventSheet(event, line, route.whoType == "me", route, model, settings, state, now, onOpen = { open = it to line }) { open = null } }
    if (me) MeSheet(state, settings, model, now, route, onPickClass = { picking = true }, onAccount = onAccount) { me = false }
    if (picking) ClassPickSheet(state, { model.chooseClass(it) }) { picking = false }
}
