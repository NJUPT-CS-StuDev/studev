package top.hicancan.studev.timetable

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*
import top.hicancan.studev.me.CampusSettings
import top.hicancan.studev.world.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable fun EventChoices(event: LineEvent, line: CampusLine, store: CampusSettings) {
    val settings by store.state.collectAsStateWithLifecycle()
    var open by remember(event.id) { mutableStateOf(false) }
    var series by remember(event.id) { mutableStateOf(event.kind == "class") }
    val current = Schedule.preference(event, line.term.term, settings.events)
    fun change(whole: Boolean = series, edit: (EventPreference) -> EventPreference) = store.update { settings ->
        val key = Schedule.key(event, line.term.term, whole)
        val next = edit(settings.events[key] ?: EventPreference())
        var events = if (next == EventPreference()) settings.events - key else settings.events + (key to next)
        if (whole && next.avoid != null) {
            val sitting = Schedule.key(event, line.term.term)
            if (sitting != key) events[sitting]?.let { old -> val reset = old.copy(avoid = null); events = if (reset == EventPreference()) events - sitting else events + (sitting to reset) }
        }
        settings.copy(events = events)
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        KeyRow("排程", Schedule.AVOIDANCE.find { it.first == current.avoid }?.second.orEmpty(), chevron = true, onClick = { open = !open })
        if (open) {
            if (event.kind == "class" || event.kind == "lab") Chip(if (series) "整门课程 · 切换为仅这次" else "仅这次 · 切换为整门课程", { series = !series })
            Picks(Schedule.AVOIDANCE.mapIndexed { i, item -> i to item.second }, { Schedule.AVOIDANCE[it].first == current.avoid }) { i -> change { it.copy(avoid = Schedule.AVOIDANCE[i].first) } }
            Chip("恢复排程默认", { change { it.copy(avoid = null) } })
            Plain("排时间时如何避让；不改变是否参加、提醒或显示顺序。", 12.sp, Ink.muted)
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("将这一项置于前面", { change(false) { it.copy(layer = System.currentTimeMillis()) } })
                Chip("恢复图层", { change(false) { it.copy(layer = null) } })
            }
        }
    }
}
