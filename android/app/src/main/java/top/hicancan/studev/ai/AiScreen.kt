package top.hicancan.studev.ai

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.studev.account.Accounts
import top.hicancan.studev.account.PlatformFailure
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.app.Ink
import top.hicancan.studev.app.Plain
import top.hicancan.studev.app.Route
import top.hicancan.studev.app.marks
import top.hicancan.studev.world.CampusTools
import top.hicancan.studev.world.Names
import top.hicancan.studev.world.TaskProposal
import top.hicancan.studev.world.hm
import androidx.compose.animation.core.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver

/** What one can ask, offered while the conversation is empty, as AI_EXAMPLES in src/campus/ai/AiApp.tsx. */
private val EXAMPLES = listOf("这周有哪些截止和考试？", "今天下午哪里有空教室？", "帮我在下周找三次一小时复习，周五前完成", "从教三到图书馆怎么走？")
/** What each tool is doing, as a step says it, as STEPS in AiApp.tsx. */
private val STEPS = mapOf("campus_search" to "搜索校园资料", "timeline" to "查看你的安排", "list_tasks" to "读取你的任务", "suggest_slots" to "找空闲时间", "free_rooms" to "查空教室", "route" to "规划路线", "propose_task" to "起草任务")

/**
 * The fourth entry beside the timetable, the map and search, as src/campus/ai/AiApp.tsx: one conversation over the
 * same tools as the other three, run on this device. The answer shows as it comes and can be stopped; what was looked
 * up shows as steps; rooms and routes found are things to tap; a drafted task is added only when confirmed. A question
 * can be changed where it stands and an answer asked again: each grows a branch beside the old one (Thread.kt), and
 * one goes back and forth between them. The conversation is kept on this device. Asking is for someone signed in;
 * signing in opens over it and the question goes on.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun AiScreen(model: CampusModel, route: Route) {
    val context = LocalContext.current
    val client = remember { Accounts.get(context) }
    val scope = rememberCoroutineScope()
    val kept = remember { context.getSharedPreferences("ai_chat", android.content.Context.MODE_PRIVATE) }
    var draft by remember { mutableStateOf("") }
    var thread by remember { mutableStateOf(readThread(kept)) }
    var streaming by remember { mutableStateOf<String?>(null) }
    var live by remember { mutableStateOf<List<JsonObject>?>(null) }
    var proposals by remember { mutableStateOf<List<TaskProposal>>(emptyList()) }
    var saved by remember { mutableStateOf<Set<String>>(emptySet()) }
    var error by remember { mutableStateOf("") }
    var job by remember { mutableStateOf<Job?>(null) }
    var editing by remember { mutableStateOf<String?>(null) }
    // While answering after a message, only what this answer says shows after it, not the answer it had before.
    var from by remember { mutableStateOf<String?>(null) }
    val fresh = remember { mutableSetOf<String>() }
    val busy = job != null
    val tools = remember { CampusTools(context, { model.state.value.repository }, { model.myLine(model.state.value, model.settings.state.value) }, model.tasks) { proposal -> proposals = proposals + proposal } }
    DisposableEffect(tools) { onDispose { tools.close() } }
    LaunchedEffect(thread) { kept.edit().putString("thread", thread.toJson().toString()).remove("messages").apply() }
    var waiting by remember { mutableStateOf<String?>(null) }
    val scroll = rememberScrollState()
    LaunchedEffect(thread.nodes.size, streaming) { scroll.animateScrollTo(scroll.maxValue) }

    /** Answering after [at] in [base]: each message said grows the branch from there, and is the one shown. */
    suspend fun run(base: ChatThread, at: String) {
        var tipId = at
        fun grow(message: JsonObject) { val id = java.util.UUID.randomUUID().toString(); fresh += id; thread = thread.append(tipId, id, message); tipId = id }
        thread = base; fresh.clear(); from = at; editing = null
        var history = recent(base.lineage(at).map { it.message })
        if (tools.definitions.isEmpty()) tools.definitions = client.request("/ai", authenticated = true).getValue("tools").jsonArray.map { it.jsonObject }
        var said = ""
        try {
            repeat(8) {
                said = ""; streaming = ""; live = null
                var answer: JsonObject? = null
                var failed: String? = null
                val doc = top.hicancan.docstream.Stream()
                try { client.stream("/ai", buildJsonObject { put("messages", JsonArray(history)) }) { event, data ->
                    when (event) {
                        "delta" -> { val piece = data["content"]?.jsonPrimitive?.contentOrNull.orEmpty(); said += piece; streaming = said; live = top.hicancan.studev.world.Docs.blocksOf(doc.push(piece)) }
                        "message" -> answer = data["message"]?.jsonObject
                        "error" -> failed = data["message"]?.jsonPrimitive?.contentOrNull
                    }
                } } finally { doc.close() }
                streaming = null; live = null
                failed?.let { throw IllegalStateException(it) }
                val reply = answer ?: throw IllegalStateException("回答中断了，请重试。")
                history = history + reply; grow(reply)
                val calls = reply["tool_calls"]?.jsonArray.orEmpty()
                if (calls.isEmpty()) return
                for (item in calls) {
                    val call = item.jsonObject; val function = call.getValue("function").jsonObject
                    val result = try { withContext(Dispatchers.IO) { tools.execute(function.getValue("name").jsonPrimitive.content, Json.parseToJsonElement(function.getValue("arguments").jsonPrimitive.content).jsonObject, call.getValue("id").jsonPrimitive.content) } }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { buildJsonObject { put("error", if (e is IllegalArgumentException || e is IllegalStateException) e.message ?: "工具执行失败。" else "校园数据暂不可读，请重试。") } }
                    val message = buildJsonObject { put("role", "tool"); put("tool_call_id", call.getValue("id")); put("content", result.toString()) }
                    history = history + message; grow(message)
                }
            }
            error = "这一问查了很多轮，换个更具体的问法试试。"
        } catch (e: CancellationException) {
            // Stopped: what was said so far stays, as an answer cut short.
            if (said.isNotEmpty()) grow(buildJsonObject { put("role", "assistant"); put("content", said) })
            throw e
        } finally { streaming = null; live = null }
    }
    fun start(base: ChatThread, at: String) {
        error = ""
        job = scope.launch {
            try { run(base, at) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = if (e is PlatformFailure || e is IllegalStateException) e.message.orEmpty() else "AI 暂不可用，请稍后重试。" }
            finally { job = null; from = null }
        }
    }
    /** A question asked after [parent] (the end of the conversation, or before a question being changed). */
    fun ask(question: String, parent: String = thread.tip()) {
        if (question.isBlank() || busy) return
        scope.launch {
            if (client.current() == null) { waiting = question; return@launch }
            if (parent == thread.tip()) draft = ""
            val id = java.util.UUID.randomUUID().toString()
            start(thread.append(parent, id, buildJsonObject { put("role", "user"); put("content", question.trim()) }), id)
        }
    }
    /** The answer to a question asked again, beside the answer it had. */
    fun again(question: String) { if (!busy) start(thread, question) }
    fun pick(id: String) { if (!busy) { thread = thread.choose(id); error = "" } }
    waiting?.let { question ->
        BackHandler { waiting = null }
        top.hicancan.studev.account.AccountScreen(client, onBack = { waiting = null }, onSignedIn = { waiting = null; ask(question) })
        return
    }
    var shown = thread.path()
    from?.let { at -> val cut = shown.indexOfFirst { it.id == at }; if (cut >= 0 && cut + 1 < shown.size && shown[cut + 1].id !in fresh) shown = shown.take(cut + 1) }
    val results = shown.map { it.message }.filter { it["role"]?.jsonPrimitive?.content == "tool" }.associate { it.getValue("tool_call_id").jsonPrimitive.content to runCatching { Json.parseToJsonElement(it.getValue("content").jsonPrimitive.content) }.getOrNull() }
    // One turn: a question, and everything that answered it, however many rounds of looking up it took.
    val turns = mutableListOf<Pair<ChatNode, MutableList<ChatNode>>>()
    shown.forEach { node -> if (node.message["role"]?.jsonPrimitive?.content == "user") turns += node to mutableListOf() else turns.lastOrNull()?.second?.add(node) }
    val composer: @Composable () -> Unit = { Composer(draft, { draft = it.take(4000) }, onSend = { ask(draft) }, onStop = { job?.cancel() }, busy = busy) }
    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
        if (shown.isEmpty()) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
                Plain("有什么可以帮你？", 26.sp, weight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally))
                composer()
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    EXAMPLES.forEach { example -> Box(Modifier.clip(RoundedCornerShape(18.dp)).border(1.dp, Ink.line, RoundedCornerShape(18.dp)).clickable { ask(example) }.padding(horizontal = 14.dp, vertical = 9.dp)) { Plain(example, 13.5.sp, Ink.muted) } }
                }
                Plain("问课表、地图和校园资料：查安排、找时间、找空教室、问路；起草的任务经你确认才保存。对话只存在这台设备上，问的内容会发给模型（腾讯云 EdgeOne 提供的 DeepSeek）。", 12.sp, Ink.faint, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp), lineHeight = 18.sp)
            }
            return@Column
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { thread = ChatThread(); proposals = emptyList(); saved = emptySet(); error = ""; editing = null }, enabled = !busy, colors = ButtonDefaults.textButtonColors(contentColor = Ink.muted)) {
                Icon(Icons.Outlined.EditNote, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("新对话", fontSize = 13.5.sp)
            }
        }
        Column(Modifier.weight(1f).verticalScroll(scroll).padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            turns.forEachIndexed { at, (question, replyNodes) ->
                val last = at == turns.lastIndex
                val answering = last && busy
                val replies = replyNodes.map { it.message }
                val text = question.message["content"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (editing == question.id) Editing(text, onCancel = { editing = null }, onSend = { ask(it, question.parent) })
                else Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                    Box(Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(22.dp)).background(Ink.brand.copy(alpha = .10f).compositeOver(Ink.paper)).padding(horizontal = 16.dp, vertical = 10.dp)) { Plain(text, 16.sp, lineHeight = 26.sp) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CopyIcon(text)
                        IconAction(Icons.Outlined.Edit, "改问题", enabled = !busy) { editing = question.id }
                        Branches(thread, question.id, !busy, ::pick)
                    }
                }
                val calls = replies.flatMap { it["tool_calls"]?.jsonArray.orEmpty() }.map { it.jsonObject }
                if (calls.isNotEmpty()) {
                    var open by remember(question.id) { mutableStateOf(false) }
                    val doing = calls.any { results[it.getValue("id").jsonPrimitive.content] == null }
                    val counts = calls.groupingBy { it.getValue("function").jsonObject.getValue("name").jsonPrimitive.content }.eachCount()
                    Plain((if (doing) "正在" else "已") + counts.entries.joinToString(" · ") { (name, count) -> (STEPS[name] ?: name) + if (count > 1) " ×$count" else "" } + if (open) "  ⌃" else "  ›", 13.5.sp, Ink.muted, modifier = Modifier.clickable { open = !open })
                    if (open) Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        replies.filter { it["role"]?.jsonPrimitive?.content == "assistant" }.forEach { reply ->
                            if (reply["tool_calls"] != null) reply["content"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { Plain(it, 13.sp) }
                            reply["tool_calls"]?.jsonArray?.forEach { item ->
                                val call = item.jsonObject; val name = call.getValue("function").jsonObject.getValue("name").jsonPrimitive.content
                                val result = results[call.getValue("id").jsonPrimitive.content]
                                val failed = (result as? JsonObject)?.get("error")?.jsonPrimitive?.contentOrNull
                                Plain((STEPS[name] ?: name) + (if (result == null) "……" else failed?.let { "：$it" }.orEmpty()), 13.sp, if (failed != null) marks().danger else Ink.muted)
                            }
                        }
                    }
                }
                val answer = replies.lastOrNull { it["role"]?.jsonPrimitive?.content == "assistant" && it["tool_calls"] == null && !it["content"]?.jsonPrimitive?.contentOrNull.isNullOrEmpty() }?.get("content")?.jsonPrimitive?.contentOrNull
                answer?.let { top.hicancan.studev.world.DocText(it, onLink = { href -> openInApp(href, route) }) }
                if (last) live?.let { top.hicancan.studev.world.Doc(it, live = true, onLink = { href -> openInApp(href, route) }) } ?: run { if (last) streaming?.let { Plain("$it ●", 16.sp, lineHeight = 26.sp) } }
                if (answering && streaming == null && calls.none { results[it.getValue("id").jsonPrimitive.content] == null }) Thinking()
                calls.mapNotNull { call -> val name = call.getValue("function").jsonObject.getValue("name").jsonPrimitive.content; results[call.getValue("id").jsonPrimitive.content]?.takeIf { (it as? JsonObject)?.containsKey("error") != true }?.let { name to it } }
                    .associate { it }.forEach { (name, result) -> Found(name, result, route) }
                val drafts = proposals.filter { proposal -> calls.any { it.getValue("id").jsonPrimitive.content == proposal.call } }
                if (drafts.isNotEmpty()) Drafts(drafts, saved, onAdd = { keys ->
                    keys.forEach { key ->
                        val proposal = proposals.first { it.key == key }; val task = proposal.task
                        val current = proposal.id?.let { id -> model.tasks.all.value.find { it.id == id && it.deleted != true } }
                        if (proposal.id != null && current?.modified != proposal.expected) error = "这个任务已经改过了，请让 AI 重新起草。"
                        else { model.tasks.save(task.copy(id = proposal.id ?: model.tasks.newId(), done = if (task.done == "awaiting-confirmation") top.hicancan.studev.world.Tasks.stamp(java.time.Instant.now()) else task.done)); saved = saved + key }
                    }
                }, onDrop = { key -> proposals = proposals.filter { it.key != key } })
                if (!answering && replyNodes.isNotEmpty()) Row(Modifier.offset(x = (-8).dp), verticalAlignment = Alignment.CenterVertically) {
                    answer?.let { CopyIcon(it) }
                    IconAction(Icons.Outlined.Refresh, "重新回答", enabled = !busy) { again(question.id) }
                    Branches(thread, replyNodes.first().id, !busy, ::pick)
                }
            }
            if (error.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Plain(error, 14.sp, marks().danger, modifier = Modifier.weight(1f))
                turns.lastOrNull()?.let { (question, _) -> top.hicancan.studev.app.Chip("重试", { again(question.id) }) }
            }
            Spacer(Modifier.height(8.dp))
        }
        Box(Modifier.padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 12.dp)) { composer() }
    }
}

/** The conversation kept on this device; one kept before it could branch becomes one branch. */
private fun readThread(kept: android.content.SharedPreferences): ChatThread = runCatching {
    kept.getString("thread", null)?.let { ChatThread.of(Json.parseToJsonElement(it).jsonObject) }
        ?: kept.getString("messages", null)?.let { old -> Json.parseToJsonElement(old).jsonArray.map { it.jsonObject }.let { ChatThread.chain(it, it.map { java.util.UUID.randomUUID().toString() }) } }
}.getOrNull() ?: ChatThread()

/** At most this many messages go to the model, whole turns kept: a tool result never stays without its call. */
private fun recent(history: List<JsonObject>): List<JsonObject> {
    var out = history
    while (out.size > 24) { val next = out.indexOfFirst { it !== out.first() && it["role"]?.jsonPrimitive?.content == "user" }; if (next < 0) break; out = out.drop(next) }
    return out
}

@Composable private fun IconAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean = true, onClick: () -> Unit) =
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(36.dp)) { Icon(icon, label, Modifier.size(18.dp), tint = if (enabled) Ink.muted else Ink.faint) }

@Composable private fun CopyIcon(text: String) {
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    var done by remember { mutableStateOf(false) }
    LaunchedEffect(done) { if (done) { kotlinx.coroutines.delay(1500); done = false } }
    IconAction(if (done) Icons.Outlined.Check else Icons.Outlined.ContentCopy, if (done) "已复制" else "复制") { clipboard.setText(androidx.compose.ui.text.AnnotatedString(text)); done = true }
}

/** ‹ 2/3 ›: the branches beside one, to go back and forth. */
@Composable private fun Branches(thread: ChatThread, id: String, enabled: Boolean, onChoose: (String) -> Unit) {
    val at = thread.siblings(id)
    if (at.count < 2) return
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconAction(Icons.Outlined.ChevronLeft, "上一个版本", enabled && at.previous != null) { at.previous?.let(onChoose) }
        Plain("${at.index + 1}/${at.count}", 13.sp, Ink.muted)
        IconAction(Icons.Outlined.ChevronRight, "下一个版本", enabled && at.next != null) { at.next?.let(onChoose) }
    }
}

/** The box one writes in: round and lifted, one round button that sends, or stops while answering. */
@Composable private fun Composer(value: String, onChange: (String) -> Unit, onSend: () -> Unit, onStop: () -> Unit, busy: Boolean) {
    val shape = RoundedCornerShape(28.dp)
    Row(Modifier.fillMaxWidth().shadow(8.dp, shape, ambientColor = Color.Black.copy(alpha = .08f), spotColor = Color.Black.copy(alpha = .08f)).clip(shape).background(Ink.paper).border(1.dp, Ink.line.copy(alpha = .6f), shape)
        .padding(start = 18.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val ink = Ink.text
        androidx.compose.foundation.text.BasicTextField(value, onChange, Modifier.weight(1f).heightIn(max = 160.dp).padding(vertical = 8.dp), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 16.sp, lineHeight = 24.sp, color = ink),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(ink), decorationBox = { inner -> if (value.isEmpty()) Plain("问点什么", 16.sp, Ink.faint); inner() })
        val enabled = busy || value.isNotBlank()
        Box(Modifier.size(38.dp).clip(CircleShape).background(if (enabled) ink else ink.copy(alpha = .18f)).clickable(enabled = enabled) { if (busy) onStop() else onSend() }, contentAlignment = Alignment.Center) {
            Icon(if (busy) Icons.Filled.Stop else Icons.Filled.ArrowUpward, if (busy) "停止" else "发送", Modifier.size(20.dp), tint = Ink.paper)
        }
    }
}

/** A question one has asked, changed where it stands. */
@Composable private fun Editing(text: String, onCancel: () -> Unit, onSend: (String) -> Unit) {
    var value by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(text, androidx.compose.ui.text.TextRange(text.length))) }
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    BackHandler { onCancel() }
    Column(Modifier.fillMaxWidth().padding(start = 40.dp).clip(RoundedCornerShape(22.dp)).background(Ink.sunken).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val ink = Ink.text
        androidx.compose.foundation.text.BasicTextField(value, { value = it.copy(text = it.text.take(4000)) }, Modifier.fillMaxWidth().heightIn(min = 48.dp, max = 240.dp).focusRequester(focus), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 16.sp, lineHeight = 26.sp, color = ink), cursorBrush = androidx.compose.ui.graphics.SolidColor(ink))
        Row(Modifier.align(Alignment.End), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onCancel, shape = RoundedCornerShape(18.dp)) { Text("取消", color = ink) }
            Button(onClick = { onSend(value.text.trim()) }, enabled = value.text.isNotBlank(), shape = RoundedCornerShape(18.dp), colors = ButtonDefaults.buttonColors(containerColor = ink, contentColor = Ink.paper)) { Text("发送") }
        }
    }
}

/** “正在想”, a light passing over it, as the web's shimmer. */
@Composable private fun Thinking() {
    val shift by rememberInfiniteTransition(label = "think").animateFloat(0f, 1f, infiniteRepeatable(tween(1600, easing = LinearEasing)), label = "shine")
    val muted = Ink.muted; val ink = Ink.text
    Text("正在想", fontSize = 15.sp, style = androidx.compose.ui.text.TextStyle(brush = androidx.compose.ui.graphics.Brush.linearGradient(listOf(muted, ink, muted), start = androidx.compose.ui.geometry.Offset(-200f + 400f * shift, 0f), end = androidx.compose.ui.geometry.Offset(400f * shift, 0f))))
}

/** What a tool found, as things to tap, as Found in AiApp.tsx: rooms on the map, a route to follow. */
@Composable private fun Found(name: String, result: JsonElement, route: Route) {
    val value = result as? JsonObject ?: return
    @Composable fun Card(title: String, note: String, onClick: () -> Unit) = Column(Modifier.clip(RoundedCornerShape(12.dp)).border(1.dp, Ink.line, RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp)) {
        Plain(title, 14.sp, weight = FontWeight.SemiBold); Plain(note, 12.sp, Ink.muted)
    }
    @OptIn(ExperimentalLayoutApi::class)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when (name) {
            "free_rooms" -> value["rooms"]?.jsonArray?.take(6)?.forEach { item ->
                val room = item.jsonObject; val id = room.getValue("room").jsonPrimitive.content; val minutes = room.getValue("minutes").jsonPrimitive.int
                Card(Names.room(id), "空到 ${hm(room.getValue("until").jsonPrimitive.int)} · ${minutes / 60} 小时 ${minutes % 60} 分") { route.map(place = id) }
            }
            "route" -> value["url"]?.jsonPrimitive?.contentOrNull?.let { url ->
                val target = android.net.Uri.parse(url).getQueryParameter("nav")
                val first = value["routes"]?.jsonArray?.firstOrNull()?.jsonObject
                Card("在地图上导航", first?.let { "${it.getValue("distance_m").jsonPrimitive.double.toInt()} 米 · 约 ${maxOf(1, (it.getValue("duration_s").jsonPrimitive.double / 60).toInt())} 分钟" }.orEmpty()) { target?.let { route.map(nav = it) } }
            }
        }
    }
}

/** The tasks drafted, in one card, as Drafts in AiApp.tsx: each to tick, then added together. */
@Composable private fun Drafts(drafts: List<TaskProposal>, saved: Set<String>, onAdd: (List<String>) -> Unit, onDrop: (String) -> Unit) {
    val open = drafts.filter { it.key !in saved }
    var picked by remember(drafts.size) { mutableStateOf(open.map { it.key }.toSet()) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).border(1.dp, Ink.line, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 12.dp)) {
        Plain(if (open.isNotEmpty()) "起草了 ${drafts.size} 个任务" else "已加到清单 · ${drafts.size} 个任务", 13.sp, Ink.muted, FontWeight.SemiBold)
        drafts.forEach { draft ->
            val done = draft.key in saved
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp).clickable(enabled = !done) { picked = if (draft.key in picked) picked - draft.key else picked + draft.key }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Checkbox(checked = done || draft.key in picked, onCheckedChange = if (done) null else { on -> picked = if (on) picked + draft.key else picked - draft.key })
                Column(Modifier.weight(1f)) {
                    Plain((if (draft.id != null) "改成 · " else "") + draft.task.title, 15.sp, if (done) Ink.muted else Ink.text)
                    Plain(listOfNotNull(draft.task.date?.let { "$it ${draft.task.start?.let(::hm).orEmpty()}${draft.task.end?.let { end -> "–${hm(end)}" }.orEmpty()}" }, draft.task.due?.let { "${it.date} ${it.time?.let(::hm).orEmpty()} 截止" }).joinToString(" · "), 12.5.sp, Ink.muted)
                }
                if (!done) Plain("×", 16.sp, Ink.faint, modifier = Modifier.clickable { onDrop(draft.key) }.padding(6.dp))
            }
        }
        val chosen = open.filter { it.key in picked }
        if (open.isNotEmpty()) Button(onClick = { onAdd(chosen.map { it.key }) }, enabled = chosen.isNotEmpty(), modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Text(if (chosen.size == open.size) "全部加到清单" else "加 ${chosen.size} 个到清单") }
    }
}

/** A link inside the site, opened where it points in the app: a place or a route on the map, or the timetable. */
private fun openInApp(href: String, route: Route) {
    val uri = android.net.Uri.parse("https://studev$href")
    when {
        uri.path?.startsWith("/map") == true -> uri.getQueryParameter("nav")?.let { route.map(nav = it) } ?: route.map(place = uri.getQueryParameter("place"))
        else -> route.tab = "timetable"
    }
}
