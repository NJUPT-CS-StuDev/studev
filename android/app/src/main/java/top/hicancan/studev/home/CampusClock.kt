package top.hicancan.studev.home

import androidx.compose.runtime.*
import kotlinx.coroutines.delay
import top.hicancan.studev.BuildConfig
import java.time.LocalDateTime

/** Presentation clock only. Navigation always keeps the monotonic GPS clock. */
object CampusClock {
    private var override by mutableStateOf<LocalDateTime?>(null)
    fun setDebugTime(value: LocalDateTime?) { check(BuildConfig.DEBUG); override = value }
    @Composable fun now(): LocalDateTime {
        var tick by remember { mutableStateOf(LocalDateTime.now()) }
        LaunchedEffect(Unit) { while (true) { tick = LocalDateTime.now(); delay(15_000) } }
        return override ?: tick
    }
}
