package top.hicancan.studev.ai

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.hicancan.studev.app.ActionButton
import top.hicancan.studev.app.Ink
import top.hicancan.studev.app.Plain
import top.hicancan.studev.app.PlainSheet
import top.hicancan.studev.app.TextAction
import java.io.InputStream
import java.io.InputStreamReader

/** User-authored Markdown follows the device and the active account, without entering synchronized preferences. */
internal object Instructions {
    const val PERSONAL_LIMIT = 4000
    const val PROJECT_LIMIT = 8000
    const val TOTAL_LIMIT = 12000

    fun owner(accountId: String?) = accountId?.let { "account:$it" } ?: "guest"

    fun read(context: Context, owner: String): String = context.getSharedPreferences("ai_instructions", Context.MODE_PRIVATE)
        .getString(owner, null).orEmpty()

    fun save(context: Context, owner: String, value: String) {
        context.getSharedPreferences("ai_instructions", Context.MODE_PRIVATE).edit().putString(owner, value.take(PERSONAL_LIMIT)).apply()
    }

    fun forChat(personal: String, project: ChatProject?): String? = buildList {
        if (personal.isNotBlank()) add("个人指令\n${personal.trim().take(PERSONAL_LIMIT)}")
        if (project != null) {
            val text = project.instructions.takeIf { project.course == null }.orEmpty().trim().take(PROJECT_LIMIT)
            add("项目：${project.name}" + (project.course?.let { "\n课程：$it" } ?: "") + if (text.isEmpty()) "" else "\n项目指令\n$text")
        }
    }.joinToString("\n\n").take(TOTAL_LIMIT).ifBlank { null }

    fun markdown(input: InputStream, limit: Int): String {
        val buffer = CharArray(limit + 2)
        val text = InputStreamReader(input, Charsets.UTF_8.newDecoder()).use { reader ->
            var size = 0
            while (size < buffer.size) {
                val read = reader.read(buffer, size, buffer.size - size)
                if (read < 0) break
                size += read
            }
            String(buffer, 0, size).removePrefix("\uFEFF")
        }
        require(text.length <= limit) { "指令最多 $limit 字。" }
        require('\u0000' !in text) { "请选择 Markdown 文本。" }
        return text
    }
}

@Composable internal fun InstructionSheet(title: String, note: String, value: String, limit: Int, onClose: () -> Unit, onSave: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf(value) }
    var exporting by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            try {
                text = withContext(Dispatchers.IO) {
                    Instructions.markdown(context.contentResolver.openInputStream(uri) ?: error("无法读取文件。"), limit)
                }
                notice = "已导入，保存后生效。"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                notice = (failure as? IllegalArgumentException)?.message ?: "无法读取文件，请选择 UTF-8 Markdown 文本。"
            }
        }
    }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri ->
        if (uri != null) scope.launch {
            val snapshot = exporting
            try {
                withContext(Dispatchers.IO) {
                    val output = context.contentResolver.openOutputStream(uri) ?: error("无法创建文件。")
                    output.writer(Charsets.UTF_8).use { it.write(snapshot) }
                }
                notice = "已导出 Markdown。"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                notice = "无法导出 Markdown。"
            }
        }
    }
    PlainSheet(title, onClose) {
        Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Plain(note, 13.sp, Ink.muted)
            OutlinedTextField(text, { text = it.take(limit); notice = "" }, Modifier.fillMaxWidth().heightIn(min = 150.dp, max = 280.dp),
                label = { Text("Markdown 指令") }, minLines = 5)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                TextAction("复制", {
                    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(title, text))
                    notice = "已复制。"
                }, enabled = text.isNotEmpty())
                TextAction("导入", { importer.launch(arrayOf("text/*", "application/markdown", "application/octet-stream")) })
                TextAction("导出", { exporting = text; exporter.launch("StuDev-$title.md") }, enabled = text.isNotEmpty())
            }
            if (notice.isNotEmpty()) Plain(notice, 12.sp, Ink.muted)
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            TextAction("取消", onClose)
            ActionButton("保存", go = true) { onSave(text) }
        }
    }
}
