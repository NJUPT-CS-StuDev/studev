package top.hicancan.studev.navigation

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.filterNotNull
import top.hicancan.studev.BuildConfig
import top.hicancan.studev.MainActivity
import top.hicancan.studev.R

@android.annotation.SuppressLint("LogNotTimber")
class NavigationService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var runtime: NavigationRuntime
    private lateinit var voice: VoiceGuide
    private var job: Job? = null
    private var wake: PowerManager.WakeLock? = null
    override fun onBind(intent: Intent?) = null
    override fun onCreate() {
        super.onCreate()
        runtime = NavigationRuntime.get(this)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "校园导航", NotificationManager.IMPORTANCE_LOW))
        voice = VoiceGuide(this, runtime::voiceUnavailable)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (job?.isActive == true) return START_STICKY
        if (runtime.state.value.route == null) { stopSelf(); return START_NOT_STICKY }
        try {
            ServiceCompat.startForeground(this, ID, notification(runtime.state.value),
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
            getSystemService(NotificationManager::class.java).cancel(RECOVERY_ID)
        } catch (_: SecurityException) { runtime.notice("请允许定位后再开始导航。"); stopSelf(); return START_NOT_STICKY }
        wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "studev:navigation").apply {
            setReferenceCounted(false); acquire()
        }
        val simulate = BuildConfig.DEBUG && intent?.getBooleanExtra("simulate", false) == true
        job = scope.launch {
            try {
                runtime.begin(simulate)
                launch {
                    var notified: Pair<TripState, String>? = null
                    runtime.state.collect {
                    voice.muted = it.muted
                    val content = it.trip to it.destinationName
                    if (content != notified) {
                        getSystemService(NotificationManager::class.java).notify(ID, notification(it))
                        notified = content
                    }
                } }
                if (simulate) simulate(intent.getDoubleExtra("speed", 1.0).coerceIn(1.0, 40.0))
                else {
                    runtime.location.acquire(this@NavigationService)
                    runtime.location.fix.filterNotNull().collect { fix -> process(fix) }
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { android.util.Log.e("StudevNav", "navigation stopped", e); runtime.notice("导航暂时中断，系统将尝试恢复。"); stopSelf() }
        }.also { task -> task.invokeOnCompletion { if (job === task) job = null } }
        return START_STICKY
    }
    private suspend fun process(fix: NavFix) {
        val prompts = runtime.feed(fix)
        if (prompts.isNotEmpty()) voice.speak(prompts.joinToString("，") { it.text })
        if (runtime.state.value.trip.phase == TripPhase.Arrived) {
            runtime.location.release(this)
            runtime.finishSession(clearPersisted = true)
            // Finish the final arrival announcement before releasing TTS and the wake lock.
            withTimeoutOrNull(12_000) { delay(600); while (voice.speaking) delay(150) }
            stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
        }
    }
    private suspend fun simulate(multiplier: Double) {
        var route = runtime.state.value.route ?: return
        var sampler = RouteSimulator(route)
        var distance = 0.0
        var timestamp = SystemClock.elapsedRealtime()
        while (runtime.state.value.active) {
            if (route !== runtime.state.value.route) {
                route = runtime.state.value.route ?: return
                sampler = RouteSimulator(route); distance = 0.0
            }
            val command = runtime.simulationCommand
            when (command) {
                "arrive" -> { timestamp += ((route.distance_m - distance) / 1.25 * 1000).toLong(); distance = route.distance_m }
                "detour" -> {
                    val base = sampler.sample(distance, timestamp, false)
                    val angle = Math.toRadians(base.heading ?: 0.0)
                    // A deliberate 45 m offset tests the real kernel's sustained off-route threshold.
                    repeat(4) {
                        timestamp += 1000
                        process(base.copy(longitude = base.longitude + kotlin.math.cos(angle) * 45 / (111_195 * kotlin.math.cos(Math.toRadians(base.latitude))),
                            latitude = base.latitude - kotlin.math.sin(angle) * 45 / 111_195, timestamp = timestamp))
                    }
                }
            }
            runtime.simulationCommand = null
            if (runtime.simulationPaused && command != "arrive") { delay(200); continue }
            process(sampler.sample(distance, timestamp))
            delay(1000)
            val seconds = multiplier
            distance += seconds * if (route.mode == "bike") 4.2 else 1.25
            timestamp += (seconds * 1000).toLong()
        }
    }
    private fun notification(state: PlannerState): Notification {
        val next = state.trip.banner
        val title = if (next == null) "正在开始校园导航" else "${metres(next.distance_m)} · ${maneuverLabel(next.maneuver.type, next.maneuver.modifier)}"
        val pending = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val exit = PendingIntent.getService(this, 1, Intent(this, NavigationStopService::class.java), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_navigation)
            .setContentTitle(title).setContentText("前往${state.destinationName} · 点击返回导航")
            .setStyle(NotificationCompat.BigTextStyle().bigText(listOfNotNull(next?.maneuver?.instruction,
                "前往${state.destinationName} · 剩余${metres(state.trip.update?.distance_remaining_m ?: state.route?.distance_m ?: 0.0)}").joinToString("\n")))
            .setContentIntent(pending).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION).setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, "退出导航", exit).build()
    }
    override fun onDestroy() {
        val wasActive = runtime.state.value.active
        scope.cancel(); runtime.location.release(this)
        voice.close(); wake?.let { if (it.isHeld) it.release() }; wake = null
        runtime.serviceStopped()
        if (wasActive) getSystemService(NotificationManager::class.java).notify(RECOVERY_ID, recoveryNotification())
        super.onDestroy()
    }
    private fun recoveryNotification(): Notification {
        val resume = if (Build.VERSION.SDK_INT >= 26) PendingIntent.getForegroundService(
            this, 2, Intent(this, NavigationService::class.java).setAction(ACTION_RESUME),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        else PendingIntent.getService(this, 2, Intent(this, NavigationService::class.java).setAction(ACTION_RESUME),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_navigation)
            .setContentTitle("后台导航已暂停").setContentText("点击继续前往${runtime.state.value.destinationName}")
            .setContentIntent(resume).setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_NAVIGATION).build()
    }
    companion object { const val CHANNEL = "campus-navigation"; const val ID = 41; const val RECOVERY_ID = 42; const val ACTION_RESUME = "studev.navigation.resume" }
}

/** Notification stop action does not depend on a visible Activity. */
class NavigationStopService : Service() {
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        NavigationRuntime.get(this).stop(); stopSelf(); return START_NOT_STICKY
    }
}
