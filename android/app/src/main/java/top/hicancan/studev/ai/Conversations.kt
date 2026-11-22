package top.hicancan.studev.ai

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.studev.account.Accounts
import top.hicancan.studev.account.AccountClient
import top.hicancan.studev.account.PlatformFailure
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.world.CampusTools
import top.hicancan.studev.world.TaskProposal
import java.util.UUID

/** Conversations and their requests live for the campus model's lifetime, independently of the visible screen. */
internal class Conversations(private val context: Context, private val model: CampusModel, private val scope: CoroutineScope,
    val client: AccountClient = Accounts.get(context)) {
    private val kept = context.getSharedPreferences("ai_chat", Context.MODE_PRIVATE)
    val modelPrefs = ModelPreferences.get(context)
    val toolPrefs = CampusToolPreferences.store(context)
    val remotePrefs = RemoteMcpPreferences.store(context)
    private val initial = readChats(kept, ModelPreferences.read(modelPrefs).preferred)
    val assistant = Assistant.load(context)
    var chats by mutableStateOf(initial.chats)
        private set
    var projects by mutableStateOf(initial.projects)
        private set
    var current by mutableStateOf(initial.current ?: UUID.randomUUID().toString())
        private set
    var activeProject by mutableStateOf(initial.currentProject)
        private set
    private val views = mutableStateMapOf<String, Conversation>()
    val running get() = views.filterValues { it.job != null }.keys
    fun view(id: String) = views.getOrPut(id) {
        Conversation(chats.firstOrNull { it.id == id }?.selection ?: ModelPreferences.read(modelPrefs).forNewChat())
    }

    internal class Conversation(initial: ModelSelection) {
        var draft by mutableStateOf("")
        var selection by mutableStateOf(initial)
        var job by mutableStateOf<Job?>(null)
        var from by mutableStateOf<String?>(null)
        var fresh by mutableStateOf(emptySet<String>())
        var streaming by mutableStateOf<String?>(null)
        var live by mutableStateOf<List<JsonObject>?>(null)
        var error by mutableStateOf("")
        var proposals by mutableStateOf<List<TaskProposal>>(emptyList())
        var saved by mutableStateOf<Set<String>>(emptySet())
    }

    fun open(id: String?, projectId: String?) {
        val old = current
        val found = chats.firstOrNull { it.id == id }
        current = found?.id ?: UUID.randomUUID().toString()
        activeProject = if (found == null) projectId else found.projectId
        if (old != current && chats.none { it.id == old } && views[old]?.job == null) views.remove(old)
        persist()
    }

    fun replaceChats(next: List<SavedChat>, projectId: String? = activeProject) {
        chats = next
        activeProject = projectId
        persist()
    }
    fun replaceProjects(next: List<ChatProject>) { projects = next; persist() }

    private fun persist() {
        kept.edit().putString("chats", KeptChats(chats, current, projects, activeProject).toJson().toString())
            .remove("thread").remove("messages").apply()
    }

    fun recordThread(id: String, projectId: String?, selection: ModelSelection, next: ChatThread) {
        val before = chats.firstOrNull { it.id == id }
        val updated = System.currentTimeMillis()
        val saved = before?.copy(updated = updated, thread = next)
            ?: SavedChat(id, "", updated, next, selection, projectId)
        replaceChats(listOf(saved) + chats.filter { it.id != id })
    }

    fun forget(id: String) {
        if (views[id]?.job != null) return
        replaceChats(chats.filter { it.id != id })
        views.remove(id)
    }

    fun start(id: String, projectId: String?, base: ChatThread, at: String, view: Conversation, selection: ModelSelection = view.selection): Boolean {
        if (view.job != null) return false
        val mine = ModelPreferences.read(modelPrefs).direct(selection)
        if (selection.provider != null && mine == null) {
            view.error = "当前模型已停用或移除，请重新选择。"
            return false
        }
        view.error = ""
        view.fresh = emptySet()
        view.from = at
        view.job = scope.launch(start = CoroutineStart.LAZY) {
            try { run(id, projectId, selection, view, base, at, mine) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { view.error = if (e is PlatformFailure || e is IllegalStateException) e.message.orEmpty() else "AI 暂不可用，请稍后重试。" }
            finally { view.job = null; view.from = null }
        }
        view.job?.start()
        return true
    }

    /** Answering after [at] in [base]: each message said grows the branch from there, and is the one shown. */
    private suspend fun run(chat: String, projectId: String?, selection: ModelSelection, view: Conversation, base: ChatThread, at: String, mine: Own?) {
        var tipId = at
        var thread = base
        fun grow(message: JsonObject) {
            val id = java.util.UUID.randomUUID().toString()
            thread = thread.append(tipId, id, message); tipId = id; view.fresh += id
            recordThread(chat, projectId, selection, thread)
        }
        recordThread(chat, projectId, selection, base)
        val remote = RemoteMcp.active(RemoteMcpPreferences.read(remotePrefs)).associateBy { it.id }
        var history = recent(RemoteMcp.history(base.lineage(at).map { it.message }, remote.keys))
        val settings = model.settings.state.value
        val week = model.state.value.term?.let { top.hicancan.studev.world.CampusDay.weekOf(it.weeks, top.hicancan.studev.world.CampusDay.now().toLocalDate())?.week ?: 0 }
        val project = projects.firstOrNull { it.id == projectId }
        val instructionText = Instructions.forChat(project)
        val remembered = settings.memory.takeIf { it.on }?.let { project?.memory ?: it.text }
        val situation = Situation(week, settings.klass, settings.campus, remembered, instructionText)
        val campus = assistant.toolsFor(situation, CampusToolPreferences.disabled(toolPrefs))
        val names = campus.map(::toolName).toSet()
        val external = remote.values.map { it.definition() }
        val offered = names + remote.keys
        val available = campus + external
        val tools = CampusTools(context, { model.state.value.repository }, { model.myLine(model.state.value, model.settings.state.value) }, model.tasks,
            remember = { fact ->
                check(model.settings.state.value.memory.on) { "记忆已关闭。" }
                if (projectId == null) model.settings.update { it.copy(memory = it.memory.copy(text = Memory.remembered(it.memory.text, fact))) }
                else replaceProjects(projects.map { if (it.id == projectId) it.copy(memory = Memory.remembered(it.memory, fact)) else it })
            }) { proposal -> view.proposals += proposal }
        tools.definitions = campus
        var said = ""
        try {
            repeat(Assistant.ROUNDS) { round ->
                val last = round == Assistant.ROUNDS - 1
                said = ""; view.streaming = ""; view.live = null
                var answer: JsonObject? = null
                var failed: String? = null
                val doc = top.hicancan.docstream.DocStream()
                fun onDelta(piece: String) { said += piece; view.streaming = said; view.live = top.hicancan.studev.world.Docs.blocksOf(doc.push(piece)) }
                try {
                    if (mine != null) answer = assistant.askOwn(mine, history, situation, last, available, onDelta = ::onDelta)
                    else client.stream("/ai", buildJsonObject {
                        put("messages", JsonArray(history)); put("last", last); put("situation", situation.toJson())
                        put("toolNames", JsonArray(offered.map(::JsonPrimitive)))
                        if (external.isNotEmpty()) put("externalTools", JsonArray(external))
                    }) { event, data ->
                        when (event) {
                            "delta" -> onDelta(data["content"]?.jsonPrimitive?.contentOrNull.orEmpty())
                            "message" -> answer = data["message"]?.jsonObject
                            "error" -> failed = data["message"]?.jsonPrimitive?.contentOrNull
                        }
                    }
                } finally { doc.close() }
                view.streaming = null; view.live = null
                failed?.let { throw IllegalStateException(it) }
                val reply = answer ?: throw IllegalStateException("回答中断了，请重试。")
                history = history + reply; grow(reply)
                val calls = reply["tool_calls"]?.jsonArray.orEmpty()
                if (calls.isEmpty()) return
                for (item in calls) {
                    currentCoroutineContext().ensureActive()
                    val call = item.jsonObject; val function = call.getValue("function").jsonObject
                    val result = try {
                        val name = function.getValue("name").jsonPrimitive.content
                        val args = Json.parseToJsonElement(function.getValue("arguments").jsonPrimitive.content).jsonObject
                        val callId = call.getValue("id").jsonPrimitive.content
                        val callTarget = remote[name]
                        if (callTarget != null) {
                            check(callTarget in RemoteMcp.active(RemoteMcpPreferences.read(remotePrefs))) { "这个远程工具已停用。" }
                            RemoteMcp.call(callTarget, args)
                        } else {
                            check(name in names && name !in CampusToolPreferences.disabled(toolPrefs)) { "这个工具已停用或不在本轮授权中。" }
                            // Keep updates to memory and draft tasks on the model dispatcher. Index tools stay on IO.
                            if (name == "remember" || name == "propose_task") tools.execute(name, args, callId)
                            else withContext(Dispatchers.IO) { tools.execute(name, args, callId) }
                        }
                    }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { buildJsonObject { put("error", if (e is IllegalArgumentException || e is IllegalStateException) e.message ?: "工具执行失败。" else "校园数据暂不可读，请重试。"); if (e is top.hicancan.studev.world.UnknownReference) put("code", "unknown-reference") } }
                    val message = buildJsonObject { put("role", "tool"); put("tool_call_id", call.getValue("id")); put("content", result.toString()) }
                    history = history + message; grow(message)
                }
            }
        } catch (e: CancellationException) {
            // Stopped: what was said so far stays, as an answer cut short.
            if (said.isNotEmpty()) grow(buildJsonObject { put("role", "assistant"); put("content", said) })
            throw e
        } finally { tools.close(); view.streaming = null; view.live = null }
    }
}

/** The conversations kept on this device, and the one open; one kept before there could be many becomes the first. */
private fun readChats(kept: android.content.SharedPreferences, imported: ModelSelection): KeptChats = runCatching {
    kept.getString("chats", null)?.let { text -> KeptChats.of(Json.parseToJsonElement(text).jsonObject, imported) }
        ?: (kept.getString("thread", null)?.let { ChatThread.of(Json.parseToJsonElement(it).jsonObject) }
            ?: kept.getString("messages", null)?.let { old -> Json.parseToJsonElement(old).jsonArray.map { it.jsonObject }.let { ChatThread.chain(it, it.map { java.util.UUID.randomUUID().toString() }) } })
            ?.takeIf { it.nodes.isNotEmpty() }?.let { thread -> val id = java.util.UUID.randomUUID().toString(); KeptChats(listOf(SavedChat(id, "", System.currentTimeMillis(), thread, imported)), id) }
}.getOrNull() ?: KeptChats()

/** At most this many messages go to the model, whole turns kept: a tool result never stays without its call. */
private fun recent(history: List<JsonObject>): List<JsonObject> {
    var out = history
    while (out.size > 24) { val next = out.indexOfFirst { it !== out.first() && it["role"]?.jsonPrimitive?.content == "user" }; if (next < 0) break; out = out.drop(next) }
    return out
}
