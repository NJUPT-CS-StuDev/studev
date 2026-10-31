package top.hicancan.studev.campus

import android.Manifest
import android.content.pm.PackageManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.*
import androidx.lifecycle.compose.*
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.*
import top.hicancan.studev.data.*
import top.hicancan.studev.location.*
import top.hicancan.studev.me.*
import top.hicancan.studev.navigation.*
import top.hicancan.studev.rooms.RoomsScreen
import top.hicancan.studev.search.AcademicSearchScreen
import top.hicancan.studev.timetable.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun CampusApp(deepLink: String?, onDeepLinkHandled: () -> Unit, onActivities: () -> Unit, onAccount: () -> Unit, model: CampusModel = viewModel()) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by model.state.collectAsStateWithLifecycle()
    val preferences by model.settings.state.collectAsStateWithLifecycle()
    val notice by model.notice.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var screen by rememberSaveable { mutableStateOf("home") }
    var query by rememberSaveable { mutableStateOf("") }
    var week by rememberSaveable { mutableStateOf<Int?>(null) }
    var roomDate by rememberSaveable { mutableStateOf<String?>(null) }
    var roomPeriod by rememberSaveable { mutableStateOf<Int?>(null) }
    var classPicker by rememberSaveable { mutableStateOf(false) }
    var lesson by remember { mutableStateOf<TeachingMeeting?>(null) }
    val destinations = rememberSaveableStateHolder()
    var pendingMap by rememberSaveable { mutableStateOf<String?>(null) }
    var depart by remember { mutableStateOf(false) }
    val runtime = remember(context) { NavigationRuntime.get(context) }
    val route by runtime.state.collectAsStateWithLifecycle()
    LaunchedEffect(route.active) { if (route.active) screen = "map" }
    val (access, requestLocation) = rememberLocationPermission { }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val location = remember(context) { CampusLocation.get(context) }
    val fix by location.fix.collectAsStateWithLifecycle()
    DisposableEffect(access.granted, lifecycle) {
        val owner = Any()
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START && access.granted) location.acquire(owner)
            if (event == Lifecycle.Event.ON_STOP) location.release(owner)
            if (event == Lifecycle.Event.ON_RESUME) {
                runCatching { AppUpdates.installDownloaded(context) }.getOrNull()?.let(model::tell)
            }
        }
        lifecycle.addObserver(observer)
        if (access.granted && lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) location.acquire(owner)
        onDispose { lifecycle.removeObserver(observer); location.release(owner) }
    }
    var now by remember { mutableStateOf(CampusDay.now()) }
    LaunchedEffect(Unit) { while (true) { now = CampusDay.now(); delay(30_000) } }
    LaunchedEffect(notice) { notice?.let { snackbar.showSnackbar(it); model.clearNotice() } }
    fun openScreen(target: String, text: String = "") { query = text; screen = target }
    fun go(room: String, start: Boolean) { scope.launch {
        val campus = CampusPackage.load(context.assets)
        val place = campus.byId[room]
        if (place == null) { model.tell("这个教室尚未关联校园地图"); return@launch }
        lesson = null; pendingMap = room; openScreen("map"); runtime.open(place); depart = start
        if (!access.granted) requestLocation()
    } }
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && route.route != null && !route.busy) runtime.start() else model.tell("可在路线页开始导航")
    }
    LaunchedEffect(depart, route.busy, route.route, route.error) {
        if (depart && !route.busy) {
            if (route.route != null) {
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                else runtime.start()
            }
            depart = false
        }
    }
    LaunchedEffect(deepLink, state.busy) {
        if (deepLink == null || state.busy) return@LaunchedEffect
        val uri = Uri.parse(deepLink)
        if (uri.scheme != "https" || uri.host != "studev.hicancan.top") { onDeepLinkHandled(); return@LaunchedEffect }
        uri.getQueryParameter("class")?.let { id -> if (state.classes.any { it.id.equals(id, true) } || id in state.examClasses) model.chooseClass(id.uppercase(java.util.Locale.ROOT)) }
        query = uri.getQueryParameter("q") ?: uri.getQueryParameter("building").orEmpty()
        when (uri.path?.trimEnd('/')) {
            "/map" -> {
                pendingMap = uri.getQueryParameter("place"); openScreen("map")
                if (uri.getQueryParameter("route") == "true") pendingMap?.let { go(it, false) }
            }
            "/search/timetable" -> { week = uri.getQueryParameter("week")?.toIntOrNull(); openScreen("timetable", query) }
            "/search/exam" -> openScreen("exams")
            "/search/classrooms" -> {
                roomDate = uri.getQueryParameter("date"); roomPeriod = uri.getQueryParameter("period")?.toIntOrNull()
                uri.getQueryParameter("campus")?.let { campus -> if (state.rooms?.campuses?.any { it.id == campus } == true) model.settings.update { it.copy(campus = campus) } }
                openScreen("rooms", query)
            }
            "/search/web", "/search/materials", "/search/community" -> openScreen("search", query)
            else -> openScreen("home")
        }
        onDeepLinkHandled()
    }
    val next = state.events.firstOrNull { !it.exam && it.start > now.toInstant() }
    var walk by remember(next?.id) { mutableStateOf<Int?>(null) }
    LaunchedEffect(next?.id, fix?.timestamp?.div(60_000)) {
        val position = fix?.takeIf { SystemClock.elapsedRealtime() - it.timestamp in 0..30_000 } ?: return@LaunchedEffect
        val room = next?.room ?: return@LaunchedEffect
        walk = withContext(Dispatchers.IO) { runCatching {
            val campus = CampusPackage.load(context.assets)
            val place = campus.byId[room] ?: return@runCatching null
            Wayfind.load(context.assets).use { engine -> engine.route(RouteRequest(Endpoint.Position(position.position), place.routing, alternatives = 1)).firstOrNull()?.let { minutes(it.duration_s) } }
        }.getOrNull() }
    }
    val tab = when (screen) { "timetable", "exams" -> "timetable"; "map" -> "map"; "me", "calendar" -> "me"; else -> "home" }
    BackHandler(screen != "home") { screen = when (screen) { "calendar" -> "me"; "exams" -> "timetable"; else -> "home" } }
    Scaffold(contentWindowInsets = WindowInsets(0, 0, 0, 0), snackbarHost = { SnackbarHost(snackbar) }, topBar = {
        if (screen != "map") TopAppBar(title = { Text(when (screen) { "home" -> "studev"; "timetable", "exams" -> "课表"; "rooms" -> "空教室"; "search" -> "校园搜索"; "calendar" -> "日历同步"; else -> "我的" }) },
            navigationIcon = { if (screen in listOf("rooms", "search", "calendar")) IconButton({ screen = if (screen == "calendar") "me" else "home" }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
            actions = { if (screen == "home") TextButton({ classPicker = true }) { Text(preferences.klass ?: "选择班级") } else if (screen == "timetable" || screen == "exams") TextButton({ screen = if (screen == "exams") "timetable" else "exams" }) { Text(if (screen == "exams") "课程" else "考试") } })
    }, bottomBar = {
        if (!route.active) NavigationBar {
            listOf("home" to "首页", "timetable" to "课表", "map" to "地图", "me" to "我的").forEach { (key, label) ->
                NavigationBarItem(tab == key, { openScreen(key) }, icon = { Icon(when (key) { "home" -> Icons.Outlined.Home; "timetable" -> Icons.Outlined.CalendarMonth; "map" -> Icons.Outlined.Map; else -> Icons.Outlined.PersonOutline }, null) }, label = { Text(label) }, modifier = Modifier.testTag("tab-$key"))
            }
        }
    }) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
            // Save the map's camera/controller and internal routes when another tab is visible.
            // Detaching its native SurfaceView also stops off-screen rendering and location work.
            if (screen == "map") destinations.SaveableStateProvider("map") {
                StudevApp(pendingMap, onDeepLinkHandled = { pendingMap = null })
            }
            if (screen != "map") Surface(Modifier.fillMaxSize()) {
                if (state.busy) Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) { CircularProgressIndicator() }
                else if (state.term == null || state.rooms == null) Column(Modifier.padding(20.dp)) { EmptyCard("校园数据暂时无法打开", state.error.orEmpty(), "重试", model::load) }
                else Column(Modifier.fillMaxSize()) {
                    if (state.classBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (state.error != null) TextButton(model::load) { Text("${state.error} · 重试") }
                    Box(Modifier.weight(1f)) { destinations.SaveableStateProvider(screen) { when (screen) {
                        "home" -> CampusHome(state, preferences.klass, now, walk, access.granted, requestLocation, { classPicker = true }, { openScreen(it) }, { lesson = it }, ::go)
                        "timetable" -> TimetableScreen(state, preferences.klass, week, { classPicker = true }, { lesson = it })
                        "exams" -> ExamsScreen(state, preferences.klass, { classPicker = true }, ::go)
                        "rooms" -> RoomsScreen(state.repository!!, state.rooms!!, preferences.campus, query, roomDate, roomPeriod, { value -> model.settings.update { it.copy(campus = value) } }, ::go)
                        "search" -> AcademicSearchScreen(model.search(state.repository!!), query, model::places, { id -> pendingMap = id; openScreen("map") }) { target, text -> openScreen(target, text) }
                        "me", "calendar" -> MeScreen(model, state, preferences, screen == "calendar", { classPicker = true }, { screen = "calendar" }, onActivities, onAccount)
                    } } }
                }
            }
        }
    }
    if (classPicker && !state.busy) ClassPicker(state, { model.chooseClass(it); classPicker = false }, { classPicker = false })
    lesson?.let { LessonDetail(it, state.periods, { lesson = null }, ::go) }
}
