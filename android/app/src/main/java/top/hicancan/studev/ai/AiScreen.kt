package top.hicancan.studev.ai

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.studev.account.Accounts
import top.hicancan.studev.account.PlatformFailure
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.world.CampusTools
import top.hicancan.studev.world.TaskProposal
import top.hicancan.studev.world.hm

/** What one can ask, offered while the conversation is empty, as AI_EXAMPLES in src/campus/ai/AiApp.tsx. */
private val EXAMPLES = listOf("这周有哪些截止和考试？", "今天下午哪里有空教室？", "帮我在下周找三次一小时复习，周五前完成", "从教三到图书馆怎么走？")

/**
 * The fourth entry beside the timetable, the map and search: a conversation that uses the same tools as the other
 * three, run on this device; the model is reached through the platform, so asking is for someone signed in. Signing
 * in opens over it and the question goes on by itself.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable fun AiScreen(model: CampusModel) {
    val context = LocalContext.current
    val client = remember { Accounts.get(context) }
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf("") }
    var messages by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var proposals by remember { mutableStateOf<List<TaskProposal>>(emptyList()) }
    var saved by remember { mutableStateOf<Set<String>>(emptySet()) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val tools = remember { CampusTools(context, { model.state.value.repository }, { model.myLine(model.state.value, model.settings.state.value) }, model.tasks) { proposal -> proposals = proposals + proposal } }
    DisposableEffect(tools) { onDispose { tools.close() } }
    var waiting by remember { mutableStateOf<String?>(null) }
    suspend fun send(question: String) {
        var history = messages + buildJsonObject { put("role", "user"); put("content", question) }
        while (history.size > 16) { val next = history.indexOfFirst { it !== history.first() && it["role"]?.jsonPrimitive?.content == "user" }; if (next < 0) break; history = history.drop(next) }
        messages = history
        val schema = client.request("/ai", authenticated = true)
        tools.definitions = schema.getValue("tools").jsonArray.map { it.jsonObject }
        repeat(8) {
            val answer = client.request("/ai", buildJsonObject { put("messages", JsonArray(history)) }, authenticated = true).getValue("message").jsonObject
            history = history + answer; messages = history
            val calls = answer["tool_calls"]?.jsonArray.orEmpty()
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
        error("本次查询多轮，请缩小问题范围后继续。")
    }
    fun ask(question: String) {
        busy = true; error = ""
        scope.launch {
            try {
                if (client.current() == null) { waiting = question; return@launch }
                draft = ""
                send(question)
            } catch (e: CancellationException) { throw e } catch (e: Exception) { error = if (e is PlatformFailure) e.message.orEmpty() else "AI 暂不可用，请稍后重试。" } finally { busy = false }
        }
    }
    waiting?.let { question ->
        BackHandler { waiting = null }
        top.hicancan.studev.account.AccountScreen(client, onBack = { waiting = null }, onSignedIn = { waiting = null; ask(question) })
        return
    }
    run {
        Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("AI", style = MaterialTheme.typography.headlineMedium)
            Text("问课表、地图和校园资料：查安排、找时间、找空教室、问路，起草的任务经你确认才保存。对话和查到的内容会发给模型（腾讯云 EdgeOne 提供的 DeepSeek），对话只留在这一页。", style = MaterialTheme.typography.bodySmall)
            if (messages.isEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                EXAMPLES.forEach { example -> SuggestionChip(onClick = { ask(example) }, label = { Text(example) }, enabled = !busy) }
            }
            messages.filter { it["role"]?.jsonPrimitive?.content != "tool" }.forEach { message ->
                OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (message.getValue("role").jsonPrimitive.content == "user") "你" else "AI", style = MaterialTheme.typography.labelMedium)
                    message["content"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { Text(it) }
                    message["tool_calls"]?.jsonArray?.forEach { call -> Text("正在查询 · ${call.jsonObject.getValue("function").jsonObject.getValue("name").jsonPrimitive.content}", style = MaterialTheme.typography.bodySmall) }
                } }
            }
            proposals.forEach { proposal -> OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val task = proposal.task
                Text((if (proposal.id == null) "新任务草案 · " else "修改任务草案 · ") + task.title, style = MaterialTheme.typography.titleMedium)
                task.date?.let { Text("执行 $it ${task.start?.let(::hm).orEmpty()}${task.end?.let { end -> "–${hm(end)}" }.orEmpty()}") }
                task.due?.let { Text("截止 ${it.date} ${it.time?.let(::hm) ?: "当天结束"}") }
                task.note?.let { Text(it) }
                Button(enabled = proposal.key !in saved && !busy, onClick = {
                    val current = proposal.id?.let { id -> model.tasks.all.value.find { it.id == id && it.deleted != true } }
                    if (proposal.id != null && current?.modified != proposal.expected) error = "任务已经改变，请重新生成草案。"
                    else { model.tasks.save(task.copy(id = proposal.id ?: model.tasks.newId(), done = if (task.done == "awaiting-confirmation") top.hicancan.studev.world.Tasks.stamp(java.time.Instant.now()) else task.done)); saved = saved + proposal.key }
                }) { Text(if (proposal.key in saved) "已保存到本机" else "确认保存") }
                if (proposal.key !in saved) TextButton(onClick = { proposals = proposals.filter { it.key != proposal.key } }, enabled = !busy) { Text("放弃") }
            } } }
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
            OutlinedTextField(draft, { draft = it.take(4000) }, Modifier.fillMaxWidth(), label = { Text("问点什么") }, placeholder = { Text("帮我在下周找三次一小时复习") }, minLines = 2, enabled = !busy)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(enabled = !busy && draft.isNotBlank(), onClick = { ask(draft.trim()) }) { Text(if (busy) "正在查询…" else "发送") }
                TextButton(onClick = { messages = emptyList(); proposals = emptyList(); saved = emptySet(); error = "" }, enabled = !busy) { Text("新对话") }
            }
        }
    }
}
