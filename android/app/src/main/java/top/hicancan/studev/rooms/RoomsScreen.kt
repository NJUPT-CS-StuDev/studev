package top.hicancan.studev.rooms

import androidx.compose.foundation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.DirectionsWalk
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import top.hicancan.studev.campus.*
import top.hicancan.studev.data.*
import top.hicancan.studev.timetable.CampusDay
import top.hicancan.studev.ui.theme.Tokens
import java.time.*
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable fun RoomsScreen(repo: AcademicRepository, index: RoomIndex, campus: String, initialQuery: String = "", initialDate: String? = null, initialPeriod: Int? = null,
    onCampus: (String) -> Unit, onRoute: (String, Boolean) -> Unit) {
    val now = CampusDay.now()
    val context = LocalContext.current
    val store = remember(context) { context.getSharedPreferences("room-building-selection", android.content.Context.MODE_PRIVATE) }
    var selectedBuildings by remember(campus) { mutableStateOf<Set<String>?>(if (store.contains(campus)) store.getStringSet(campus, emptySet())?.toSet() else null) }
    fun chooseBuildings(ids: Set<String>?) {
        selectedBuildings = ids
        if (ids == null) store.edit().remove(campus).apply() else store.edit().putStringSet(campus, ids).apply()
    }
    var buildingMenu by remember { mutableStateOf(false) }
    var dateText by rememberSaveable(initialDate) { mutableStateOf(runCatching { CampusDay.clamp(index.weeks, LocalDate.parse(initialDate)).toString() }.getOrElse { CampusDay.clamp(index.weeks, now.toLocalDate()).toString() }) }
    var period by rememberSaveable(initialPeriod) { mutableIntStateOf(initialPeriod?.takeIf { p -> index.periods.any { it.period == p } } ?: CampusDay.periodAt(index.periods, now.toLocalTime())) }
    var until by rememberSaveable { mutableIntStateOf(period) }
    var query by rememberSaveable(initialQuery) { mutableStateOf(initialQuery) }
    var everything by rememberSaveable { mutableStateOf(false) }
    var minSeats by rememberSaveable { mutableIntStateOf(0) }
    var datePicker by remember { mutableStateOf(false) }
    var periodMenu by remember { mutableStateOf(false) }
    var seatMenu by remember { mutableStateOf(false) }
    var room by remember { mutableStateOf<Room?>(null) }
    var day by remember(repo, dateText) { mutableStateOf<RoomDay?>(null) }
    var loading by remember(repo, dateText) { mutableStateOf(true) }
    var error by remember(repo, dateText) { mutableStateOf<String?>(null) }
    LaunchedEffect(repo, dateText) {
        try { day = repo.roomDay(index.term, dateText) }
        catch (e: CancellationException) { throw e }
        catch (_: Exception) { error = "这天的数据暂时无法读取，请更换日期或稍后重试" }
        finally { loading = false }
    }
    val eligible = RoomSelection.filter(index.rooms, campus, selectedBuildings, everything, query, minSeats)
    val buildings = index.buildings.filter { it.campus == campus }.sortedWith(compareBy<Building> { if (it.id.startsWith("教")) 0 else if (it.id.endsWith("其他场地")) 2 else 1 }.thenBy { it.id })
    val buildingChoices = buildings.filter { building -> index.rooms.any { it.building == building.id && CampusDay.eligible(it, everything) } }.map { it.id }
    val chosen = buildingChoices.filter { selectedBuildings == null || it in selectedBuildings.orEmpty() }
    val allBuildingChoices = buildings.filter { building -> index.rooms.any { it.building == building.id && CampusDay.eligible(it, true) } }.map { it.id }.toSet()
    fun toggleBuilding(id: String) {
        chooseBuildings(RoomSelection.toggle(selectedBuildings, allBuildingChoices, id))
    }
    val dark = MaterialTheme.colorScheme.background == Tokens.Color.Dark.paper
    val success = if (dark) Tokens.Color.Dark.success else Tokens.Color.Light.success
    val warning = if (dark) Tokens.Color.Dark.warning else Tokens.Color.Light.warning
    val paper = MaterialTheme.colorScheme.background
    val busy = if (dark) Tokens.Color.Dark.surface else Tokens.Color.Light.surfaceSunken
    val faint = if (dark) Tokens.Color.Dark.faint else Tokens.Color.Light.faint
    val free = day?.let { status -> eligible.count { CampusDay.isFree(status, it.id, period, until) } }
    LazyColumn(Modifier.fillMaxSize().testTag("rooms"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column { Text("找间空教室", style = MaterialTheme.typography.headlineSmall); Supporting("${dateText.replace('-', '.')} · 第 ${CampusDay.weekOf(index.weeks, LocalDate.parse(dateText))?.week ?: "—"} 周") }
                IconButton({ datePicker = true }) { Icon(Icons.Outlined.DateRange, "选择日期") }
            }
        }
        item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            index.campuses.filter { item -> index.rooms.any { it.campus == item.id && it.listed } }.forEach { item -> FilterChip(campus == item.id, { onCampus(item.id) }, { Text(item.id) }) }
            (0L..2L).forEach { offset ->
                val date = CampusDay.clamp(index.weeks, now.toLocalDate()).plusDays(offset)
                if (date <= LocalDate.parse(index.weeks.last().end)) FilterChip(dateText == date.toString(), { dateText = date.toString() }, { Text(if (offset == 0L) "今天" else if (offset == 1L) "明天" else "后天") })
            }
        } }
        item {
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("楼栋或教室，如 教3、图409") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true,
                trailingIcon = if (query.isNotEmpty()) ({ IconButton({ query = "" }) { Icon(Icons.Outlined.Close, "清除") } }) else null)
        }
        item {
            Box {
                AssistChip({ buildingMenu = true }, { Text("楼栋 · " + if (selectedBuildings == null) "全部" else if (chosen.isEmpty()) "未选择" else "已选 "+chosen.size) },
                    modifier = Modifier.testTag("building-filter"), trailingIcon = { Icon(Icons.Outlined.ExpandMore, null, Modifier.size(16.dp)) })
                DropdownMenu(buildingMenu, { buildingMenu = false }, modifier = Modifier.heightIn(max = 360.dp).widthIn(min = 240.dp, max = 320.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton({ chooseBuildings(null) }, modifier = Modifier.testTag("buildings-all")) { Text("全选") }
                        TextButton({ chooseBuildings(emptySet()) }, modifier = Modifier.testTag("buildings-none")) { Text("全不选") }
                        TextButton({ buildingMenu = false }) { Text("完成") }
                    }
                    HorizontalDivider()
                    buildingChoices.forEach { id -> DropdownMenuItem(text = { Text(id) }, leadingIcon = { Checkbox(id in chosen, onCheckedChange = null) },
                        onClick = { toggleBuilding(id) }, modifier = Modifier.testTag("building-$id")) }
                }
            }
            if (selectedBuildings != null && chosen.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                chosen.take(3).forEach { id -> InputChip(true, { toggleBuilding(id) }, { Text(id) }, trailingIcon = { Icon(Icons.Outlined.Close, "取消选择$id", Modifier.size(14.dp)) },
                    colors = InputChipDefaults.inputChipColors(selectedContainerColor = MaterialTheme.colorScheme.primaryContainer, selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer, selectedTrailingIconColor = MaterialTheme.colorScheme.onPrimaryContainer)) }
                if (chosen.size > 3) Supporting("+"+(chosen.size-3), Modifier.padding(12.dp))
            }
        }
        item { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            index.periods.forEach { p -> FilterChip(period == p.period, { period = p.period; until = period }, { Text("${p.period} 节\n${p.start}", style = MaterialTheme.typography.labelSmall) }) }
        } }
        item {
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box { AssistChip({ periodMenu = true }, { Text(if (until == period) "只看第 $period 节" else "连续到第 $until 节") }, trailingIcon = { Icon(Icons.Outlined.ExpandMore, null, Modifier.size(16.dp)) })
                    DropdownMenu(periodMenu, { periodMenu = false }) { index.periods.filter { it.period >= period }.forEach { p -> DropdownMenuItem({ Text(if (p.period == period) "只看第 $period 节" else "到第 ${p.period} 节 · ${p.end}") }, { until = p.period; periodMenu = false }) } }
                }
                Box { AssistChip({ seatMenu = true }, { Text(if (minSeats == 0) "座位不限" else "$minSeats 座以上") })
                    DropdownMenu(seatMenu, { seatMenu = false }) { listOf(0, 30, 60, 100, 150).forEach { seats -> DropdownMenuItem({ Text(if (seats == 0) "不限座位" else "至少 $seats 座") }, { minSeats = seats; seatMenu = false }) } }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(everything, { everything = it }); Supporting("全部场地（含机房、实验室）") }
            Text(if (free == null) { if (loading) "正在读取空闲情况…" else "这天没有已发布的空闲数据" } else "$free / ${eligible.size} 间空闲", style = MaterialTheme.typography.titleMedium, color = success, modifier = Modifier.testTag("room-summary"))
            Supporting(day?.let { it.observed_at?.let { stamp -> "空闲情况 ${OffsetDateTime.parse(stamp).atZoneSameInstant(CampusDay.zone).format(DateTimeFormatter.ofPattern("M月d日 HH:mm"))} 更新" } ?: "按课表推算，未计入借用和调课" } ?: error ?: "请勿将没有数据的教室视为空闲。", Modifier.padding(top = 6.dp))
        }
        if (!loading && day == null) item { EmptyCard("暂无这天的空闲数据", error ?: "换一天试试，以学校实际安排为准。") }
        items(buildings.filter { building -> eligible.any { it.building == building.id } }, key = { it.id }) { building ->
            val rooms = eligible.filter { it.building == building.id }
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(building.id, style = MaterialTheme.typography.titleMedium); Supporting(day?.let { status -> "${rooms.count { CampusDay.isFree(status, it.id, period, until) }} / ${rooms.size} 空闲" } ?: "暂无数据") }
                    building.floors.sortedByDescending { it.toIntOrNull() ?: -1 }.forEach { floor ->
                        val floorRooms = rooms.filter { it.floor == floor }.sortedBy { it.number }
                        if (floorRooms.isNotEmpty()) {
                            Supporting(if (floor.isBlank()) "其他" else "${floor}F")
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                floorRooms.forEach { item ->
                                    val available = day?.let { CampusDay.isFree(it, item.id, period, until) }
                                    val occupants = day?.let { CampusDay.occupants(it, item.id, period) }
                                    val exam = available == false && occupants?.any { it.kind == "exam" } == true
                                    val tint = if (exam) warning else success
                                    val label = when { available == null -> "加载中"; available -> "空闲"; occupants == null -> "已占用（借用、调课等）"; occupants.isNotEmpty() -> occupants.joinToString("、") { (if (it.kind == "exam") "考试：" else "") + it.course }; else -> "所选节次内有占用" }
                                    Surface(onClick = { room = item }, shape = MaterialTheme.shapes.small,
                                        color = if (available == true || exam) tint.copy(alpha = if (exam) .12f else .10f).compositeOver(paper) else busy,
                                        contentColor = if (available == true || exam) tint else faint,
                                        border = BorderStroke(1.dp, if (available == true || exam) tint.copy(alpha = if (exam) .35f else .30f).compositeOver(paper) else MaterialTheme.colorScheme.outlineVariant),
                                        modifier = Modifier.heightIn(min = 44.dp).testTag("room-${item.id}").semantics { contentDescription = "${item.id}，$label" }) {
                                        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                            if (available == true) Icon(Icons.Outlined.Check, "空闲", Modifier.size(14.dp))
                                            Text(item.number, style = MaterialTheme.typography.labelMedium)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (eligible.isEmpty()) item { EmptyCard(if (selectedBuildings?.isEmpty() == true) "尚未选择楼栋" else "没有匹配的教室", if (selectedBuildings?.isEmpty() == true) "请在楼栋筛选中选择。" else "试试其他楼栋、校区或座位数。") }
    }
    if (datePicker) {
        val picker = rememberDatePickerState(initialSelectedDateMillis = LocalDate.parse(dateText).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : SelectableDates { override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                val date = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                return date >= LocalDate.parse(index.weeks.first().start) && date <= LocalDate.parse(index.weeks.last().end)
            } })
        DatePickerDialog(onDismissRequest = { datePicker = false }, confirmButton = { TextButton({ picker.selectedDateMillis?.let { dateText = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() }; datePicker = false }) { Text("确定") } }, dismissButton = { TextButton({ datePicker = false }) { Text("取消") } }) { DatePicker(picker) }
    }
    room?.let { selected -> ModalBottomSheet(onDismissRequest = { room = null }) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(selected.id, style = MaterialTheme.typography.headlineSmall)
            Supporting("$campus · ${selected.floor}楼${selected.seats?.let { " · $it 座" }.orEmpty()} · $dateText")
            day?.let { status -> index.periods.forEach { p ->
                val occupants = CampusDay.occupants(status, selected.id, p.period)
                val text = when { occupants == null -> "已占用（借用、调课等）"; occupants.isEmpty() -> "空闲"; else -> occupants.joinToString("、") { (if (it.kind == "exam") "考试：" else "") + it.course } }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Supporting("${p.period} 节 · ${p.start}", Modifier.width(100.dp)); Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                }
            } } ?: Supporting("暂无这天的空闲数据")
            Button({ room = null; onRoute(selected.id, false) }, Modifier.fillMaxWidth()) { Icon(Icons.AutoMirrored.Outlined.DirectionsWalk, null); Spacer(Modifier.width(8.dp)); Text("去这里") }
        }
    } }
}
