package top.hicancan.studev.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*
import top.hicancan.studev.data.Room
import top.hicancan.studev.data.RoomDay
import top.hicancan.studev.world.*
import java.time.LocalDate

private val naturally = compareBy<String>({ it.takeWhile { c -> !c.isDigit() } }, { it.dropWhile { c -> !c.isDigit() }.takeWhile { c -> c.isDigit() }.toIntOrNull() ?: 0 }, { it })

/** Every classroom at a moment: with no words, the rooms dimension of search lists them all, and being complete it falls into buildings and floors by itself. */
@Composable fun RoomsBrowse(state: AcademicState, route: Route, modifier: Modifier = Modifier) {
    val now = remember { Moment.of(CampusDay.now()) }
    var date by remember { mutableStateOf(now.date) }
    var minute by remember { mutableIntStateOf(now.min) }
    var campus by remember { mutableStateOf("仙林") }
    var building by remember { mutableStateOf<String?>(null) }
    var everything by remember { mutableStateOf(false) }
    var day by remember { mutableStateOf<RoomDay?>(null) }
    val index = state.rooms
    LaunchedEffect(date, index, state.repository) {
        day = index?.let { rooms -> state.repository?.let { repo -> runCatching { repo.roomDay(rooms.term, date.toString()) }.getOrNull() } }
    }
    if (index == null || state.periods.isEmpty()) return
    val reader = remember(state.periods) { RoomReader(state.periods) }
    val free = marks().free
    val rooms = remember(index) { index.rooms.filter(RoomReader::classroom) }
    val groups = remember(rooms, day, minute, campus) {
        rooms.filter { it.campus == campus }.groupBy { it.building }.toSortedMap(naturally).map { (name, inside) ->
            val floors = inside.groupBy { it.floor }.toSortedMap(naturally).map { (floor, list) -> floor to list.sortedWith(compareBy(naturally) { it.number }).map { it to reader.at(day, it.id, minute) } }
            Triple(name, floors, inside.count { !reader.at(day, it.id, minute).busy } to inside.size)
        }
    }
    val running = state.periods.firstOrNull { clock(it.start) <= minute && minute < clock(it.end) }?.period
    val shown = groups.filter { building == null || it.first == building }
    Column(modifier.padding(top = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Chip("‹", { date = date.minusDays(1) })
            Plain(hm(minute), 24.sp, weight = FontWeight.SemiBold)
            Plain((if (date == now.date) "今天" else WEEKDAYS[date.dayOfWeek.value]) + " " + dateLabel(date), 13.5.sp, Ink.muted, modifier = Modifier.weight(1f))
            if (date != now.date || minute != now.min) Chip("现在", { date = now.date; minute = now.min })
            Chip("›", { date = date.plusDays(1) })
        }
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            state.periods.sortedBy { it.period }.forEach { period ->
                val on = running == period.period
                Box(Modifier.weight(1f).height(30.dp).clip(RoundedCornerShape(6.dp)).background(if (on) Ink.text else Ink.sunken).clickable { minute = clock(period.start) }, contentAlignment = Alignment.Center) {
                    Plain(period.period.toString(), 11.5.sp, if (on) Ink.paper else Ink.muted, if (on) FontWeight.SemiBold else FontWeight.Normal)
                }
            }
        }
        Row(Modifier.padding(top = 12.dp, bottom = 4.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            @Composable fun option(label: String, on: Boolean, tap: () -> Unit) = Plain(label, 13.sp, if (on) Ink.text else Ink.muted, if (on) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.clickable(onClick = tap))
            listOf("仙林", "三牌楼", "锁金").forEach { name -> option(name, campus == name) { campus = name; building = null } }
            Spacer(Modifier.width(6.dp))
            option("全部的楼", building == null) { building = null }
            groups.forEach { (name) -> option(name, building == name) { building = name } }
            option(if (everything) "显示全部" else "只看空的", false) { everything = !everything }
        }
        if (day == null) { Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) { Plain("这一天没有排课数据", 14.sp, Ink.faint) }; return@Column }
        LazyColumn(Modifier.weight(1f)) {
            items(shown, key = { it.first }) { (name, floors, count) ->
                Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 6.dp).bottomHairline(Ink.line).padding(bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                    Plain(name, 17.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Plain(count.first.toString(), 12.5.sp, free, FontWeight.SemiBold)
                    Plain(" / ${count.second} 间空闲", 12.5.sp, Ink.muted)
                }
                floors.forEach { (floor, rows) ->
                    val visible = if (everything) rows else rows.filter { !it.second.busy }
                    if (visible.isNotEmpty()) Row(Modifier.padding(bottom = 6.dp)) {
                        Plain(floor, 12.sp, Ink.faint, modifier = Modifier.width(26.dp).padding(top = 8.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            visible.chunked(4).forEach { line ->
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    line.forEach { (room, status) -> RoomTile(room, status, free, Modifier.weight(1f)) { if (Names.placed(room.id)) route.map(room.id, date to minute) else route.timetable("room", room.id, "day", date) } }
                                    repeat(4 - line.size) { Spacer(Modifier.weight(1f)) }
                                }
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable private fun RoomTile(room: Room, status: RoomState, free: Color, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(6.dp)
    val fill = when (status.tier) { "long" -> free.copy(alpha = .26f); "mid" -> free.copy(alpha = .14f); "short" -> free.copy(alpha = .06f); else -> Color.Transparent }
    Column(modifier.clip(shape).background(fill).then(if (status.busy) Modifier.border(1.dp, Ink.line, shape) else Modifier).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 6.dp)) {
        Plain(room.number, 14.sp, if (status.busy) Ink.faint else Ink.text, if (status.busy) FontWeight.Normal else FontWeight.SemiBold, maxLines = 1)
        Plain(if (status.busy) "有课" else "到 ${hm(status.until)}", 11.sp, if (status.busy) Ink.faint else Ink.muted, maxLines = 1)
    }
}
