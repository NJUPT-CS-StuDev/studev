package top.hicancan.studev.activity

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import top.hicancan.studev.account.AccountClient
import top.hicancan.studev.account.PlatformFailure
import top.hicancan.studev.data.CampusPackage
import top.hicancan.studev.ui.theme.Tokens
import java.time.*
import java.time.format.DateTimeFormatter

private val timeFormat = DateTimeFormatter.ofPattern("M月d日 HH:mm")
internal fun displayActivityTime(value: String) = timeFormat.format(Instant.parse(value).atZone(ZoneId.systemDefault()))
private fun activityError(error: Exception) = if (error is PlatformFailure || error is IllegalArgumentException) error.message ?: "操作未完成。" else "连接未完成，请检查网络后重试。"

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ActivitiesScreen(service: Activities, client: AccountClient, selectedId: String?, onSelect: (String?) -> Unit,
    onBack: () -> Unit, onAccount: () -> Unit, onCreate: () -> Unit, onPlace: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<CampusActivity>>(emptyList()) }
    var next by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<CampusActivity?>(null) }
    var mine by rememberSaveable { mutableStateOf(false) }
    var userId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    var deleting by remember { mutableStateOf(false) }
    LaunchedEffect(selectedId, mine, retry) {
        busy = true; error = null; selected = null
        try {
            userId = client.current()?.id
            if (selectedId != null) selected = service.get(selectedId)
            else { val page = service.upcoming(mine); items = page.items; next = page.next }
        } catch(e: Exception) { error = activityError(e) } finally { busy = false }
    }
    Scaffold(topBar = { TopAppBar(title = { Text(if (selectedId == null) "校园活动" else "活动详情") },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
        actions = { IconButton(onClick = onAccount) { Icon(Icons.Outlined.AccountCircle, "账号") } }) },
        floatingActionButton = { if (selectedId == null) ExtendedFloatingActionButton(onClick = onCreate, icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("发起活动") }) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(Tokens.Space.xl.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.l.dp)) {
            if (busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error); TextButton(onClick = { retry++ }) { Text("重试") } } }
            if (selectedId == null) {
                item { Text("把时间与地点，分享给同行的人。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { FilterChip(!mine, onClick = { mine = false }, label = { Text("近期活动") }); if (userId != null) FilterChip(mine, onClick = { mine = true }, label = { Text("我发起的") }) } }
                if (!busy && error == null && items.isEmpty()) item { OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { Icon(Icons.Outlined.Event, null, tint = MaterialTheme.colorScheme.primary); Text("还没有近期活动", style = MaterialTheme.typography.titleMedium); Text("一次散步、一场交流，都可以从这里开始。", color = MaterialTheme.colorScheme.onSurfaceVariant) } } }
                items(items, key = { it.id }) { activity ->
                    OutlinedCard(onClick = { onSelect(activity.id) }, Modifier.fillMaxWidth()) { Column(Modifier.padding(Tokens.Space.l.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(displayActivityTime(activity.startsAt), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        Text(activity.title, style = MaterialTheme.typography.titleLarge)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(Icons.Outlined.Place, null, Modifier.size(18.dp)); Text(activity.place.label) }
                        Text("${activity.organiser.name} 发起", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } }
                }
                next?.let { cursor -> item { TextButton(enabled = !busy, onClick = { scope.launch { busy = true; try { val page = service.upcoming(mine, cursor); items = items + page.items; next = page.next } catch(e: Exception) { error = activityError(e) } finally { busy = false } } }) { Text("更多活动") } } }
                item { Spacer(Modifier.height(88.dp)) }
            } else selected?.let { activity ->
                item { Text(if (activity.visibility == "public") "校园活动" else "仅凭链接访问", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge) }
                item { Text(activity.title, style = MaterialTheme.typography.headlineMedium) }
                item { ListItem(headlineContent = { Text("${displayActivityTime(activity.startsAt)} — ${displayActivityTime(activity.endsAt)}") }, leadingContent = { Icon(Icons.Outlined.Schedule, null) }) }
                item { ListItem(headlineContent = { Text(activity.place.label) }, leadingContent = { Icon(Icons.Outlined.Place, null) }) }
                item { ListItem(headlineContent = { Text("${activity.organiser.name} 发起") }, leadingContent = { Icon(Icons.Outlined.Person, null) }) }
                item { HorizontalDivider(); Spacer(Modifier.height(16.dp)); Text(activity.description.ifBlank { "发起人还没有填写活动介绍。" }, style = MaterialTheme.typography.bodyLarge) }
                item { Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Button(onClick = { ActivityLinks.share(context, activity) }) { Icon(Icons.Outlined.Share, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("分享活动") }
                    (activity.place as? ActivityPlace.Campus)?.let { p -> OutlinedButton(onClick = { onPlace(p.id) }) { Text("在地图上查看") } }
                } }
                if (userId == activity.organiser.id) item { TextButton(onClick = { deleting = true }) { Text("删除活动", color = MaterialTheme.colorScheme.error) } }
            }
        }
    }
    if (deleting && selected != null) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("删除活动？") }, text = { Text("删除后，原有分享链接将无法访问此活动。") },
        confirmButton = { TextButton(enabled = !busy, onClick = { scope.launch { busy = true; try { service.delete(selected!!); deleting = false; onSelect(null); retry++ } catch(e: Exception) { deleting = false; error = activityError(e) } finally { busy = false } } }) { Text("删除") } },
        dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ActivityEditor(service: Activities, client: AccountClient, initialPlace: ActivityPlace?, onBack: () -> Unit, onSignIn: () -> Unit, onSaved: (CampusActivity) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var placeId by rememberSaveable { mutableStateOf((initialPlace as? ActivityPlace.Campus)?.id ?: "") }
    var public by rememberSaveable { mutableStateOf(true) }
    var starts by rememberSaveable { mutableLongStateOf(System.currentTimeMillis() + 3600000) }
    var ends by rememberSaveable { mutableLongStateOf(System.currentTimeMillis() + 7200000) }
    var picking by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var signedIn by remember { mutableStateOf(false) }
    var campus by remember { mutableStateOf<CampusPackage?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { try { signedIn = client.current() != null; campus = CampusPackage.load(context.assets) } catch(e: Exception) { error = "校园地点暂时无法读取，请重新打开页面。" }; loaded = true }
    Scaffold(topBar = { TopAppBar(title = { Text("发起活动") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(Tokens.Space.xl.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.l.dp)) {
            if (!loaded) { CircularProgressIndicator(); return@Column }
            if (!signedIn) { Text("登录后发起活动", style = MaterialTheme.typography.headlineSmall); Text("使用与网页相同的账号，把活动分享给同行的人。"); Button(onClick = onSignIn) { Text("去登录") }; return@Column }
            Text("把时间与地点，分享给同行的人。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(title, { title = it.take(80) }, Modifier.fillMaxWidth(), label = { Text("活动标题") }, singleLine = true)
            OutlinedButton(onClick = { picking = "start" }, Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Schedule, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("开始  ${displayActivityTime(Instant.ofEpochMilli(starts).toString())}") }
            OutlinedButton(onClick = { picking = "end" }, Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Schedule, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("结束  ${displayActivityTime(Instant.ofEpochMilli(ends).toString())}") }
            if (initialPlace is ActivityPlace.Point) ListItem(headlineContent = { Text(initialPlace.name) }, supportingContent = { Text("地图集合点") }, leadingContent = { Icon(Icons.Outlined.Place, null) })
            else {
                OutlinedTextField(placeId, { placeId = it.take(160) }, Modifier.fillMaxWidth(), label = { Text("校园地点") }, supportingText = { Text("输入楼栋、教室或地点名称。") }, singleLine = true)
                if (placeId.isNotBlank() && campus?.byId?.containsKey(placeId) != true) {
                    campus?.byId?.values?.filter { it.id.contains(placeId, ignoreCase = true) }?.take(6)?.forEach { p -> TextButton(onClick = { placeId = p.id }, Modifier.fillMaxWidth()) { Text(p.id) } }
                }
            }
            OutlinedTextField(description, { description = it.take(2000) }, Modifier.fillMaxWidth(), label = { Text("活动介绍（选填）") }, minLines = 4)
            Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("公开展示"); Text(if (public) "出现在活动列表和地图上" else "仅凭链接访问", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(public, onCheckedChange = { public = it }) }
            Text("两种方式都可以通过链接查看。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(enabled = !busy && title.isNotBlank() && (initialPlace is ActivityPlace.Point || campus?.byId?.containsKey(placeId) == true), onClick = { scope.launch {
                busy = true; error = null
                try { onSaved(service.save(ActivityDraft(title, Instant.ofEpochMilli(starts).toString(), Instant.ofEpochMilli(ends).toString(), initialPlace as? ActivityPlace.Point ?: ActivityPlace.Campus(placeId), description, if (public) "public" else "unlisted"))) }
                catch(e: Exception) { error = activityError(e) } finally { busy = false }
            } }, modifier = Modifier.fillMaxWidth()) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("保存活动") }
        }
    }
    picking?.let { target -> ActivityDateTimePicker(if (target == "start") starts else ends, onDismiss = { picking = null }) { value -> if (target == "start") starts = value else ends = value; picking = null } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ActivityDateTimePicker(initial: Long, onDismiss: () -> Unit, onValue: (Long) -> Unit) {
    val local = Instant.ofEpochMilli(initial).atZone(ZoneId.systemDefault())
    val date = rememberDatePickerState(initialSelectedDateMillis = local.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    val time = rememberTimePickerState(initialHour = local.hour, initialMinute = local.minute, is24Hour = true)
    var clock by remember { mutableStateOf(false) }
    if (!clock) DatePickerDialog(onDismissRequest = onDismiss, confirmButton = { TextButton(enabled = date.selectedDateMillis != null, onClick = { clock = true }) { Text("选择时间") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }) { DatePicker(date) }
    else AlertDialog(onDismissRequest = onDismiss, title = { Text("选择时间") }, text = { TimeInput(time) },
        confirmButton = { TextButton(onClick = { val day = Instant.ofEpochMilli(date.selectedDateMillis!!).atZone(ZoneOffset.UTC).toLocalDate(); onValue(day.atTime(time.hour, time.minute).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()) }) { Text("确定") } },
        dismissButton = { TextButton(onClick = { clock = false }) { Text("返回日期") } })
}
