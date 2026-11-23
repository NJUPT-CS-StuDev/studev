package top.hicancan.studev.ai

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import top.hicancan.studev.app.*

internal fun toolName(definition: JsonObject): String = definition.getValue("function").jsonObject.getValue("name").jsonPrimitive.content

internal object CampusToolPreferences {
    private const val DISABLED = "disabledCampus"

    fun store(context: Context): SharedPreferences = context.getSharedPreferences("ai_tools", Context.MODE_PRIVATE)

    fun disabled(store: SharedPreferences): Set<String> = store.getStringSet(DISABLED, emptySet()).orEmpty()

    fun save(store: SharedPreferences, disabled: Set<String>) { store.edit().putStringSet(DISABLED, disabled).apply() }
}

@Composable internal fun CampusToolsSheet(store: SharedPreferences, remoteStore: SharedPreferences, onClose: () -> Unit) {
    val context = LocalContext.current
    val groups = remember(context) {
        context.assets.open("world/tool-menu.json").bufferedReader().use { Json.parseToJsonElement(it.readText()).jsonArray }
    }
    var disabled by remember(store) { mutableStateOf(CampusToolPreferences.disabled(store).toSet()) }
    var opened by remember { mutableStateOf<String?>(null) }
    var servers by remember(remoteStore) { mutableStateOf(RemoteMcpPreferences.read(remoteStore)) }
    var editing by remember { mutableStateOf<RemoteServer?>(null) }
    fun enable(id: String, on: Boolean) {
        disabled = if (on) disabled - id else disabled + id
        CampusToolPreferences.save(store, disabled)
    }
    fun save(server: RemoteServer) {
        servers = if (servers.any { it.id == server.id }) servers.map { if (it.id == server.id) server else it } else servers + server
        RemoteMcpPreferences.save(remoteStore, servers)
    }
    val editor = editing
    if (editor != null) {
        RemoteServerEditor(editor, servers.any { it.id == editor.id }, { editing = null }, {
            save(it)
            editing = null
        }) {
            servers = servers.filter { it.id != editor.id }
            RemoteMcpPreferences.save(remoteStore, servers)
            editing = null
        }
        return
    }
    PlainSheet("MCP", onClose) {
        Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState())) {
            Plain("StuDev MCP", 14.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(vertical = 10.dp))
            for (group in groups) {
                val entry = group.jsonObject
                val label = entry.getValue("label").jsonPrimitive.content
                val tools = entry.getValue("tools").jsonObject
                val count = tools.keys.count { it !in disabled }
                KeyRow(null, label, "$count 项已启用", chevron = true, onClick = { opened = label.takeUnless { it == opened } })
                if (opened == label) for ((id, name) in tools) {
                    val on = id !in disabled
                    KeyRow(null, name.jsonPrimitive.content, trailing = { Toggle(on) { enable(id, it) } }, onClick = { enable(id, !on) })
                }
            }
            Plain("远程 MCP", 14.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(top = 18.dp, bottom = 8.dp))
            for (server in servers) {
                val detail = if (server.enabled) "已启用 · ${server.tools.size} 项只读工具" else "已停用"
                KeyRow(null, server.name, detail,
                    trailing = { Toggle(server.enabled) { on -> if (on && server.tools.isEmpty()) editing = server else save(server.copy(enabled = on)) } },
                    onClick = { editing = server })
            }
            TextAction("添加远程 MCP", { editing = RemoteServer(UUID.randomUUID().toString()) })
        }
    }
}

@Composable private fun RemoteServerEditor(
    original: RemoteServer, existing: Boolean, onBack: () -> Unit, save: (RemoteServer) -> Unit, remove: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var source by remember(original.id) { mutableStateOf(original) }
    var connecting by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf("") }
    val valid = source.name.isNotBlank() && RemoteMcp.endpoint(source.url) != null
    val shape = RoundedCornerShape(Tokens.Radius.control.dp)
    fun changed(next: RemoteServer) { source = next; notice = "" }
    fun candidate(): RemoteServer {
        val clean = source.copy(name = source.name.trim(), url = source.url.trim(), key = source.key.trim())
        return if (clean.url == original.url && clean.key == original.key) clean else clean.copy(enabled = false, tools = emptyList())
    }
    PlainSheet(if (existing) "远程 MCP" else "添加远程 MCP", onBack, back = onBack) {
        Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(source.name, { changed(source.copy(name = it.take(60))) }, Modifier.fillMaxWidth(),
                label = { Text("名称") }, singleLine = true, enabled = !connecting, shape = shape)
            OutlinedTextField(source.url, { next ->
                val url = next.take(2_048)
                changed(source.copy(url = url, key = if (url.trim() == source.url.trim()) source.key else ""))
            }, Modifier.fillMaxWidth(), label = { Text("HTTPS 地址") }, singleLine = true, enabled = !connecting, shape = shape)
            OutlinedTextField(source.key, { changed(source.copy(key = it.take(2_048))) }, Modifier.fillMaxWidth(),
                label = { Text("访问密钥（可选）") }, singleLine = true, enabled = !connecting, shape = shape,
                visualTransformation = PasswordVisualTransformation())
            Plain("开启后，工具会收到请求里的内容，当前模型会看到工具返回的结果。", 12.sp, Ink.muted, lineHeight = 18.sp)
            if (notice.isNotEmpty()) Plain(notice, 12.sp, marks().danger)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextAction(if (connecting) "正在连接…" else "连接并启用", {
                    val current = candidate()
                    connecting = true
                    notice = ""
                    scope.launch {
                        try {
                            val tools = RemoteMcp.discover(current)
                            check(tools.isNotEmpty()) { "这个服务没有可启用的只读工具。" }
                            save(current.copy(enabled = true, tools = tools))
                        } catch (error: CancellationException) { throw error }
                        catch (error: Exception) { notice = (error as? IllegalStateException)?.message ?: "MCP 连接未完成，请重试。" }
                        finally { connecting = false }
                    }
                }, enabled = valid && !connecting)
                TextAction("保存", { save(candidate()) }, enabled = valid && !connecting, muted = true)
                if (existing) TextAction("移除", remove, enabled = !connecting, muted = true)
            }
        }
    }
}
