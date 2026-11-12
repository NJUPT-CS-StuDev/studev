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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import top.hicancan.studev.BuildConfig
import java.io.File
import java.net.HttpURLConnection
import java.net.URI

/** The campus's own forms, as `forms` in product.json: a word on how it works, a photo of a place, data the teaching office does not publish. */
object Forms {
    val ids = mapOf("feedback" to BuildConfig.FORM_FEEDBACK, "place" to BuildConfig.FORM_PLACE, "data" to BuildConfig.FORM_DATA)
    /** One of them, opened from a link to the website's /fill/ page: `a.<field>=` fills what the link knows. */
    fun fromLink(link: String): FormRequest? {
        val uri = Uri.parse(link)
        if (uri.path?.trimEnd('/') != "/fill") return null
        val id = uri.getQueryParameter("id") ?: return null
        if (id !in ids.values) return null
        return FormRequest(id, uri.queryParameterNames.filter { it.startsWith("a.") }.associate { it.removePrefix("a.") to uri.getQueryParameter(it).orEmpty() })
    }
}
/** A form to fill, and what is already known of its answers by field id. */
data class FormRequest(val id: String, val fill: Map<String, String> = emptyMap()) {
    constructor(kind: String, vararg fill: Pair<String, String>) : this(Forms.ids.getValue(kind), mapOf(*fill))
}

private data class Picked(val field: String, val name: String, val type: String, val bytes: ByteArray)
private const val MAX_BYTES = 20 * 1024 * 1024
private suspend fun readPicked(context: Context, field: String, uri: Uri): Picked = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: uri.lastPathSegment ?: error("无法读取附件名称。")
    val bytes = resolver.openInputStream(uri)?.use { it.accountBytes(MAX_BYTES) } ?: error("附件已无法读取，请重新选择。")
    require(bytes.isNotEmpty()) { "附件不能为空。" }
    Picked(field, name, resolver.getType(uri) ?: "application/octet-stream", bytes)
}
private suspend fun upload(target: JsonObject, file: Picked) = withContext(Dispatchers.IO) {
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
private val JsonObject.text get() = getValue("type").jsonPrimitive.content
private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.contentOrNull

/**
 * A form on the platform, filled natively, as src/platform/client/fill.ts: read and filled by anyone, sent once signed
 * in. Signing in opens over it and the answers and files stay; the submission then goes on by itself.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable fun FormScreen(client: AccountClient, request: FormRequest, onBack: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<AccountUser?>(null) }
    var form by remember { mutableStateOf<JsonObject?>(null) }
    val answers = remember { mutableStateMapOf<String, String>().apply { putAll(request.fill) } }
    var files by remember { mutableStateOf<List<Picked>>(emptyList()) }
    var pendingId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var signingIn by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    val fields = form?.get("fields")?.jsonArray?.map { it.jsonObject }.orEmpty()
    fun attempt(action: suspend () -> Unit) { if (busy) return; scope.launch { busy = true; error = ""; try { action() } catch (e: CancellationException) { throw e } catch (e: Exception) { error = if (e is PlatformFailure || e is IllegalArgumentException || e is IllegalStateException) e.message.orEmpty() else "网络暂不可用，请重试。" } finally { busy = false } } }
    suspend fun complete() {
        val id = pendingId ?: return
        val receipt = client.uploadReceipt(id) ?: error("这条上传的凭证不在当前设备中，请重新提交。")
        val result = client.request("/submissions/$id/complete", buildJsonObject { put("receiptToken", receipt) }, authenticated = true)
        client.forgetUpload(id)
        pendingId = null
        done = if (result.getValue("submission").jsonObject.str("status") == "pending_review") "收到了，审核后会整理发布。可以在网页“我的提交”查看结果。" else "收到了，谢谢。"
    }
    suspend fun send() {
        val signedIn = user ?: run { signingIn = true; return }
        require(fields.filter { it["required"]?.jsonPrimitive?.boolean == true && it.text != "file" }.all { !answers[it.getValue("id").jsonPrimitive.content].isNullOrBlank() }) { "请填写所有必填项。" }
        fields.filter { it.text == "file" && it["required"]?.jsonPrimitive?.boolean == true }.forEach { field -> require(files.any { it.field == field.getValue("id").jsonPrimitive.content }) { "请添加“${field.getValue("label").jsonPrimitive.content}”。" } }
        require(files.sumOf { it.bytes.size } <= MAX_BYTES) { "附件合计不能超过 20 MB。" }
        val result = client.request("/forms/${request.id}/submissions", buildJsonObject {
            put("answers", buildJsonObject { fields.filter { it.text != "file" }.forEach { field -> val id = field.getValue("id").jsonPrimitive.content; answers[id]?.trim()?.takeIf { it.isNotEmpty() }?.let { put(id, it) } } })
            put("files", buildJsonArray { files.forEach { file -> add(buildJsonObject { put("fieldId", file.field); put("name", file.name); put("size", file.bytes.size); put("type", file.type) }) } })
        }, authenticated = true)
        pendingId = result.getValue("submission").jsonObject.getValue("id").jsonPrimitive.content
        client.keepUpload(pendingId!!, result.getValue("receiptToken").jsonPrimitive.content, signedIn.id)
        val targets = result.getValue("uploads").jsonArray
        require(targets.size == files.size) { "上传信息不完整，请重试确认。" }
        files.forEachIndexed { index, file -> note = "上传 ${index + 1}/${files.size} · ${file.name}"; upload(targets[index].jsonObject, file) }
        note = ""
        complete()
    }
    LaunchedEffect(request.id) {
        user = client.current()
        attempt {
            val definition = client.request("/forms/${request.id}", authenticated = user != null).getValue("form").jsonObject
            require(definition.getValue("fields").jsonArray.all { it.jsonObject.text in listOf("text", "textarea", "select", "file") }) { "这张表有手机上还填不了的题，请在网页填写。" }
            form = definition
        }
    }
    // Which file field a photo or a pick is for, while the camera or the picker is open.
    var picking by remember { mutableStateOf<String?>(null) }
    var shot by remember { mutableStateOf<Uri?>(null) }
    fun add(field: String, uris: List<Uri>) = attempt {
        val spec = fields.first { it.getValue("id").jsonPrimitive.content == field }
        val picked = uris.map { readPicked(context, field, it) }
        val allowed = spec["extensions"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
        require(picked.all { file -> allowed.isEmpty() || file.name.substringAfterLast('.', "").lowercase() in allowed }) { "格式不符合这一项的要求。" }
        val next = files + picked
        require(next.count { it.field == field } <= (spec["maxFiles"]?.jsonPrimitive?.int ?: 1)) { "这一项最多 ${spec["maxFiles"]?.jsonPrimitive?.int ?: 1} 个。" }
        files = next
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> picking?.let { if (uris.isNotEmpty()) add(it, uris) } }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken -> val uri = shot; val field = picking; if (taken && uri != null && field != null) add(field, listOf(uri)) }
    fun takePhoto(field: String) {
        val dir = File(context.cacheDir, "photos").apply { mkdirs() }
        val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        shot = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        picking = field
        camera.launch(shot!!)
    }

    if (signingIn) {
        AccountScreen(client, onBack = { signingIn = false }, onSignedIn = { scope.launch { user = client.current(); signingIn = false; if (user != null) attempt { send() } } })
        return
    }
    Scaffold(topBar = { TopAppBar(title = { Text(form?.str("title") ?: "表单") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            done?.let { message ->
                Text(message, style = MaterialTheme.typography.titleMedium)
                Button(onClick = onBack) { Text("好的") }
                return@Column
            }
            form?.str("description")?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
            val locked = busy || pendingId != null
            for (field in fields) {
                val id = field.getValue("id").jsonPrimitive.content
                val label = field.getValue("label").jsonPrimitive.content + if (field["required"]?.jsonPrimitive?.boolean == true) " *" else ""
                val hint = field.str("description").orEmpty()
                when (field.text) {
                    "file" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(label, style = MaterialTheme.typography.labelLarge)
                        if (hint.isNotEmpty()) Text(hint, style = MaterialTheme.typography.bodySmall)
                        val images = field["extensions"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty().let { it.isEmpty() || "jpg" in it }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (images) OutlinedButton(onClick = { takePhoto(id) }, enabled = !locked) { Text("拍照") }
                            OutlinedButton(onClick = { picking = id; picker.launch(if (images) arrayOf("image/*") else arrayOf("*/*")) }, enabled = !locked) { Text(if (images) "从相册选" else "选择文件") }
                        }
                        files.filter { it.field == id }.forEach { file ->
                            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                Text("${file.name} · ${file.bytes.size / 1024} KB", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                                TextButton(onClick = { files = files - file }, enabled = !locked) { Text("移除") }
                            }
                        }
                    }
                    "select" -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(label, style = MaterialTheme.typography.labelLarge)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            field.getValue("options").jsonArray.map { it.jsonPrimitive.content }.forEach { option ->
                                FilterChip(selected = answers[id] == option, onClick = { answers[id] = option }, label = { Text(option) }, enabled = !locked)
                            }
                        }
                    }
                    else -> OutlinedTextField(answers[id].orEmpty(), { answers[id] = it.take(field["maxLength"]?.jsonPrimitive?.int ?: 2000) }, Modifier.fillMaxWidth(),
                        label = { Text(label) }, supportingText = if (hint.isNotEmpty()) ({ Text(hint) }) else null,
                        singleLine = field.text == "text", minLines = if (field.text == "textarea") 3 else 1, enabled = !locked)
                }
            }
            if (note.isNotEmpty()) Text(note, color = MaterialTheme.colorScheme.primary)
            if (form != null && user == null) Text("可以先填，提交时登录；没有账号可以当场注册，填好的不会丢。", style = MaterialTheme.typography.bodySmall)
            if (pendingId == null) Button(onClick = { attempt { send() } }, enabled = !busy && form != null, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "正在提交……" else "提交") }
            else {
                Text("附件没有确认完成。可以重试；重新填写会占用一次新的提交。", style = MaterialTheme.typography.bodySmall)
                Button(onClick = { attempt { complete() } }, enabled = !busy) { Text("重试确认") }
                TextButton(onClick = { pendingId = null }, enabled = !busy) { Text("放弃这次，重新填写") }
            }
        }
    }
}
