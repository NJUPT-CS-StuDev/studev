package top.hicancan.studev.navigation

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import top.hicancan.studev.BuildConfig
import top.hicancan.studev.data.Place
import top.hicancan.studev.location.CampusLocation

data class PlannerState(
    val open: Boolean = false, val origin: Place? = null, val destination: Place? = null,
    val destinationIsMyPosition: Boolean = false,
    val mode: String = "walk", val avoidSteps: Boolean = false,
    val routes: List<CampusRoute> = emptyList(), val selected: Int = 0,
    val busy: Boolean = false, val error: String? = null, val trip: TripState = TripState(),
    val fix: NavFix? = null, val muted: Boolean = false, val notice: String? = null,
    val simulating: Boolean = false, val destinationLabel: String? = null,
) {
    val route get() = routes.getOrNull(selected)
    val destinationName get() = if (destinationIsMyPosition) "我的位置" else destination?.id ?: destinationLabel ?: "目的地"
    val active get() = trip.phase == TripPhase.Navigating
    fun swapped() = copy(origin = if (destinationIsMyPosition) null else destination,
        destination = origin, destinationIsMyPosition = origin == null)
}

/** Small durable record used only while a foreground navigation trip is active. */
@Serializable
data class PersistedNavigationSession(
    val route: CampusRoute,
    val destinationLabel: String,
    val mode: String,
    val avoidSteps: Boolean,
    val destination: Endpoint? = null,
)

class NavigationSessionStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("navigation-session", Context.MODE_PRIVATE)
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }

    fun save(record: PersistedNavigationSession) {
        // The service is started immediately after this call. Commit the small
        // session record before returning so a process kill cannot lose resume state.
        check(preferences.edit().putString("record", json.encodeToString(record)).commit())
    }

    fun load(): PersistedNavigationSession? = preferences.getString("record", null)?.let {
        runCatching { json.decodeFromString<PersistedNavigationSession>(it) }.getOrNull()
    }

    fun clear() { preferences.edit().remove("record").commit() }
}

/** Process session outlives Activities. The foreground service owns live updates and speech. */
@android.annotation.SuppressLint("LogNotTimber")
class NavigationRuntime private constructor(private val context: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutex = Mutex()
    private var engine: RoutingEngine? = null
    private var session: NavigationSession? = null
    private var planning: Job? = null
    private var goal: Endpoint? = null
    private var generation = 0
    private var lastTimestamp = 0L
    private var lastFixTimestamp = -1L
    private var lastReroute = Long.MIN_VALUE / 2
    private var voiceWarningShown = false
    private val _state = MutableStateFlow(PlannerState())
    val state = _state.asStateFlow()
    val location = CampusLocation.get(context)
    private val persisted = NavigationSessionStore(context)
    private val settings = context.getSharedPreferences("campus-settings", Context.MODE_PRIVATE)
    @Volatile var simulationPaused = false
        private set
    @Volatile var simulationCommand: String? = null
    init {
        persisted.load()?.let { record ->
            goal = record.destination ?: Endpoint.Target(record.destinationLabel)
            _state.value = PlannerState(
                mode = record.mode,
                avoidSteps = record.avoidSteps,
                routes = listOf(record.route),
                destinationLabel = record.destinationLabel,
            )
        }
    }
    fun debugCommand(command: String) {
        if (!BuildConfig.DEBUG) return
        if (command == "pause") simulationPaused = !simulationPaused else simulationCommand = command
    }
    fun exportRoute() {
        if (!BuildConfig.DEBUG) return
        val route = state.value.route ?: return
        scope.launch {
            withContext(Dispatchers.IO) {
                java.io.File(context.getExternalFilesDir(null), "route.json").writeText(kotlinx.serialization.json.Json.encodeToString(route))
            }
            notice("路线已导出，可用 android/tooling/replay.ps1 回放。")
        }
    }
    private suspend fun <T> native(block: () -> T): T = withContext(Dispatchers.IO) { mutex.withLock { block() } }
    private fun engine() = engine ?: Wayfind.load(context.assets).also { engine = it }
    fun open(destination: Place) {
        if (state.value.active) return
        _state.value = PlannerState(open = true, destination = destination, destinationLabel = destination.id)
        plan()
    }
    fun origin(place: Place?) { _state.update { it.copy(origin = place) }; plan() }
    fun destination(place: Place) { _state.update { it.copy(destination = place, destinationIsMyPosition = false, destinationLabel = place.id) }; plan() }
    fun swap() {
        _state.update { it.swapped() }; plan()
    }
    fun mode(mode: String) { _state.update { it.copy(mode = mode) }; plan() }
    fun avoidSteps(avoid: Boolean) { _state.update { it.copy(avoidSteps = avoid) }; plan() }
    fun choose(index: Int) { if (!state.value.active && index in state.value.routes.indices) _state.update { it.copy(selected = index) } }
    fun mute() { _state.update { it.copy(muted = !it.muted) } }
    fun notice(text: String?) { _state.update { it.copy(notice = text) } }
    fun voiceUnavailable() {
        if (voiceWarningShown) return
        voiceWarningShown = true
        notice("此设备没有可用的中文语音，请按屏幕指引前行。可在系统中安装中文语音。")
    }
    fun plan() {
        planning?.cancel()
        val version = ++generation
        val current = state.value
        val destination = current.destination
        if (destination == null && !current.destinationIsMyPosition) return
        val at = location.fix.value?.takeIf { SystemClock.elapsedRealtime() - it.timestamp < 30_000 }
        if ((current.origin == null || current.destinationIsMyPosition) && at == null) {
            _state.update { it.copy(routes = emptyList(), busy = false,
                error = "尚未获得当前位置。请开启定位，或选择${if (current.destinationIsMyPosition) "终点" else "起点"}。") }; return
        }
        val endpoint = if (current.destinationIsMyPosition) Endpoint.Position(at!!.position) else destination!!.routing
        goal = null
        _state.update { it.copy(busy = true, error = null, routes = emptyList(), selected = 0, trip = TripState()) }
        planning = scope.launch {
            try {
                val result = native { engine().route(RouteRequest(
                    current.origin?.routing ?: Endpoint.Position(at!!.position),
                    endpoint, current.mode, current.mode == "walk" && current.avoidSteps)) }
                if (version == generation) {
                    goal = endpoint // Freeze a position destination for the whole trip, including reroutes.
                    _state.update { it.copy(routes = result, busy = false,
                        error = if (result.isEmpty()) "暂无可通行路线，请更换起终点或出行方式。" else null) }
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (version == generation) _state.update { it.copy(busy = false,
                error = if (current.destinationIsMyPosition && e.message.orEmpty().contains("snap", true))
                    "我的位置不在校园道路附近（超出 100 米吸附范围）。请选择校园内的终点。"
                else routeError(e, current.origin == null)) } }
        }
    }
    fun start(simulated: Boolean = false, speed: Double = 1.0) {
        if (state.value.route == null || state.value.busy || state.value.active) return
        if (simulated && !BuildConfig.DEBUG) return
        try {
            notice(null)
            val route = checkNotNull(state.value.route)
            persisted.save(PersistedNavigationSession(route, state.value.destinationName, state.value.mode, state.value.avoidSteps,
                destination = goal ?: Endpoint.Target(state.value.destinationName)))
            val firstNavigation = !settings.getBoolean("navigation-guidance-started", false)
            if (firstNavigation) settings.edit().putBoolean("navigation-guidance-started", true)
                .putBoolean("navigation-guidance-pending", true).apply()
            if (firstNavigation) notice("后台导航需要持续定位，可在“我的 → 后台运行设置”检查一次。")
            ContextCompat.startForegroundService(context, Intent(context, NavigationService::class.java)
                .putExtra("simulate", simulated).putExtra("speed", speed))
        } catch (_: RuntimeException) {
            persisted.clear()
            notice("无法开始导航，请确认已允许定位且系统定位已开启。")
        }
    }
    suspend fun begin(simulated: Boolean) {
        val route = state.value.route ?: return
        native { session?.close(); session = engine().navigate(route) }
        lastTimestamp = 0; lastFixTimestamp = -1; lastReroute = Long.MIN_VALUE / 2
        simulationPaused = false; simulationCommand = null
        _state.update { it.copy(trip = TripState(TripPhase.Navigating), simulating = simulated) }
    }
    suspend fun feed(fix: NavFix): List<VoicePrompt> {
        if (!state.value.active) return emptyList()
        if (fix.timestamp < lastFixTimestamp) return emptyList()
        // Compass frames update the camera, but are not additional GPS evidence for off-route.
        if (fix.timestamp == lastFixTimestamp) { _state.update { it.copy(fix = fix) }; return emptyList() }
        lastFixTimestamp = fix.timestamp
        val timestamp = maxOf(lastTimestamp + 1, fix.timestamp)
        lastTimestamp = timestamp
        val value = native { session?.update(fix.copy(timestamp = timestamp)) } ?: return emptyList()
        _state.update { it.copy(fix = fix, trip = it.trip.accept(value), notice = if (value.arrived) null else it.notice) }
        if (value.off_route && timestamp - lastReroute > 10_000) {
            lastReroute = timestamp
            _state.update { it.copy(notice = "重新规划路线", trip = it.trip.copy(rerouting = true)) }
            val current = state.value
            try {
                val routes = native { engine().route(RouteRequest(Endpoint.Position(fix.position),
                    checkNotNull(goal), current.mode, current.mode == "walk" && current.avoidSteps, alternatives = 1)) }
                val route = routes.first()
                native { session?.close(); session = engine().navigate(route) }
                _state.update { it.copy(origin = null, routes = routes, selected = 0,
                    trip = TripState(TripPhase.Navigating, reroutes = it.trip.reroutes + 1)) }
                android.util.Log.i("StudevNav", "reroute complete")
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { notice("暂时无法重新规划，请返回校园道路；稍后会自动重试。") }
            return emptyList()
        }
        return value.voice_prompts
    }
    suspend fun finishSession(clearPersisted: Boolean = false) {
        native { session?.close(); session = null }
        if (clearPersisted) persisted.clear()
    }
    fun stop(close: Boolean = false) {
        ++generation; planning?.cancel()
        persisted.clear()
        context.stopService(Intent(context, NavigationService::class.java))
        _state.update { if (close) PlannerState() else it.copy(trip = TripState(), fix = null, simulating = false, notice = null) }
        scope.launch { finishSession() }
    }
    fun serviceStopped() {
        if (state.value.active) {
            _state.update { it.copy(notice = "后台导航暂时停止，系统将尝试恢复") }
        } else {
            persisted.clear()
            scope.launch { finishSession() }
        }
    }
    companion object {
        // get() retains only applicationContext, never an Activity.
        @android.annotation.SuppressLint("StaticFieldLeak")
        @Volatile private var instance: NavigationRuntime? = null
        fun get(context: Context): NavigationRuntime = instance ?: synchronized(this) {
            instance ?: NavigationRuntime(context.applicationContext).also { instance = it }
        }
        fun routeError(e: Exception, myPosition: Boolean) = when {
            e.message.orEmpty().contains("snap", true) && myPosition -> "您目前不在校园道路附近（超出 100 米吸附范围）。请选择校园内的起点。"
            e.message.orEmpty().contains("snap", true) -> "起终点附近没有可通行道路，请更换地点。"
            e.message.orEmpty().contains("unknown target", true) -> "此地点尚未接入步行路网，请选择附近楼栋。"
            else -> "无法找到可通行路线，请更换起终点或出行方式。"
        }
    }
}
