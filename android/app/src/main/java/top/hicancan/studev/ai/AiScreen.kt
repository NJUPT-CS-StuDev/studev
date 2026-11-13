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
            if (messages.isNotEmpty() && !busy) TextButton(onClick = { messages = emptyList(); proposals = emptyList(); saved = emptySet(); error = "" }) { Text("新对话") }
        }
        Column(Modifier.weight(1f).verticalScroll(scroll).padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (messages.isEmpty()) {
                Plain("问课表、地图和校园资料：查安排、找时间、找空教室、问路，起草的任务经你确认才保存。对话只存在这台设备上，问的内容会发给模型（腾讯云 EdgeOne 提供的 DeepSeek）。", 13.sp, Ink.muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    EXAMPLES.forEach { example -> Box(Modifier.clip(RoundedCornerShape(18.dp)).border(1.dp, Ink.line, RoundedCornerShape(18.dp)).clickable { ask(example) }.padding(horizontal = 14.dp, vertical = 10.dp)) { Plain(example, 14.sp) } }
                }
            }
            messages.forEach { message ->
                when (message["role"]?.jsonPrimitive?.content) {
                    "user" -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                        Box(Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp)).background(Ink.sunken).padding(horizontal = 14.dp, vertical = 10.dp)) { Plain(message["content"]?.jsonPrimitive?.contentOrNull.orEmpty(), 15.5.sp) }
                    }
                    "assistant" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        message["content"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { Plain(it, 15.5.sp, lineHeight = 26.sp) }
                        message["tool_calls"]?.jsonArray?.forEach { item ->
                            val call = item.jsonObject; val name = call.getValue("function").jsonObject.getValue("name").jsonPrimitive.content
                            val result = results[call.getValue("id").jsonPrimitive.content]
                            val failed = (result as? JsonObject)?.containsKey("error") == true
                            Plain((if (result == null) "… " else if (failed) "! " else "✓ ") + (STEPS[name] ?: name) + (if (result == null) "……" else if (failed) " · 没查到" else ""), 13.sp, if (failed) marks().danger else Ink.muted)
                            if (result != null && !failed) Found(name, result, route)
                        }
                    }
                }
            }
            streaming?.let { Plain("$it▍", 15.5.sp, lineHeight = 26.sp) }
            if (busy && streaming == null) Plain("正在查……", 13.sp, Ink.muted)
            proposals.forEach { proposal -> Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, Ink.brand, RoundedCornerShape(12.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val task = proposal.task
                Plain((if (proposal.id == null) "新任务 · " else "改成 · ") + task.title, 15.sp, weight = FontWeight.SemiBold)
                task.date?.let { Plain("$it ${task.start?.let(::hm).orEmpty()}${task.end?.let { end -> "–${hm(end)}" }.orEmpty()}", 13.sp, Ink.muted) }
                task.due?.let { Plain("${it.date} ${it.time?.let(::hm).orEmpty()} 截止", 13.sp, Ink.muted) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = proposal.key !in saved, onClick = {
                        val current = proposal.id?.let { id -> model.tasks.all.value.find { it.id == id && it.deleted != true } }
                        if (proposal.id != null && current?.modified != proposal.expected) error = "这个任务已经改过了，请让 AI 重新起草。"
                        else { model.tasks.save(task.copy(id = proposal.id ?: model.tasks.newId(), done = if (task.done == "awaiting-confirmation") top.hicancan.studev.world.Tasks.stamp(java.time.Instant.now()) else task.done)); saved = saved + proposal.key }
                    }) { Text(if (proposal.key in saved) "已加到清单" else "加到清单") }
                    if (proposal.key !in saved) TextButton(onClick = { proposals = proposals.filter { it.key != proposal.key } }) { Text("不要") }
                }
            } }
            if (error.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
                Plain(error, 14.sp, marks().danger, modifier = Modifier.weight(1f))
                if (lastUser >= 0) TextButton(onClick = { start(messages.take(lastUser + 1)) }) { Text("重试") }
            }
            if (!busy && lastUser >= 0 && error.isEmpty()) Row {
                TextButton(onClick = { start(messages.take(lastUser + 1)) }) { Text("重新回答") }
                TextButton(onClick = { draft = messages[lastUser]["content"]?.jsonPrimitive?.contentOrNull.orEmpty(); messages = messages.take(lastUser) }) { Text("改问题") }
            }
            Spacer(Modifier.height(8.dp))
        }
        Row(Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(20.dp)).border(1.dp, Ink.line, RoundedCornerShape(20.dp)).padding(6.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            top.hicancan.studev.timetable.Field(draft, "问点什么", Modifier.weight(1f), single = false) { draft = it.take(4000) }
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
