package top.hicancan.studev.navigation

import android.content.Intent
import android.provider.Settings
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import top.hicancan.studev.location.LocationStatus
import top.hicancan.studev.location.rememberLocationPermission
import top.hicancan.studev.map.*
import top.hicancan.studev.search.SearchScreen
import top.hicancan.studev.ui.theme.Tokens

@Composable
fun StudevApp(deepLink: String?, onDeepLinkHandled: () -> Unit, model: AppModel = viewModel()) {
    val campus by model.campus.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val id by model.selectedId.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val runtime = remember(context) { NavigationRuntime.get(context) }
    val route by runtime.state.collectAsStateWithLifecycle()
    val controller = rememberSaveable(saver = listSaver(
        save = { listOf(it.threeD.toString(), it.follow.name) },
        restore = { CampusMapController(it[0].toBoolean(), FollowMode.valueOf(it[1])) },
    )) { CampusMapController() }
    var status by remember { mutableStateOf(LocationStatus.Waiting) }
    var mapError by remember { mutableStateOf(false) }
    val (access, requestLocation) = rememberLocationPermission { controller.cycleFollow() }
    val nav = rememberNavController()
    LaunchedEffect(deepLink, campus) {
        if (campus != null && deepLink != null) {
            if (campus!!.byId.containsKey(deepLink)) model.select(deepLink)
            nav.popBackStack("map", false)
            onDeepLinkHandled()
        }
    }
    val loaded = campus
    if (loaded == null) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(Tokens.Space.xl.dp),
                verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                if (error == null) { CircularProgressIndicator(); Spacer(Modifier.height(Tokens.Space.l.dp)); Text("正在打开校园地图") }
                else { Text("校园数据加载失败", style = MaterialTheme.typography.titleLarge); TextButton(onClick = model::load) { Text("重试") } }
            }
        }
        return
    }
    val selected = loaded.byId[id]
    var pickingOrigin by rememberSaveable { mutableStateOf(true) }
    Box(Modifier.fillMaxSize()) {
        CampusMap(controller, loaded, if (route.open) null else selected, isSystemInDarkTheme(), access.granted,
            onPlace = { model.select(it.id) }, onLocationStatus = { status = it }, onMapError = { mapError = it },
            routeState = route, onRoute = runtime::choose, modifier = Modifier.fillMaxSize())
        NavHost(nav, startDestination = "map", enterTransition = { fadeIn(tween(Tokens.Motion.quick)) },
            exitTransition = { fadeOut(tween(Tokens.Motion.quick)) }) {
            composable("map") {
                if (route.open) {
                    NavigationScreen(route, runtime, controller, access.granted, requestLocation,
                        pick = { origin -> pickingOrigin = origin; nav.navigate("route-search") })
                } else {
                    MapControls(controller, status, access.granted, mapError, selected != null,
                        onSearch = { nav.navigate("search") { launchSingleTop = true } }, onLocate = {
                            if (access.granted && status == LocationStatus.Disabled) context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                            else requestLocation()
                        })
                    if (selected != null) PlaceSheet(selected, loaded, model.preferences,
                        onClose = { model.select(null) }, onPlace = { model.select(it.id) }, onRoute = { runtime.open(selected) })
                }
            }
            composable("search") {
                SearchScreen(loaded, model.search, model.preferences, onBack = { nav.popBackStack() },
                    onPlace = { model.select(it.id); nav.popBackStack() })
            }
            composable("route-search") {
                SearchScreen(loaded, model.search, model.preferences, onBack = { nav.popBackStack() },
                    onPlace = { if (pickingOrigin) runtime.origin(it) else runtime.destination(it); nav.popBackStack() },
                    onMyPosition = if (pickingOrigin) ({ runtime.origin(null); nav.popBackStack() }) else null)
            }
        }
    }
}
