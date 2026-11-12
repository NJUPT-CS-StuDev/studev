package top.hicancan.studev.account

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.studev.BuildConfig
import java.net.HttpURLConnection
import java.net.URI

private data class PickedDocument(val name: String, val type: String, val bytes: ByteArray)
private const val MAX_BYTES = 20 * 1024 * 1024
private suspend fun readDocument(context: Context, uri: Uri): PickedDocument = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: error("无法读取附件名称。")
    val bytes = resolver.openInputStream(uri)?.use { it.accountBytes(MAX_BYTES) } ?: error("附件已无法读取，请重新选择。")
    require(bytes.isNotEmpty()) { "附件不能为空。" }
    PickedDocument(name, resolver.getType(uri) ?: "application/octet-stream", bytes)
}
private suspend fun uploadDocument(target: JsonObject, file: PickedDocument) = withContext(Dispatchers.IO) {
    val uri = URI(target.getValue("url").jsonPrimitive.content)
    require(uri.scheme == "https" && uri.userInfo == null) { "上传地址无效。" }
    val connection = uri.toURL().openConnection() as HttpURLConnection
    try {
        connection.connectTimeout = 15_000; connection.readTimeout = 120_000
        connection.instanceFollowRedirects = false; connection.requestMethod = "PUT"; connection.doOutput = true
        target["headers"]?.jsonObject?.forEach { (name, value) -> connection.setRequestProperty(name, value.jsonPrimitive.content) }
        connection.setFixedLengthStreamingMode(file.bytes.size.toLong())
        connection.outputStream.use { it.write(file.bytes) }
        require(connection.responseCode in 200..299) { "附件上传未完成，请检查网络后重试确认。" }
    } finally { connection.disconnect() }
}

/** The same form, account and immutable attachment service used by the website. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ContributionScreen(client: AccountClient, onBack: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<AccountUser?>(null) }
    var checked by remember { mutableStateOf(false) }
    var form by remember { mutableStateOf<JsonObject?>(null) }
    val answers = remember { mutableStateMapOf<String, String>() }
    var documents by remember { mutableStateOf<List<PickedDocument>>(emptyList()) }
    var pendingId by rememberSaveable { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var records by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    val fields = form?.get("fields")?.jsonArray?.map { it.jsonObject }.orEmpty()
    val fileField = fields.singleOrNull { it["type"]?.jsonPrimitive?.content == "file" }
    fun run(action: suspend () -> Unit) { if (busy) return; scope.launch { busy = true; error = ""; try { action() } catch (e: CancellationException) { throw e } catch (e: Exception) { error = if (e is PlatformFailure || e is IllegalArgumentException || e is IllegalStateException) e.message.orEmpty() else "网络暂不可用，请重试。" } finally { busy = false } } }
    suspend fun refresh() {
        val definition = client.request("/forms/${BuildConfig.CONTRIBUTION_FORM}", authenticated = true).getValue("form").jsonObject
        require(definition.getValue("fields").jsonArray.all { it.jsonObject.getValue("type").jsonPrimitive.content in listOf("text", "textarea", "file") }) { "资料表字段已调整，请在网页填写。" }
        form = definition
        records = client.request("/me/submissions", authenticated = true).getValue("items").jsonArray.map { it.jsonObject }.filter { it["formId"]?.jsonPrimitive?.content == BuildConfig.CONTRIBUTION_FORM }
    }
    suspend fun complete() {
        val id = pendingId ?: return
        val receipt = client.uploadReceipt(id) ?: error("这条上传的回执不在当前设备中，请回到最初上传的设备确认，或重新提交。")
        client.request("/submissions/$id/complete", buildJsonObject { put("receiptToken", receipt) }, authenticated = true)
        client.forgetUpload(id)
        pendingId = null; documents = emptyList(); answers.clear(); note = "资料已提交，等待管理员审核。审核通过后会整理为校园数据发布。"
        refresh()
    }
    LaunchedEffect(Unit) { user = client.current(); checked = true; if (user != null) run { refresh() } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) run {
            require(uris.size <= (fileField?.get("maxFiles")?.jsonPrimitive?.int ?: 5)) { "选择的附件数量过多。" }
            val picked = uris.map { readDocument(context, it) }
            require(picked.sumOf { it.bytes.size } <= MAX_BYTES) { "本次附件合计不能超过 20 MB。" }
            val allowed = fileField?.get("extensions")?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
            require(picked.all { file -> allowed.isEmpty() || file.name.substringAfterLast('.', "").lowercase() in allowed }) { "附件格式不符合资料表要求。" }
            documents = picked
        }
    }
    if (!checked) { Box(Modifier.fillMaxSize()) { CircularProgressIndicator() }; return }
    if (user == null) { AccountScreen(client, onBack, onSignedIn = { scope.launch { user = client.current(); run { refresh() } } }); return }
    Scaffold(topBar = { TopAppBar(title = { Text("贡献资料") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(form?.get("title")?.jsonPrimitive?.content ?: "校园公共资料与勘误", style = MaterialTheme.typography.titleLarge)
            Text(form?.get("description")?.jsonPrimitive?.content ?: "正在读取资料表……", style = MaterialTheme.typography.bodyMedium)
            if (note.isNotEmpty()) Text(note, color = MaterialTheme.colorScheme.primary)
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
            for (field in fields.filter { it.getValue("type").jsonPrimitive.content != "file" }) {
                val id = field.getValue("id").jsonPrimitive.content
                OutlinedTextField(answers[id].orEmpty(), { answers[id] = it.take(field["maxLength"]?.jsonPrimitive?.int ?: 2000) }, Modifier.fillMaxWidth(),
                    label = { Text(field.getValue("label").jsonPrimitive.content + if (field["required"]?.jsonPrimitive?.boolean == true) " *" else "") },
                    supportingText = { Text(field["description"]?.jsonPrimitive?.content.orEmpty()) }, singleLine = field.getValue("type").jsonPrimitive.content == "text", enabled = !busy && pendingId == null)
            }
            if (fileField != null) {
                OutlinedButton(onClick = { picker.launch(arrayOf("*/*")) }, enabled = !busy && pendingId == null) { Text("选择原始资料 · 最多 ${fileField["maxFiles"]?.jsonPrimitive?.int ?: 5} 个") }
                documents.forEach { Text("${it.name} · ${it.bytes.size / 1024} KB") }
                if (documents.isNotEmpty() && pendingId == null) TextButton(onClick = { documents = emptyList() }, enabled = !busy) { Text("清除所选附件") }
            }
            if (pendingId == null) Button(enabled = !busy && form != null, onClick = { run {
                require(fields.filter { it["required"]?.jsonPrimitive?.boolean == true && it.getValue("type").jsonPrimitive.content != "file" }.all { !answers[it.getValue("id").jsonPrimitive.content].isNullOrBlank() }) { "请填写所有必填项。" }
                val result = client.request("/forms/${BuildConfig.CONTRIBUTION_FORM}/submissions", buildJsonObject {
                    put("answers", buildJsonObject { answers.forEach { (id, value) -> put(id, value.trim()) } })
                    put("files", buildJsonArray { documents.forEach { file -> add(buildJsonObject { put("fieldId", fileField!!.getValue("id")); put("name", file.name); put("size", file.bytes.size); put("type", file.type) }) } })
                }, authenticated = true)
                pendingId = result.getValue("submission").jsonObject.getValue("id").jsonPrimitive.content
                client.keepUpload(pendingId!!, result.getValue("receiptToken").jsonPrimitive.content, user!!.id)
                val targets = result.getValue("uploads").jsonArray
                require(targets.size == documents.size) { "上传信息不完整，请重试确认。" }
                documents.forEachIndexed { index, file -> note = "上传 ${index + 1}/${documents.size} · ${file.name}"; uploadDocument(targets[index].jsonObject, file) }
                note = "正在确认提交……"; complete()
            } }) { Text(if (busy) "正在提交……" else "提交资料，等待审核") }
            else {
                Text("编号 $pendingId。请先重试确认；重新填写会占用一次新的提交名额。")
                Button(onClick = { run { complete() } }, enabled = !busy) { Text("重试确认提交") }
                TextButton(onClick = { pendingId = null; note = "原提交记录已保留。可以重新填写。" }, enabled = !busy) { Text("放弃本次，重新填写") }
            }
            HorizontalDivider()
            Text("我的资料提交", style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = { run { refresh() } }, enabled = !busy) { Text("刷新审核结果") }
            records.forEach { record ->
                val status = record.getValue("status").jsonPrimitive.content
                val label = mapOf("uploading" to "待完成", "pending_review" to "待审核", "accepted" to "已通过", "rejected" to "已退回", "submitted" to "已提交")[status] ?: status
                Text("${record["createdAt"]?.jsonPrimitive?.content?.take(10).orEmpty()} · $label")
                record["answers"]?.jsonObject?.values?.firstOrNull()?.jsonPrimitive?.contentOrNull?.let { Text(it) }
                record["review"]?.jsonObject?.get("comment")?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { Text(it) }
                if (status == "uploading") TextButton(onClick = { pendingId = record.getValue("id").jsonPrimitive.content; run { complete() } }, enabled = !busy) { Text("确认这条提交") }
            }
        }
    }
}
