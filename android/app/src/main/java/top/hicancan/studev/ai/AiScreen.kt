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

/** What one can ask, offered while the conversation is empty, as AI_EXAMPLES in src/campus/ai/AiApp.tsx. */
private val EXAMPLES = listOf("这周有哪些截止和考试？", "今天下午哪里有空教室？", "帮我在下周找三次一小时复习，周五前完成", "从教三到图书馆怎么走？")
/** What each tool is doing, as a step says it, as STEPS in AiApp.tsx. */
private val STEPS = mapOf("campus_search" to "搜索校园资料", "timeline" to "查看你的安排", "list_tasks" to "读取你的任务", "suggest_slots" to "找空闲时间", "free_rooms" to "查空教室", "route" to "规划路线", "propose_task" to "起草任务")

/**
 * The fourth entry beside the timetable, the map and search, as src/campus/ai/AiApp.tsx: one conversation over the
 * same tools as the other three, run on this device. The answer shows as it comes and can be stopped; what was looked
 * up shows as steps; rooms and routes found are things to tap; a drafted task is added only when confirmed. The
 * conversation is kept on this device. Asking is for someone signed in; signing in opens over it and the question goes on.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun AiScreen(model: CampusModel, route: Route) {
    val context = LocalContext.current
    val client = remember { Accounts.get(context) }
    val scope = rememberCoroutineScope()
    val kept = remember { context.getSharedPreferences("ai_chat", android.content.Context.MODE_PRIVATE) }
    var draft by remember { mutableStateOf("") }
    var messages by remember { mutableStateOf(runCatching { Json.parseToJsonElement(kept.getString("messages", "[]")!!).jsonArray.map { it.jsonObject } }.getOrDefault(emptyList())) }
    var streaming by remember { mutableStateOf<String?>(null) }
    var proposals by remember { mutableStateOf<List<TaskProposal>>(emptyList()) }
    var saved by remember { mutableStateOf<Set<String>>(emptySet()) }
    var error by remember { mutableStateOf("") }
    var job by remember { mutableStateOf<Job?>(null) }
    val busy = job != null
    val tools = remember { CampusTools(context, { model.state.value.repository }, { model.myLine(model.state.value, model.settings.state.value) }, model.tasks) { proposal -> proposals = proposals + proposal } }
    DisposableEffect(tools) { onDispose { tools.close() } }
    LaunchedEffect(messages) { kept.edit().putString("messages", JsonArray(messages).toString()).apply() }
    var waiting by remember { mutableStateOf<String?>(null) }
    val scroll = rememberScrollState()
    LaunchedEffect(messages.size, streaming) { scroll.animateScrollTo(scroll.maxValue) }

    suspend fun run(start: List<JsonObject>) {
        var history = start
        // Whole turns are kept: a tool result never stays without the call that made it.
        while (history.size > 24) { val next = history.indexOfFirst { it !== history.first() && it["role"]?.jsonPrimitive?.content == "user" }; if (next < 0) break; history = history.drop(next) }
        messages = history
        if (tools.definitions.isEmpty()) tools.definitions = client.request("/ai", authenticated = true).getValue("tools").jsonArray.map { it.jsonObject }
        var said = ""
        try {
            repeat(8) {
                said = ""; streaming = ""
                var answer: JsonObject? = null
                var failed: String? = null
                client.stream("/ai", buildJsonObject { put("messages", JsonArray(history)) }) { event, data ->
                    when (event) {
                        "delta" -> { said += data["content"]?.jsonPrimitive?.contentOrNull.orEmpty(); streaming = said }
                        "message" -> answer = data["message"]?.jsonObject
                        "error" -> failed = data["message"]?.jsonPrimitive?.contentOrNull
                    }
                }
                streaming = null
                failed?.let { throw IllegalStateException(it) }
                val reply = answer ?: throw IllegalStateException("回答中断了，请重试。")
                history = history + reply; messages = history
                val calls = reply["tool_calls"]?.jsonArray.orEmpty()
                if (calls.isEmpty()) return
                for (item in calls) {
                    val call = item.jsonObject; val function = call.getValue("function").jsonObject
                    val result = try { withContext(Dispatchers.IO) { tools.execute(function.getValue("name").jsonPrimitive.content, Json.parseToJsonElement(function.getValue("arguments").jsonPrimitive.content).jsonObject) } }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { buildJsonObject { put("error", if (e is IllegalArgumentException || e is IllegalStateException) e.message ?: "工具执行失败。" else "校园数据暂不可读，请重试。") } }
                    history = history + buildJsonObject { put("role", "tool"); put("tool_call_id", call.getValue("id")); put("content", result.toString()) }
                }
                messages = history
            }
            error = "这一问查了很多轮，换个更具体的问法试试。"
        } catch (e: CancellationException) {
            // Stopped: what was said so far stays, as an answer cut short.
            if (said.isNotEmpty()) messages = history + buildJsonObject { put("role", "assistant"); put("content", said) }
            throw e
        } finally { streaming = null }
    }
    fun start(history: List<JsonObject>) {
        error = ""
        job = scope.launch {
            try { run(history) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = if (e is PlatformFailure || e is IllegalStateException) e.message.orEmpty() else "AI 暂不可用，请稍后重试。" }
            finally { job = null }
        }
    }
    fun ask(question: String) {
        if (question.isBlank() || busy) return
        scope.launch {
            if (client.current() == null) { waiting = question; return@launch }
            draft = ""
            start(messages + buildJsonObject { put("role", "user"); put("content", question.trim()) })
        }
    }
    val lastUser = messages.indexOfLast { it["role"]?.jsonPrimitive?.content == "user" }
    waiting?.let { question ->
        BackHandler { waiting = null }
        top.hicancan.studev.account.AccountScreen(client, onBack = { waiting = null }, onSignedIn = { waiting = null; ask(question) })
        return
    }
    val results = messages.filter { it["role"]?.jsonPrimitive?.content == "tool" }.associate { it.getValue("tool_call_id").jsonPrimitive.content to runCatching { Json.parseToJsonElement(it.getValue("content").jsonPrimitive.content) }.getOrNull() }
    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("AI", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f))
            if (messages.isNotEmpty() && !busy) top.hicancan.studev.app.Chip("新对话", { messages = emptyList(); proposals = emptyList(); saved = emptySet(); error = "" })
        }
        Column(Modifier.weight(1f).verticalScroll(scroll).padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (messages.isEmpty()) {
                Plain("问课表、地图和校园资料：查安排、找时间、找空教室、问路，起草的任务经你确认才保存。对话只存在这台设备上，问的内容会发给模型（腾讯云 EdgeOne 提供的 DeepSeek）。", 13.sp, Ink.muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    EXAMPLES.forEach { example -> Box(Modifier.clip(RoundedCornerShape(18.dp)).border(1.dp, Ink.line, RoundedCornerShape(18.dp)).clickable { ask(example) }.padding(horizontal = 14.dp, vertical = 10.dp)) { Plain(example, 14.sp) } }
                }
            }
            // One turn: a question, and everything that answered it, however many rounds of looking up it took.
            val turns = mutableListOf<Pair<String, MutableList<JsonObject>>>()
            messages.forEach { message ->
                when (message["role"]?.jsonPrimitive?.content) {
                    "user" -> turns += (message["content"]?.jsonPrimitive?.contentOrNull.orEmpty() to mutableListOf())
                    "assistant" -> turns.lastOrNull()?.second?.add(message)
                }
            }
            turns.forEachIndexed { at, (question, replies) ->
                val last = at == turns.lastIndex
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                    Box(Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp)).background(Ink.sunken).padding(horizontal = 14.dp, vertical = 10.dp)) { Plain(question, 15.5.sp) }
                }
                val calls = replies.flatMap { it["tool_calls"]?.jsonArray.orEmpty() }.map { it.jsonObject }
                if (calls.isNotEmpty()) {
                    var open by remember(at) { mutableStateOf(false) }
                    val doing = calls.any { results[it.getValue("id").jsonPrimitive.content] == null }
                    val counts = calls.groupingBy { it.getValue("function").jsonObject.getValue("name").jsonPrimitive.content }.eachCount()
                    Plain((if (doing) "● 正在" else "● 已") + counts.entries.joinToString(" · ") { (name, count) -> (STEPS[name] ?: name) + if (count > 1) " ×$count" else "" } + if (open) "  ⌃" else "  ›", 13.sp, Ink.muted, modifier = Modifier.clickable { open = !open })
                    if (open) Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        replies.forEach { reply ->
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
                val answer = replies.lastOrNull { it["tool_calls"] == null && !it["content"]?.jsonPrimitive?.contentOrNull.isNullOrEmpty() }?.get("content")?.jsonPrimitive?.contentOrNull
                answer?.let { Plain(it, 15.5.sp, lineHeight = 26.sp) }
                if (last) streaming?.let { Plain("$it▍", 15.5.sp, lineHeight = 26.sp) }
                calls.mapNotNull { call -> val name = call.getValue("function").jsonObject.getValue("name").jsonPrimitive.content; results[call.getValue("id").jsonPrimitive.content]?.takeIf { (it as? JsonObject)?.containsKey("error") != true }?.let { name to it } }
                    .associate { it }.forEach { (name, result) -> Found(name, result, route) }
            }
            if (busy && streaming == null) Plain("正在想……", 14.sp, Ink.muted)
            if (proposals.isNotEmpty()) Drafts(proposals, saved, onAdd = { keys ->
                keys.forEach { key ->
                    val proposal = proposals.first { it.key == key }; val task = proposal.task
                    val current = proposal.id?.let { id -> model.tasks.all.value.find { it.id == id && it.deleted != true } }
                    if (proposal.id != null && current?.modified != proposal.expected) error = "这个任务已经改过了，请让 AI 重新起草。"
                    else { model.tasks.save(task.copy(id = proposal.id ?: model.tasks.newId(), done = if (task.done == "awaiting-confirmation") top.hicancan.studev.world.Tasks.stamp(java.time.Instant.now()) else task.done)); saved = saved + key }
                }
            }, onDrop = { key -> proposals = proposals.filter { it.key != key } })
            if (error.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
                Plain(error, 14.sp, marks().danger, modifier = Modifier.weight(1f))
                if (lastUser >= 0) top.hicancan.studev.app.Chip("重试", { start(messages.take(lastUser + 1)) })
            }
            if (!busy && lastUser >= 0 && error.isEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                top.hicancan.studev.app.Chip("重新回答", { start(messages.take(lastUser + 1)) })
                top.hicancan.studev.app.Chip("改问题", { draft = messages[lastUser]["content"]?.jsonPrimitive?.contentOrNull.orEmpty(); messages = messages.take(lastUser) })
            }
            Spacer(Modifier.height(8.dp))
        }
        Row(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(22.dp)).border(1.dp, Ink.line, RoundedCornerShape(22.dp)).padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val ink = Ink.text
            androidx.compose.foundation.text.BasicTextField(draft, { draft = it.take(4000) }, Modifier.weight(1f).heightIn(max = 160.dp).padding(vertical = 8.dp), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 15.5.sp, color = ink),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(ink), decorationBox = { inner -> if (draft.isEmpty()) Plain("问点什么", 15.5.sp, Ink.faint); inner() })
            if (busy) OutlinedButton(onClick = { job?.cancel() }) { Text("停止") }
            else Button(onClick = { ask(draft) }, enabled = draft.isNotBlank()) { Text("发送") }
        }
    }
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
