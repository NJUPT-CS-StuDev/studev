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

/**
 * The fourth entry beside the timetable, the map and search, as src/campus/ai/AiApp.tsx: one conversation over the
 * same tools as the other three, run on this device. The answer shows as it comes and can be stopped; what was looked
 * up shows as steps; rooms and routes found are things to tap; a drafted task is added only when confirmed. A question
 * can be changed where it stands and an answer asked again: each grows a branch beside the old one (Thread.kt), and
 * one goes back and forth between them. Conversations are kept on this device and listed in a drawer (Chats.kt). The
 * model is the free quota, or one's own key used straight from this device with no sign-in (Assistant.kt).
 * Asking is for someone signed in;
 * signing in opens over it and the question goes on.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun AiScreen(model: CampusModel, route: Route) {
    val context = LocalContext.current
    val client = remember { Accounts.get(context) }
    val scope = rememberCoroutineScope()
    val kept = remember { context.getSharedPreferences("ai_chat", android.content.Context.MODE_PRIVATE) }
    var draft by remember { mutableStateOf("") }
    val start = remember { readChats(kept) }
    var chats by remember { mutableStateOf(start.first) }
    var current by remember { mutableStateOf(start.second) }
    var thread by remember { mutableStateOf(chats.firstOrNull { it.id == current }?.thread ?: ChatThread()) }
    // Opening a conversation shows it as it was; only what is said in it moves it to the top of the list.
    var opening by remember { mutableStateOf(true) }
    var renaming by remember { mutableStateOf<SavedChat?>(null) }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val assistant = remember { Assistant.load(context) }
    val modelPrefs = remember { context.getSharedPreferences("ai_model", android.content.Context.MODE_PRIVATE) }
    var useOwn by remember { mutableStateOf(Models.read(modelPrefs).first) }
    var own by remember { mutableStateOf(Models.read(modelPrefs).second) }
    var picking by remember { mutableStateOf(false) }
    var setting by remember { mutableStateOf(false) }
    val memoryPrefs = remember { context.getSharedPreferences("ai_memory", android.content.Context.MODE_PRIVATE) }
    var memory by remember { mutableStateOf(Memory.read(memoryPrefs)) }
    var minding by remember { mutableStateOf(false) }
    LaunchedEffect(memory) { Memory.write(memoryPrefs, memory) }
    val asking = own.takeIf { useOwn && it.key.isNotBlank() }
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
    val tools = remember { CampusTools(context, { model.state.value.repository }, { model.myLine(model.state.value, model.settings.state.value) }, model.tasks,
        remember = { fact -> check(memory.on) { "记忆已关闭。" }; memory = memory.copy(text = Memory.remembered(memory.text, fact)) }) { proposal -> proposals = proposals + proposal } }
    DisposableEffect(tools) { onDispose { tools.close() } }
    LaunchedEffect(thread) {
        if (opening) { opening = false; return@LaunchedEffect }
        if (thread.nodes.isEmpty()) return@LaunchedEffect
        val id = current ?: java.util.UUID.randomUUID().toString()
        val before = chats.firstOrNull { it.id == id }
        chats = listOf(SavedChat(id, before?.title.orEmpty(), System.currentTimeMillis(), thread)) + chats.filter { it.id != id }
        current = id
    }
    LaunchedEffect(chats, current) { kept.edit().putString("chats", buildJsonObject { put("chats", JsonArray(chats.map { it.toJson() })); current?.let { put("current", it) } }.toString()).remove("thread").remove("messages").apply() }
    var waiting by remember { mutableStateOf<String?>(null) }
    val scroll = rememberScrollState()
    LaunchedEffect(thread.nodes.size, streaming) { scroll.animateScrollTo(scroll.maxValue) }

    /** Answering after [at] in [base]: each message said grows the branch from there, and is the one shown. */
    suspend fun run(base: ChatThread, at: String) {
        var tipId = at
        fun grow(message: JsonObject) { val id = java.util.UUID.randomUUID().toString(); fresh += id; thread = thread.append(tipId, id, message); tipId = id }
        thread = base; fresh.clear(); from = at; editing = null
        var history = recent(base.lineage(at).map { it.message })
        // The moment and who is asking, as this device knows them now.
        val settings = model.settings.state.value; val line = model.myLine(model.state.value, settings); val user = client.current()
        val situation = Situation(line?.weekOf(top.hicancan.studev.world.CampusDay.now().toLocalDate()), settings.klass, settings.campus,
            user?.let { it.realName.ifBlank { it.nickname }.ifBlank { null } }, user?.studentId?.ifBlank { null }, memory.takeIf { it.on }?.text)
        tools.definitions = assistant.toolsFor(situation)
        var said = ""
        try {
            repeat(Assistant.ROUNDS) { round ->
                val last = round == Assistant.ROUNDS - 1
                said = ""; streaming = ""; live = null
                var answer: JsonObject? = null
                var failed: String? = null
                val doc = top.hicancan.docstream.DocStream()
                fun onDelta(piece: String) { said += piece; streaming = said; live = top.hicancan.studev.world.Docs.blocksOf(doc.push(piece)) }
                try {
                    val mine = asking
                    if (mine != null) answer = assistant.askOwn(mine, history, situation, last, ::onDelta)
                    else client.stream("/ai", buildJsonObject { put("messages", JsonArray(history)); put("last", last); put("situation", situation.toJson()) }) { event, data ->
                        when (event) {
                            "delta" -> onDelta(data["content"]?.jsonPrimitive?.contentOrNull.orEmpty())
                            "message" -> answer = data["message"]?.jsonObject
                            "error" -> failed = data["message"]?.jsonPrimitive?.contentOrNull
                        }
                    }
                } finally { doc.close() }
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
            // One's own key needs no sign-in; the free quota is shared, so it is asked when signed in.
            if (asking == null && client.current() == null) { waiting = question; return@launch }
            if (parent == thread.tip()) draft = ""
            val id = java.util.UUID.randomUUID().toString()
            start(thread.append(parent, id, buildJsonObject { put("role", "user"); put("content", question.trim()) }), id)
        }
    }
    /** The answer to a question asked again, beside the answer it had. */
    fun again(question: String) { if (!busy) start(thread, question) }
    fun pick(id: String) { if (!busy) { thread = thread.choose(id); error = "" } }
    fun open(id: String?) {
        if (busy) return
        opening = true
        thread = chats.firstOrNull { it.id == id }?.thread ?: ChatThread()
        current = chats.firstOrNull { it.id == id }?.id
        proposals = emptyList(); saved = emptySet(); error = ""; editing = null
        scope.launch { drawer.close() }
    }
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
    if (minding) MemorySettings(memory, onClose = { minding = false }) { next -> memory = next; minding = false }
    if (setting) OwnSettings(own, onClose = { setting = false }) { next -> own = next; useOwn = next.key.isNotBlank(); Models.write(modelPrefs, useOwn, next); setting = false }
    renaming?.let { chat ->
        var name by remember(chat.id) { mutableStateOf(Chats.titleOf(chat.title, chat.thread)) }
        AlertDialog(onDismissRequest = { renaming = null }, title = { Text("重命名") },
            text = { OutlinedTextField(name, { name = it.take(60) }, singleLine = true) },
            confirmButton = { TextButton({ chats = chats.map { if (it.id == chat.id) it.copy(title = name.trim()) else it }; renaming = null }) { Text("好") } },
            dismissButton = { TextButton({ renaming = null }) { Text("取消") } })
    }
    ModalNavigationDrawer(drawerState = drawer, drawerContent = {
        ModalDrawerSheet(Modifier.width(300.dp), drawerContainerColor = Ink.paper) {
            Column(Modifier.fillMaxHeight().statusBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp)) {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(enabled = !busy) { open(null) }.padding(horizontal = 10.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.EditNote, null, Modifier.size(20.dp), tint = Ink.text); Spacer(Modifier.width(10.dp)); Plain("新对话", 15.sp, weight = FontWeight.Medium)
                }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                    Chats.groups(chats, System.currentTimeMillis()).forEach { (name, list) ->
                        Plain(name, 12.sp, Ink.faint, modifier = Modifier.padding(start = 10.dp, top = 14.dp, bottom = 4.dp))
                        list.forEach { chat ->
                            var more by remember(chat.id) { mutableStateOf(false) }
                            val on = chat.id == current
                            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (on) Ink.text.copy(alpha = .08f) else Color.Transparent).clickable(enabled = !busy || on) { open(chat.id) }.padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Plain(Chats.titleOf(chat.title, chat.thread), 14.5.sp, maxLines = 1, modifier = Modifier.weight(1f).padding(vertical = 10.dp))
                                Box {
                                    IconAction(Icons.Outlined.MoreHoriz, "更多") { more = true }
                                    DropdownMenu(more, { more = false }, containerColor = Ink.paper) {
                                        DropdownMenuItem({ Text("重命名") }, { more = false; renaming = chat })
                                        DropdownMenuItem({ Text("删除", color = marks().danger) }, { more = false; chats = chats.filter { it.id != chat.id }; if (current == chat.id) { opening = true; current = null; thread = ChatThread() } }, enabled = !(busy && on))
                                    }
                                }
                            }
                        }
                    }
                    if (chats.isEmpty()) Plain("问过的对话会列在这里，只存在这台设备上。", 13.sp, Ink.faint, modifier = Modifier.padding(10.dp))
                }
                HorizontalDivider(color = Ink.line)
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { minding = true; scope.launch { drawer.close() } }.padding(horizontal = 10.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Plain("记忆", 15.sp, weight = FontWeight.Medium, modifier = Modifier.weight(1f))
                    Plain(if (!memory.on) "已关闭" else memory.text.lines().count { it.isNotBlank() }.let { if (it > 0) "记着 $it 件事" else "还没有" }, 13.sp, Ink.muted)
                }
            }
        }
    }) {
    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconAction(Icons.Outlined.Menu, "对话列表") { scope.launch { drawer.open() } }
            Box {
                Row(Modifier.clip(RoundedCornerShape(10.dp)).clickable { picking = true }.padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Plain(asking?.let(Models::name) ?: "免费额度", 15.sp, weight = FontWeight.SemiBold, maxLines = 1)
                    Icon(Icons.Outlined.KeyboardArrowDown, null, Modifier.size(18.dp), tint = Ink.muted)
                }
                DropdownMenu(picking, { picking = false }, containerColor = Ink.paper) {
                    DropdownMenuItem({ Column { Text("免费额度 · 为爱发电"); Plain("登录后可用", 12.sp, Ink.muted) } }, { useOwn = false; Models.write(modelPrefs, false, own); picking = false },
                        trailingIcon = { if (asking == null) Icon(Icons.Outlined.Check, null, Modifier.size(18.dp)) })
                    DropdownMenuItem({ Column { Text("我的 API"); Plain(if (own.key.isNotBlank()) "${Models.name(own)} · 存在这台设备上" else "填上自己的 Key 就能用", 12.sp, Ink.muted) } },
                        { picking = false; if (own.key.isNotBlank()) { useOwn = true; Models.write(modelPrefs, true, own) } else setting = true },
                        trailingIcon = { if (asking != null) Icon(Icons.Outlined.Check, null, Modifier.size(18.dp)) })
                    HorizontalDivider(color = Ink.line)
                    DropdownMenuItem({ Text("设置我的 API…", color = Ink.muted) }, { picking = false; setting = true })
                }
            }
            Plain(if (shown.isEmpty()) "" else Chats.titleOf(chats.firstOrNull { it.id == current }?.title.orEmpty(), thread), 14.sp, Ink.muted, maxLines = 1, modifier = Modifier.weight(1f).padding(start = 2.dp))
            if (shown.isNotEmpty()) IconAction(Icons.Outlined.EditNote, "新对话", enabled = !busy) { open(null) }
        }
        if (shown.isEmpty()) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
                Plain("有什么可以帮你？", 26.sp, weight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally))
                composer()
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    EXAMPLES.forEach { example -> Box(Modifier.clip(RoundedCornerShape(18.dp)).border(1.dp, Ink.line, RoundedCornerShape(18.dp)).clickable { ask(example) }.padding(horizontal = 14.dp, vertical = 9.dp)) { Plain(example, 13.5.sp, Ink.muted) } }
                }
                Plain("可以问课表、地图和校园资料：查安排、找空闲、找空教室、问路、读通知。起草的任务你点一下才加进清单；对话和记忆存在这台设备上。", 12.sp, Ink.faint, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp), lineHeight = 18.sp)
            }
            return@Column
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
                    val steps = Steps.of(calls.map { call -> val function = call.getValue("function").jsonObject; Steps.Call(call.getValue("id").jsonPrimitive.content, function.getValue("name").jsonPrimitive.content, function.getValue("arguments").jsonPrimitive.content) },
                        results.filterValues { it != null }.mapValues { it.value!! })
                    Plain(Steps.line(steps) + if (open) "  ⌃" else "  ›", 13.5.sp, Ink.muted, modifier = Modifier.clickable { open = !open })
                    if (open) Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        steps.forEach { step ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Plain(step.label, 13.sp, if (step.failed) marks().danger else Ink.text, weight = FontWeight.Medium)
                                Plain(step.detail + if (step.pending) "……" else "", 13.sp, if (step.failed) marks().danger else Ink.muted, modifier = Modifier.weight(1f, fill = false))
                            }
                        }
                    }
                }
                val answer = replies.lastOrNull { it["role"]?.jsonPrimitive?.content == "assistant" && it["tool_calls"] == null && !it["content"]?.jsonPrimitive?.contentOrNull.isNullOrEmpty() }?.get("content")?.jsonPrimitive?.contentOrNull
                answer?.let { top.hicancan.studev.world.DocText(it, onLink = { href -> openInApp(href, route) }) }
                if (last) live?.let { top.hicancan.studev.world.Doc(it, live = true, onLink = { href -> openInApp(href, route) }) } ?: run { if (last) streaming?.let { Plain("$it ●", 16.sp, lineHeight = 26.sp) } }
                if (answering && streaming == null && calls.none { results[it.getValue("id").jsonPrimitive.content] == null }) Thinking()
                // What it found, to tap: every article it read, the last of anything else.
                calls.mapNotNull { call -> val id = call.getValue("id").jsonPrimitive.content; val name = call.getValue("function").jsonObject.getValue("name").jsonPrimitive.content
                    results[id]?.takeIf { (it as? JsonObject)?.containsKey("error") != true }?.let { (if (name == "read") id else name) to (name to it) } }
                    .toMap().values.forEach { (name, result) -> Found(name, result, route) }
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
}

/** One's own provider: where, which model, and the key, kept only on this device, as OwnSettings in AiApp.tsx. */
@Composable private fun OwnSettings(own: Own, onClose: () -> Unit, onSave: (Own) -> Unit) {
    var base by remember { mutableStateOf(own.base) }
    var model by remember { mutableStateOf(own.model) }
    var key by remember { mutableStateOf(own.key) }
    val invalid = Models.addressError(base)
    AlertDialog(onDismissRequest = onClose, containerColor = Ink.paper, title = { Text("我的 API") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Plain("填一个兼容 OpenAI 接口的模型服务，比如 DeepSeek。Key 存在这台手机上，提问从这里直接发给服务商。", 13.sp, Ink.muted, lineHeight = 20.sp)
            OutlinedTextField(base, { base = it }, label = { Text("接口地址") }, singleLine = true)
            if (invalid != null) Plain(invalid, 12.sp, marks().danger)
            OutlinedTextField(model, { model = it }, label = { Text("模型") }, singleLine = true)
            OutlinedTextField(key, { key = it }, label = { Text("API Key") }, singleLine = true, visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation())
        } },
        confirmButton = { TextButton({ onSave(Own(base.trim(), model.trim(), key.trim())) }, enabled = invalid == null && model.isNotBlank() && key.isNotBlank()) { Text("保存并使用") } },
        dismissButton = { Row { if (own.key.isNotBlank()) TextButton({ onSave(own.copy(key = "")) }) { Text("清除 Key", color = marks().danger) }; TextButton(onClose) { Text("取消") } } })
}

/** The conversations kept on this device, and the one open; one kept before there could be many becomes the first. */
private fun readChats(kept: android.content.SharedPreferences): Pair<List<SavedChat>, String?> = runCatching {
    kept.getString("chats", null)?.let { text -> Json.parseToJsonElement(text).jsonObject.let { json -> json.getValue("chats").jsonArray.map { SavedChat.of(it.jsonObject) } to json["current"]?.jsonPrimitive?.contentOrNull } }
        ?: (kept.getString("thread", null)?.let { ChatThread.of(Json.parseToJsonElement(it).jsonObject) }
            ?: kept.getString("messages", null)?.let { old -> Json.parseToJsonElement(old).jsonArray.map { it.jsonObject }.let { ChatThread.chain(it, it.map { java.util.UUID.randomUUID().toString() }) } })
            ?.takeIf { it.nodes.isNotEmpty() }?.let { thread -> val id = java.util.UUID.randomUUID().toString(); listOf(SavedChat(id, "", System.currentTimeMillis(), thread)) to id }
}.getOrNull() ?: (emptyList<SavedChat>() to null)

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
    if (name == "find_place") {
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            (result as? JsonArray)?.take(3)?.forEach { item ->
                val place = item.jsonObject
                Column(Modifier.clip(RoundedCornerShape(12.dp)).border(1.dp, Ink.line, RoundedCornerShape(12.dp)).clickable { route.map(place = place.getValue("id").jsonPrimitive.content) }.padding(horizontal = 12.dp, vertical = 10.dp)) {
                    Plain(place.getValue("name").jsonPrimitive.content, 14.sp, weight = FontWeight.SemiBold)
                    Plain(listOfNotNull(place["where"]?.jsonPrimitive?.contentOrNull, place["now"]?.jsonPrimitive?.contentOrNull).joinToString(" · "), 12.sp, Ink.muted)
                }
            }
        }
        return
    }
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
                Card("导航到${value["to"]?.jsonPrimitive?.contentOrNull.orEmpty()}", "${value.getValue("distance_m").jsonPrimitive.long} 米 · 约 ${maxOf(1L, kotlin.math.round(value.getValue("duration_s").jsonPrimitive.double / 60).toLong())} 分钟") { target?.let { route.map(nav = it) } }
            }
            "nearby" -> value["places"]?.jsonArray?.take(4)?.forEach { item ->
                val place = item.jsonObject
                Card(place.getValue("name").jsonPrimitive.content, listOfNotNull("${place.getValue("metres").jsonPrimitive.long} 米", place["now"]?.jsonPrimitive?.contentOrNull).joinToString(" · ")) { route.map(place = place.getValue("id").jsonPrimitive.content) }
            }
            "read" -> value["url"]?.jsonPrimitive?.contentOrNull?.let { url ->
                Card(value["title"]?.jsonPrimitive?.contentOrNull.orEmpty(), listOfNotNull(value["source"]?.jsonPrimitive?.contentOrNull, value["date"]?.jsonPrimitive?.contentOrNull).joinToString(" · ")) { openInApp(url, route) }
            }
        }
    }
}

/** What the AI keeps in mind, as MemorySettings in AiApp.tsx: to read, change, empty or turn off. */
@Composable private fun MemorySettings(memory: Memory, onClose: () -> Unit, onSave: (Memory) -> Unit) {
    var on by remember { mutableStateOf(memory.on) }
    // Shown as plain lines; kept as a list, one `- ` item a line, as the AI reads and writes it.
    var text by remember { mutableStateOf(memory.text.replace(Regex("(?m)^- "), "")) }
    val count = text.lines().count { it.isNotBlank() }
    AlertDialog(onDismissRequest = onClose, containerColor = Ink.paper,
        title = { Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) { Text("记忆"); Plain("AI 记下你的专业、习惯和偏好，回答会越来越贴合你。", 13.sp, Ink.muted, lineHeight = 19.sp, modifier = Modifier.padding(top = 4.dp)) }
            Switch(on, { on = it }, modifier = Modifier.padding(start = 12.dp))
        } },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (on) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Ink.text.copy(alpha = .05f))) {
                    androidx.compose.foundation.text.BasicTextField(text, { text = it.take(Memory.LIMIT) }, Modifier.fillMaxWidth().heightIn(min = 140.dp).padding(horizontal = 14.dp, vertical = 12.dp),
                        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 15.sp, lineHeight = 25.sp, color = Ink.text),
                        cursorBrush = androidx.compose.ui.graphics.SolidColor(Ink.brand),
                        decorationBox = { inner -> Box { if (text.isEmpty()) Plain("一行一件，比如：\n通信工程专业，在准备考研\n喜欢早上学习", 15.sp, Ink.faint, lineHeight = 25.sp); inner() } })
                    Plain(if (count > 0) "记着 $count 件事" else "聊天时说“记住……”，AI 也会写进来", 12.sp, Ink.muted, modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 10.dp))
                }
            } else {
                Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Ink.text.copy(alpha = .05f)).padding(16.dp)) {
                    Plain("记忆已关闭，AI 看不到这些内容，也不再记新的。" + if (count > 0) "记着的 $count 件事还在，打开就接着用。" else "", 13.5.sp, Ink.muted, lineHeight = 21.sp)
                }
            }
            Plain("只存在这台设备上，提问时随问题一起发给模型。", 12.sp, Ink.faint)
        } },
        confirmButton = { TextButton({ onSave(Memory(on, text.lines().map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n") { "- $it" })) }) { Text("保存") } },
        dismissButton = { Row { if (on && text.isNotEmpty()) TextButton({ text = "" }) { Text("全部清空", color = Ink.muted) }; TextButton(onClose) { Text("取消") } } })
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
