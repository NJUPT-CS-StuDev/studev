package top.hicancan.studev.ai

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import top.hicancan.studev.account.AccountPresence
import top.hicancan.studev.app.CampusModel
import top.hicancan.studev.app.CampusHeader
import top.hicancan.studev.app.CampusGlyph
import top.hicancan.studev.app.Chip
import top.hicancan.studev.app.Ink
import top.hicancan.studev.app.Plain
import top.hicancan.studev.app.PlainSheet
import top.hicancan.studev.app.Route
import top.hicancan.studev.app.marks
import top.hicancan.studev.app.topHairline
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

private data class CallInspection(val step: Steps.Step, val arguments: String, val result: String)

@Composable private fun CallData(label: String, body: String, tag: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Plain(label, 13.sp, Ink.muted, FontWeight.SemiBold)
        Text(body, Modifier.semantics { testTagsAsResourceId = true }.testTag(tag).fillMaxWidth()
            .clip(RoundedCornerShape(8.dp)).background(Ink.sunken).padding(10.dp),
            color = Ink.text, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 17.sp)
    }
}


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
@OptIn(ExperimentalLayoutApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable internal fun AiScreen(model: CampusModel, route: Route, conversations: Conversations = model.conversations) {
    val context = LocalContext.current
    val client = conversations.client
    val presence by client.presence.collectAsState()
    val account = presence.user
    LaunchedEffect(client) { client.current() }
    val scope = rememberCoroutineScope()
    val modelPrefs = conversations.modelPrefs
    val catalog by rememberModelCatalog(modelPrefs)
    val chats = conversations.chats
    val projects = conversations.projects
    val current = conversations.current
    val activeProject = conversations.activeProject
    val view = remember(current) { conversations.view(current) }
    val thread = chats.firstOrNull { it.id == current }?.thread ?: ChatThread()
    val busy = view.job != null
    val from = view.from
    val fresh = view.fresh
    val streaming = view.streaming
    val live = view.live
    var renaming by remember { mutableStateOf<SavedChat?>(null) }
    var moving by remember { mutableStateOf<Set<String>?>(null) }
    var configuringModels by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { Instructions.fold(context, model.settings.state.value.memory.text)?.let { text -> model.settings.update { it.copy(memory = it.memory.copy(text = text)) } } }
    var projectInstructions by remember { mutableStateOf<String?>(null) }
    var configuringTools by remember { mutableStateOf(false) }
    val toolPrefs = conversations.toolPrefs
    val remotePrefs = conversations.remotePrefs
    var configuredRemote by remember(remotePrefs) { mutableStateOf(RemoteMcpPreferences.read(remotePrefs)) }
    val remoteLabels = remember(configuredRemote) { RemoteMcp.known(configuredRemote).associate { it.id to it.label } }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val assistant = conversations.assistant
    val freeService = remember(assistant) { assistant.freeService }
    val preferences by model.settings.state.collectAsState()
    val academic by model.state.collectAsState()
    val openedProject = projects.firstOrNull { it.id == activeProject }
    val memory = openedProject?.let { preferences.memory.copy(text = it.memory) } ?: preferences.memory
    val courses = remember(academic.schedule) {
        academic.schedule?.meetings.orEmpty().mapNotNull { meeting ->
            meeting.course.code?.takeIf(String::isNotBlank)?.let { CourseProject(it, Names.course(meeting.course.name)) }
        }.distinctBy { it.code }.sortedBy { it.name }
    }
    var minding by remember { mutableStateOf(false) }
    var editing by remember(current) { mutableStateOf<String?>(null) }
    var inspectingCall by remember(current) { mutableStateOf<CallInspection?>(null) }
    var waiting by remember { mutableStateOf<String?>(null) }
    val scroll = key(current) { rememberScrollState() }
    var followsLatest by remember { mutableStateOf(true) }
    val tailRoom = with(LocalDensity.current) { 64.dp.roundToPx() }
    val tailInset = with(LocalDensity.current) { 12.dp.roundToPx() }
    var answerBottom by remember { mutableIntStateOf(0) }
    var viewportSize by remember { mutableIntStateOf(0) }
    var viewport by remember { mutableStateOf<LayoutCoordinates?>(null) }
    val answerTarget by remember(scroll, tailInset) {
        derivedStateOf { (answerBottom - viewportSize + tailInset).coerceIn(0, scroll.maxValue) }
    }
    val scrolling = remember(scroll, tailRoom) {
        object : NestedScrollConnection {
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput && consumed.y != 0f) followsLatest = kotlin.math.abs(answerTarget - scroll.value) <= tailRoom
                return Offset.Zero
            }
        }
    }
    LaunchedEffect(answerTarget, followsLatest) { if (followsLatest && viewportSize > 0) scroll.scrollTo(answerTarget) }
    val composeFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current

    /** Sign-in attaches the pending question to the conversation that requested it. */
    fun ask(question: String, parent: String = thread.tip(), signedIn: Boolean = false) {
        if (question.isBlank() || busy) return
        val selected = view.selection
        if (!signedIn && selected.provider == null && account == null) {
            if (presence != AccountPresence.Loading) waiting = question
            return
        }
        val id = java.util.UUID.randomUUID().toString()
        val fromTip = parent == thread.tip()
        if (conversations.start(current, activeProject, thread.append(parent, id, buildJsonObject {
            put("role", "user"); put("content", question.trim())
        }), id, view, selected)) {
            editing = null
            if (fromTip) { view.draft = ""; followsLatest = true }
        }
    }
    fun again(question: String) { if (!busy) { editing = null; followsLatest = true; conversations.start(current, activeProject, thread, question, view) } }
    fun pick(id: String) {
        if (!busy) { conversations.recordThread(current, activeProject, view.selection, thread.choose(id)); view.error = "" }
    }
    fun open(id: String?, projectId: String? = null) {
        followsLatest = true
        conversations.open(id, projectId)
        scope.launch { drawer.close() }
    }
    fun removeChat(chat: SavedChat) {
        if (chat.id in conversations.running) return
        conversations.forget(chat.id)
        if (current == chat.id) open(null, chat.projectId)
    }
    fun saveProject(project: ChatProject?, name: String, course: String?): ChatProject {
        if (course != null) projects.firstOrNull { it.course == course }?.let { return it }
        val next = project?.copy(name = name) ?: ChatProject(java.util.UUID.randomUUID().toString(), name, course)
        conversations.replaceProjects(if (project == null) listOf(next) + projects else projects.map { if (it.id == next.id) next else it })
        return next
    }
    waiting?.let { question ->
        BackHandler { waiting = null }
        top.hicancan.studev.account.AccountScreen(client, onBack = { waiting = null }, onSignedIn = { waiting = null; ask(question, signedIn = true) })
        return
    }
    var shown = thread.path()
    from?.let { at -> val cut = shown.indexOfFirst { it.id == at }; if (cut >= 0 && cut + 1 < shown.size && shown[cut + 1].id !in fresh) shown = shown.take(cut + 1) }
    val results = shown.map { it.message }.filter { it["role"]?.jsonPrimitive?.content == "tool" }.associate { it.getValue("tool_call_id").jsonPrimitive.content to runCatching { Json.parseToJsonElement(it.getValue("content").jsonPrimitive.content) }.getOrNull() }
    // One turn: a question, and everything that answered it, however many rounds of looking up it took.
    val turns = mutableListOf<Pair<ChatNode, MutableList<ChatNode>>>()
    shown.forEach { node -> if (node.message["role"]?.jsonPrimitive?.content == "user") turns += node to mutableListOf() else turns.lastOrNull()?.second?.add(node) }
    val composer: @Composable () -> Unit = {
        val unavailable = view.selection.provider != null && catalog.direct(view.selection) == null
        Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
            if (unavailable) Plain("当前模型已停用或移除，请重新选择。", 12.sp, marks().danger, modifier = Modifier.padding(horizontal = 8.dp))
            Composer(view.draft, { view.draft = it.take(4000) }, onSend = { ask(view.draft) }, onStop = { view.job?.cancel() },
                onTools = { keyboard?.hide(); configuringTools = true }, busy = busy, canSend = !unavailable && (view.selection.provider != null || presence != AccountPresence.Loading), focus = composeFocus) {
                ChatModelPicker(catalog, view.selection, freeService, enabled = true,
                    manage = { keyboard?.hide(); configuringModels = true }) { next ->
                    view.selection = next
                    conversations.replaceChats(conversations.chats.map { if (it.id == current) it.copy(selection = next) else it })
                    ModelPreferences.update(modelPrefs) { it.copy(preferred = next) }
                    if (!busy) view.error = ""
                }
            }
        }
    }
    if (minding) MemorySettings(memory, openedProject?.name, onClose = { minding = false }) { next ->
        val id = openedProject?.id
        if (id == null) model.settings.update { it.copy(memory = next) }
        else {
            conversations.replaceProjects(projects.map { if (it.id == id) it.copy(memory = next.text) else it })
            model.settings.update { it.copy(memory = it.memory.copy(on = next.on)) }
        }
        minding = false
    }
    if (configuringModels) ModelServicesSheet { configuringModels = false }
    if (configuringTools) CampusToolsSheet(toolPrefs, remotePrefs) {
        configuredRemote = RemoteMcpPreferences.read(remotePrefs)
        configuringTools = false
    }
    projects.firstOrNull { it.id == projectInstructions && it.course == null }?.let { project ->
        key(project.id) {
            InstructionSheet("项目指令", "只用于「${project.name}」里的对话。", project.instructions, Instructions.PROJECT_LIMIT,
                onClose = { projectInstructions = null }) { edited ->
                conversations.replaceProjects(projects.map { if (it.id == project.id) it.copy(instructions = edited) else it })
                projectInstructions = null
            }
        }
    }
    moving?.let { ids ->
        MoveChatsSheet(chats.filter { it.id in ids }, projects, onClose = { moving = null }) { target ->
            val movable = ids - conversations.running
            conversations.replaceChats(chats.map { if (it.id in movable) it.copy(projectId = target) else it }, if (current in movable) target else activeProject)
            moving = null
        }
    }
    inspectingCall?.let { call -> PlainSheet(call.step.label, { inspectingCall = null }) {
        androidx.compose.foundation.text.selection.SelectionContainer {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (call.step.detail.isNotEmpty()) Plain(call.step.detail, 14.sp, if (call.step.failed) marks().danger else Ink.muted)
                CallData("调用参数", call.arguments, "ai-call-arguments")
                CallData("调用结果", call.result, "ai-call-result")
            }
        }
    } }
    renaming?.let { chat ->
        var name by remember(chat.id) { mutableStateOf(Chats.titleOf(chat.title, chat.thread)) }
        AlertDialog(onDismissRequest = { renaming = null }, title = { Text("重命名") },
            text = { OutlinedTextField(name, { name = it.take(60) }, singleLine = true) },
            confirmButton = { TextButton({ conversations.replaceChats(chats.map { if (it.id == chat.id) it.copy(title = name.trim()) else it }); renaming = null }) { Text("好") } },
            dismissButton = { TextButton({ renaming = null }) { Text("取消") } })
    }
    ModalNavigationDrawer(drawerState = drawer, drawerContent = {
        ModalDrawerSheet(Modifier.width(300.dp), drawerContainerColor = Ink.paper) {
            ChatDrawer(chats, projects, courses, current, activeProject, conversations.running,
                openChat = { open(it) }, newChat = { open(null, it) },
                openProject = { id -> open(chats.filter { it.projectId == id }.maxByOrNull { it.updated }?.id, id) }, saveProject = ::saveProject,
                editInstructions = { project -> scope.launch { drawer.close(); projectInstructions = project.id } },
                rename = { renaming = it }, updateChat = { next -> conversations.replaceChats(chats.map { if (it.id == next.id) it.copy(pinned = next.pinned, archived = next.archived) else it }) },
                remove = ::removeChat, move = { ids -> scope.launch { drawer.close(); moving = ids } },
                mind = { scope.launch { drawer.close(); minding = true } })
        }
    }) {
    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
        CampusHeader(Modifier.padding(start = 6.dp, end = 14.dp)) {
            IconAction(Icons.Outlined.Menu, "对话列表") { scope.launch { drawer.open() } }
            val chat = chats.firstOrNull { it.id == current }
            Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                if (chat != null && openedProject != null) Plain(openedProject.name, 11.sp, Ink.muted, maxLines = 1)
                if (shown.isNotEmpty() && chat != null) Plain(Chats.titleOf(chat.title, chat.thread), 15.sp, weight = FontWeight.SemiBold, maxLines = 1)
            }
            if (shown.isNotEmpty()) IconAction(Icons.Outlined.EditNote, "新对话") { open(null, activeProject) }
        }
        if (shown.isEmpty()) {
            Column(Modifier.weight(1f).widthIn(max = 768.dp).fillMaxWidth().align(Alignment.CenterHorizontally).verticalScroll(rememberScrollState()).padding(start = 18.dp, end = 18.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
                Plain(openedProject?.name ?: "有什么可以帮你？", 26.sp, weight = FontWeight.SemiBold,
                    modifier = Modifier.fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).semantics { heading() })
                composer()
                if (openedProject == null && view.draft.isEmpty()) {
                    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        assistant.suggestions.forEach { item ->
                            val shape = RoundedCornerShape(20.dp)
                            Row(Modifier.heightIn(min = 38.dp).clip(shape).border(1.dp, Ink.line, shape)
                                .clickable { view.draft = item.prompt; composeFocus.requestFocus(); keyboard?.show() }
                                .padding(horizontal = 11.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                CampusGlyph(item.entry, 16.dp, Ink.muted)
                                Plain(item.label, 13.sp, Ink.muted)
                            }
                        }
                    }
                }
                if (view.error.isNotEmpty()) Plain(view.error, 13.sp, marks().danger)
            }
            return@Column
        }
        Box(Modifier.weight(1f).widthIn(max = 768.dp).fillMaxWidth().align(Alignment.CenterHorizontally)
            .onGloballyPositioned { viewport = it; viewportSize = it.size.height }) {
        Column(Modifier.fillMaxSize().nestedScroll(scrolling).verticalScroll(scroll).padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
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
                        results.filterValues { it != null }.mapValues { it.value!! }, remoteLabels)
                    Plain(Steps.line(steps) + if (open) "  ⌃" else "  ›", 13.5.sp, Ink.muted, modifier = Modifier.semantics { testTagsAsResourceId = true }.testTag("ai-steps:${question.id}").clickable { open = !open })
                    if (open) Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        steps.forEachIndexed { index, step ->
                            Row(Modifier.semantics { testTagsAsResourceId = true }.testTag("ai-call:${calls[index].getValue("id").jsonPrimitive.content}").clickable {
                                val call = calls[index]; val function = call.getValue("function").jsonObject
                                val arguments = function.getValue("arguments").jsonPrimitive.content
                                val result = results[call.getValue("id").jsonPrimitive.content]
                                val pretty = Json { prettyPrint = true }
                                fun shown(value: JsonElement) = pretty.encodeToString(JsonElement.serializer(), value)
                                val args = runCatching { shown(Json.parseToJsonElement(arguments)) }.getOrDefault(arguments)
                                inspectingCall = CallInspection(step, args, result?.let(::shown) ?: "正在等待结果…")
                            }, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
                if (last) {
                    if (view.error.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Plain(view.error, 14.sp, marks().danger, modifier = Modifier.weight(1f))
                        top.hicancan.studev.app.TextAction("重试", { if (!busy) conversations.start(current, activeProject, thread, question.id, view) }, refresh = true)
                    }
                    Spacer(Modifier.height(1.dp).onGloballyPositioned { end ->
                        viewport?.takeIf { it.isAttached }?.let { box ->
                            if (end.isAttached) answerBottom = kotlin.math.ceil(box.localPositionOf(end, Offset(0f, end.size.height.toFloat())).y).toInt() + scroll.value
                        }
                    })
                }
                if (!answering && replyNodes.isNotEmpty()) Row(Modifier.offset(x = (-8).dp), verticalAlignment = Alignment.CenterVertically) {
                    answer?.let { CopyIcon(it) }
                    IconAction(Icons.Outlined.Refresh, "重新回答", enabled = !busy) { again(question.id) }
                    Branches(thread, replyNodes.first().id, !busy, ::pick)
                }
                val links = if (answering) emptyList() else calls.mapNotNull { call -> val id = call.getValue("id").jsonPrimitive.content; val name = call.getValue("function").jsonObject.getValue("name").jsonPrimitive.content
                    results[id]?.takeIf { (it as? JsonObject)?.containsKey("error") != true }?.let { (if (name == "read") id else name) to (name to it) } }
                    .toMap().values.flatMap { (name, result) -> resourceLinks(name, result) }.distinctBy { it.href }
                if (links.isNotEmpty()) Resources(question.id, links, route)
                val drafts = view.proposals.filter { proposal -> calls.any { it.getValue("id").jsonPrimitive.content == proposal.call } }
                if (!answering && drafts.isNotEmpty()) Drafts(drafts, view.saved, onAdd = { keys ->
                    keys.forEach { key ->
                        val proposal = view.proposals.first { it.key == key }; val task = proposal.task
                        val current = proposal.id?.let { id -> model.tasks.all.value.find { it.id == id && it.deleted != true } }
                        if (proposal.id != null && current?.modified != proposal.expected) view.error = "这个任务已经改过了，请让 AI 重新起草。"
                        else { model.tasks.save(task.copy(id = proposal.id ?: model.tasks.newId(), done = if (task.done == "awaiting-confirmation") top.hicancan.studev.world.Tasks.stamp(java.time.Instant.now()) else task.done)); view.saved = view.saved + key }
                    }
                }, onDrop = { key -> view.proposals = view.proposals.filter { it.key != key } })
            }
            Spacer(Modifier.height(8.dp))
        }
            if (!followsLatest && kotlin.math.abs(answerTarget - scroll.value) > tailRoom) {
                Surface(Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp), shape = CircleShape, color = Ink.paper,
                    border = androidx.compose.foundation.BorderStroke(1.dp, Ink.line), shadowElevation = 2.dp) {
                    IconButton(onClick = { followsLatest = true }, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Outlined.ArrowDownward, "回到最新回答", Modifier.size(19.dp), tint = Ink.muted)
                    }
                }
            }
        }
        Box(Modifier.widthIn(max = 768.dp).fillMaxWidth().align(Alignment.CenterHorizontally)
            .padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 12.dp)) { composer() }
    }
    }
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

private data class OfferedService(val id: String?, val name: String, val models: List<OfferedModel>)

@Composable private fun ChatModelPicker(catalog: ModelCatalog, selected: ModelSelection, freeService: FreeService, enabled: Boolean,
    manage: () -> Unit, choose: (ModelSelection) -> Unit) {
    var opened by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val label = if (selected.provider == null) freeService.modelName else selected.model.orEmpty().ifBlank { "选择模型" }
    val gap = with(LocalDensity.current) { 8.dp.roundToPx() }
    val position = remember(gap) {
        object : PopupPositionProvider {
            override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
                val above = anchorBounds.top - gap
                val below = windowSize.height - anchorBounds.bottom - gap
                val x = if (layoutDirection == LayoutDirection.Ltr) anchorBounds.right - popupContentSize.width else anchorBounds.left
                val y = if (popupContentSize.height <= above || above >= below) anchorBounds.top - popupContentSize.height - gap else anchorBounds.bottom + gap
                return IntOffset(x.coerceIn(0, (windowSize.width - popupContentSize.width).coerceAtLeast(0)),
                    y.coerceIn(0, (windowSize.height - popupContentSize.height).coerceAtLeast(0)))
            }
        }
    }
    Box {
        Row(Modifier.widthIn(max = 200.dp).clip(RoundedCornerShape(20.dp)).clickable(enabled = enabled) { query = ""; opened = true }
            .padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Plain(label, 12.sp, if (enabled) Ink.text else Ink.muted, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
            Icon(Icons.Outlined.KeyboardArrowDown, "选择模型", Modifier.size(16.dp), tint = Ink.muted)
        }
        if (opened && enabled) Popup(position, { opened = false }, PopupProperties(focusable = true)) {
            val words = query.trim().split(Regex("\\s+"))
            val services = listOf(OfferedService(null, freeService.providerName, listOf(OfferedModel(freeService.modelName)))) +
                catalog.services.filter { it.enabled && it.key.isNotBlank() }.map { OfferedService(it.id, it.name, it.models) }
            val visible = services.map { group -> group.copy(models = group.models.filter { model ->
                model.enabled && words.all { "${group.name} ${model.id}".contains(it, ignoreCase = true) }
            }) }.filter { it.models.isNotEmpty() }
            Surface(Modifier.width(270.dp).heightIn(max = 350.dp), shape = RoundedCornerShape(14.dp), color = Ink.paper, shadowElevation = 8.dp) {
                Column(Modifier.padding(8.dp)) {
                    OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), singleLine = true,
                        placeholder = { Text("搜索模型或服务商") }, shape = RoundedCornerShape(10.dp))
                    LazyColumn(Modifier.heightIn(max = 222.dp).padding(top = 4.dp)) {
                        for (group in visible) {
                            item(key = "provider:${group.id}") {
                                Plain(group.name, 12.sp, Ink.muted, modifier = Modifier.padding(start = 12.dp, top = 8.dp, bottom = 2.dp))
                            }
                            items(group.models, key = { "${group.id}/${it.id}" }) { model ->
                                val choice = if (group.id == null) ModelSelection() else ModelSelection(group.id, model.id)
                                val on = choice == selected
                                DropdownMenuItem({
                                    Column(Modifier.fillMaxWidth()) {
                                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            if (group.id == null) FreeServiceAvatar(Modifier.size(23.dp))
                                            Plain(model.id, 14.sp, modifier = Modifier.weight(1f))
                                            if (on) Icon(Icons.Outlined.Check, "当前模型", Modifier.size(18.dp), tint = Ink.brand)
                                        }
                                        if (group.id == null) Plain(freeService.description, 12.sp, Ink.muted, modifier = Modifier.padding(top = 3.dp))
                                    }
                                }, { opened = false; choose(choice) })
                            }
                        }
                        if (visible.isEmpty()) item { Plain("没有匹配的模型", 13.sp, Ink.muted, modifier = Modifier.padding(12.dp)) }
                    }
                    HorizontalDivider(color = Ink.line)
                    TextButton(onClick = { opened = false; manage() }) { Text("添加或管理模型") }
                }
            }
        }
    }
}

/** The composer keeps the model choice next to the send control. */
@Composable private fun Composer(value: String, onChange: (String) -> Unit, onSend: () -> Unit, onStop: () -> Unit, onTools: () -> Unit,
    busy: Boolean, canSend: Boolean, focus: FocusRequester, model: @Composable () -> Unit) {
    val shape = RoundedCornerShape(24.dp)
    Column(Modifier.fillMaxWidth().shadow(8.dp, shape, ambientColor = Color.Black.copy(alpha = .08f), spotColor = Color.Black.copy(alpha = .08f)).clip(shape).background(Ink.paper).border(1.dp, Ink.line.copy(alpha = .6f), shape)
        .padding(start = 18.dp, end = 8.dp, top = 8.dp, bottom = 8.dp)) {
        val ink = Ink.text
        androidx.compose.foundation.text.BasicTextField(value, onChange, Modifier.fillMaxWidth().heightIn(min = 32.dp, max = 160.dp)
            .focusRequester(focus).semantics { contentDescription = "问点什么" }.padding(top = 5.dp, bottom = 2.dp, end = 8.dp),
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 16.sp, lineHeight = 24.sp, color = ink),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(ink), decorationBox = { inner -> if (value.isEmpty()) Plain("问点什么", 16.sp, Ink.faint); inner() })
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.heightIn(min = 38.dp).clip(RoundedCornerShape(10.dp)).clickable(onClick = onTools)
                .padding(horizontal = 7.dp), horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Build, null, Modifier.size(14.dp), tint = Ink.muted)
                Plain("工具", 12.sp, Ink.muted)
            }
            Spacer(Modifier.weight(1f))
            model()
            val enabled = busy || canSend && value.isNotBlank()
            Box(Modifier.size(38.dp).clip(CircleShape).background(if (enabled) ink else ink.copy(alpha = .18f)).clickable(enabled = enabled) { if (busy) onStop() else onSend() }, contentAlignment = Alignment.Center) {
                Icon(if (busy) Icons.Filled.Stop else Icons.Filled.ArrowUpward, if (busy) "停止" else "发送", Modifier.size(20.dp), tint = Ink.paper)
            }
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
            top.hicancan.studev.app.TextAction("取消", onCancel)
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

private data class ResourceLink(val href: String, val title: String, val detail: String, val kind: String)

private fun resourceLinks(name: String, result: JsonElement): List<ResourceLink> {
    fun place(id: String, title: String, detail: String) = ResourceLink("/map/?place=${android.net.Uri.encode(id)}", title, detail, "map")
    fun JsonObject.text(key: String) = this[key]?.jsonPrimitive?.contentOrNull.orEmpty()
    fun detail(vararg parts: String) = parts.filter { it.isNotBlank() }.joinToString(" · ")
    if (name == "find_place" && result is JsonArray) return result.take(3).map { item ->
        val found = item.jsonObject
        place(found.text("id"), found.text("name"), detail(found.text("where"), found.text("now")))
    }
    val value = result as? JsonObject ?: return emptyList()
    return when (name) {
        "free_rooms" -> value["rooms"]?.jsonArray.orEmpty().take(6).map { item ->
            val room = item.jsonObject
            val id = room.text("room")
            place(id, Names.room(id), "空到 ${hm(room.getValue("until").jsonPrimitive.int)}")
        }
        "route" -> if (value.text("url").isEmpty()) emptyList() else {
            val indoor = value.text("scope") == "within-building"
            val note = if (indoor) detail("同在${value.text("building")}", value.text("to_floor").takeIf { it.isNotEmpty() }?.let { "$it 层" }.orEmpty())
                else value["duration_s"]?.jsonPrimitive?.doubleOrNull?.let { seconds ->
                    "${value.text("distance_m")} 米 · ${if (seconds < 60) "不到 1 分钟" else "约 ${kotlin.math.ceil(seconds / 60).toInt()} 分钟"}"
                }.orEmpty()
            listOf(ResourceLink(value.text("url"), "${if (indoor) "查看" else "导航到"}${value.text("to")}", note, "map"))
        }
        "read" -> if (value.text("url").isEmpty()) emptyList() else
            listOf(ResourceLink(value.text("url"), value.text("title"), detail(value.text("source"), value.text("date")), "knowledge"))
        "nearby" -> value["places"]?.jsonArray.orEmpty().take(4).map { item ->
            val found = item.jsonObject
            place(found.text("id"), found.text("name"), detail("${found.text("metres")} 米", found.text("now")))
        }
        else -> emptyList()
    }
}

@Composable private fun Resources(question: String, links: List<ResourceLink>, route: Route) {
    var expanded by remember(question) { mutableStateOf(false) }
    val one = links.size == 1
    val label = when {
        links.all { it.kind == "knowledge" } -> "参考资料"
        links.all { it.kind == "map" } -> "校园地点"
        else -> "相关资料与地点"
    }
    Column(Modifier.widthIn(max = 540.dp).fillMaxWidth().topHairline(Ink.line).padding(top = 4.dp)) {
        if (!one) Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(7.dp))
            .clickable { expanded = !expanded }.semantics { testTagsAsResourceId = true }.testTag("ai-resources:$question").padding(horizontal = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (expanded) Icons.Outlined.KeyboardArrowDown else Icons.Outlined.ChevronRight, null, Modifier.size(15.dp), tint = Ink.muted)
            Plain(label, 13.sp, Ink.muted)
            Plain("${links.size} 项", 12.sp, Ink.muted)
        }
        if (one || expanded) for (item in links) {
            Row(Modifier.fillMaxWidth().heightIn(min = 42.dp).clip(RoundedCornerShape(7.dp))
                .clickable { openInApp(item.href, route) }.padding(horizontal = 6.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                CampusGlyph(item.kind, 15.dp, Ink.muted)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Plain(item.title, 13.sp, maxLines = 1)
                    if (item.detail.isNotBlank()) Plain(item.detail, 12.sp, Ink.muted, maxLines = 1)
                }
                Icon(if (item.href.startsWith('/')) Icons.Outlined.ChevronRight else Icons.Outlined.OpenInNew, null, Modifier.size(14.dp), tint = Ink.muted)
            }
        }
    }
}


/** What the AI keeps in mind, as MemorySettings in AiApp.tsx: to read, change, empty or turn off. */
@Composable private fun MemorySettings(memory: Memory, project: String?, onClose: () -> Unit, onSave: (Memory) -> Unit) {
    var on by remember { mutableStateOf(memory.on) }
    // Shown as plain lines; kept as a list, one `- ` item a line, as the AI reads and writes it.
    var text by remember { mutableStateOf(memory.text.replace(Regex("(?m)^- "), "")) }
    val count = text.lines().count { it.isNotBlank() }
    AlertDialog(onDismissRequest = onClose, containerColor = Ink.paper,
        title = { Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(if (project == null) "记忆" else "项目记忆")
                Plain(if (project == null) "你是谁、希望 AI 怎么回答，一行一件。你写的和 AI 记下的都在这里。" else "记在「$project」里的信息。", 13.sp, Ink.muted, lineHeight = 19.sp, modifier = Modifier.padding(top = 4.dp))
            }
            Switch(on, { on = it }, modifier = Modifier.padding(start = 12.dp))
        } },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (on) {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Ink.text.copy(alpha = .05f))) {
                    androidx.compose.foundation.text.BasicTextField(text, { text = it.take(Memory.LIMIT) }, Modifier.fillMaxWidth().heightIn(min = 140.dp).padding(horizontal = 14.dp, vertical = 12.dp),
                        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 15.sp, lineHeight = 25.sp, color = Ink.text),
                        cursorBrush = androidx.compose.ui.graphics.SolidColor(Ink.brand),
                        decorationBox = { inner -> Box { if (text.isEmpty()) Plain("一行一件，比如：\n回答先给结论，尽量简短\n通信工程专业，在准备考研", 15.sp, Ink.faint, lineHeight = 25.sp); inner() } })
                    Plain(if (count > 0) "记着 $count 件事" else "聊天时说“记住……”，AI 也会写进来", 12.sp, Ink.muted, modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 10.dp))
                }
            } else {
                Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Ink.text.copy(alpha = .05f)).padding(16.dp)) {
                    Plain("记忆已关闭，AI 看不到这些内容，也不再记新的。" + if (count > 0) "记着的 $count 件事还在，打开就接着用。" else "", 13.5.sp, Ink.muted, lineHeight = 21.sp)
                }
            }
            Plain(if (project == null) "未登录时保存在本机；登录后记忆随账号同步。开启记忆后，提问时会发送给所选模型。"
                else "保存在这台设备上，只在这个项目里使用。开关对所有对话生效。", 12.sp, Ink.faint)
        } },
        confirmButton = { TextButton({ onSave(Memory(on, text.lines().map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n") { "- $it" }.take(Memory.LIMIT))) }) { Text("保存") } },
        dismissButton = { Row { if (on && text.isNotEmpty()) TextButton({ text = "" }) { Text("全部清空", color = Ink.muted) }; TextButton(onClose) { Text("取消") } } })
}

/** The tasks drafted, in one card, as Drafts in AiApp.tsx: each to tick, then added together. */
@Composable private fun Drafts(drafts: List<TaskProposal>, saved: Set<String>, onAdd: (List<String>) -> Unit, onDrop: (String) -> Unit) {
    val open = drafts.filter { it.key !in saved }
    var picked by remember(drafts.size) { mutableStateOf(open.map { it.key }.toSet()) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).border(1.dp, Ink.line, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 12.dp)) {
        Plain(if (open.isNotEmpty()) "起草了 ${drafts.size} 个任务" else "任务已添加 · ${drafts.size} 个任务", 13.sp, Ink.muted, FontWeight.SemiBold)
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
        if (open.isNotEmpty()) Button(onClick = { onAdd(chosen.map { it.key }) }, enabled = chosen.isNotEmpty(), modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Text(if (chosen.size == open.size) "添加全部任务" else "添加 ${chosen.size} 个任务") }
    }
}

/** A link inside the site, opened where it points in the app: a place or a route on the map, or the timetable. */
private fun openInApp(href: String, route: Route) {
    val uri = android.net.Uri.parse("https://studev$href")
    when {
        uri.path?.startsWith("/map") == true -> uri.getQueryParameter("nav")?.let { route.map(nav = it, from = uri.getQueryParameter("from"), mode = uri.getQueryParameter("mode") ?: "walk") } ?: route.map(place = uri.getQueryParameter("place"))
        else -> route.tab = "timetable"
    }
}
