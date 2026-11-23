package top.hicancan.studev.ai

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import top.hicancan.studev.R
import top.hicancan.studev.app.*
import java.util.UUID

@Composable internal fun FreeServiceAvatar(modifier: Modifier) {
    Image(painterResource(R.drawable.hicancan_avatar), null, modifier.clip(CircleShape), contentScale = ContentScale.Crop)
}

@Composable internal fun ModelServicesSheet(onBack: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember(context) { ModelPreferences.get(context) }
    val freeService = remember(context) { Assistant.loadFreeService(context) }
    val catalog by rememberModelCatalog(prefs)
    var editing by remember { mutableStateOf<ModelService?>(null) }
    val current = editing
    if (current == null) {
        PlainSheet("模型服务", onBack, back = onBack) {
            LazyColumn(Modifier.heightIn(max = 440.dp), contentPadding = PaddingValues(top = 8.dp)) {
                item {
                    KeyRow(null, "${freeService.providerName} · ${freeService.modelName}", freeService.description,
                        leading = { FreeServiceAvatar(Modifier.size(32.dp)) })
                }
                items(catalog.services, key = { it.id }) { service ->
                    val note = if (!service.enabled) "已停用" else "已启用 ${service.models.count { it.enabled }} 个模型"
                    KeyRow(null, service.name, note, chevron = true, onClick = { editing = service })
                }
                item {
                    ActionButton("添加服务商", modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
                        editing = ModelService(UUID.randomUUID().toString(), "", "", "")
                    }
                }
            }
        }
    } else key(current.id) {
        val existing = catalog.service(current.id) != null
        ModelServiceEditor(current, existing, onBack = { editing = null },
            onSave = { service -> ModelPreferences.update(prefs) { it.saving(service) }; editing = null },
            onRemove = { ModelPreferences.update(prefs) { it.copy(services = it.services.filterNot { service -> service.id == current.id }) }; editing = null })
    }
}

@Composable private fun ModelServiceEditor(
    initial: ModelService, existing: Boolean, onBack: () -> Unit,
    onSave: (ModelService) -> Unit, onRemove: () -> Unit,
) {
    var service by remember { mutableStateOf(initial) }
    var customModel by remember { mutableStateOf("") }
    var modelFilter by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf("") }
    var removing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val addressError = if (service.base.isNotBlank()) Models.addressError(service.base) else null
    val canConnect = service.base.isNotBlank() && addressError == null && service.key.isNotBlank()
    fun addModel() {
        val id = customModel.trim()
        if (id.isEmpty()) return
        service = service.copy(models = if (service.models.any { it.id == id }) {
            service.models.map { if (it.id == id) it.copy(enabled = true) else it }
        } else listOf(OfferedModel(id)) + service.models)
        customModel = ""
        modelFilter = ""
    }
    fun discover() {
        val base = service.base
        val key = service.key
        loading = true
        result = ""
        scope.launch {
            try {
                val ids = Models.fetchModels(base, key)
                val known = service.models.mapTo(mutableSetOf()) { it.id }
                service = service.copy(models = service.models + ids.filterNot(known::contains).map { OfferedModel(it, enabled = false) })
                result = "已读取 ${ids.size} 个模型，打开要使用的模型"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                result = (failure as? IllegalStateException)?.message ?: "连接失败，请检查地址和网络，或手动添加模型。"
            } finally { loading = false }
        }
    }
    PlainSheet(if (existing) "编辑服务商" else "添加服务商", onBack, back = onBack) {
        LazyColumn(Modifier.heightIn(max = 460.dp), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(top = 6.dp, bottom = 8.dp)) {
            item { ServiceField(service.name, { service = service.copy(name = it) }, "服务商名称") }
            item {
                ServiceField(service.base, { service = service.copy(base = it); result = "" }, "HTTPS 接口地址", enabled = !loading, invalid = addressError != null)
                addressError?.let { Plain(it, 12.sp, marks().danger) }
            }
            item {
                ServiceField(service.key, { service = service.copy(key = it); result = "" }, "API Key", enabled = !loading, password = true)
                Plain("密钥只存在这台设备。对话内容会直接发给这个服务商。", 12.sp, Ink.muted, modifier = Modifier.padding(top = 4.dp))
            }
            item { KeyRow(null, "启用服务商", trailing = { Toggle(service.enabled) { service = service.copy(enabled = it) } }) }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Plain("模型", 15.sp, weight = FontWeight.SemiBold)
                    TextAction(if (loading) "拉取中…" else "拉取模型列表", ::discover, enabled = canConnect && !loading)
                }
                if (result.isNotEmpty()) Plain(result, 12.sp, Ink.muted)
            }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    ServiceField(customModel, { customModel = it }, "手动填写模型名", Modifier.weight(1f))
                    ActionButton("添加", enabled = customModel.isNotBlank(), onClick = ::addModel)
                }
            }
            if (service.models.size > 8) {
                item { ServiceField(modelFilter, { modelFilter = it }, "筛选模型") }
            }
            items(service.models.filter { it.id.contains(modelFilter.trim(), ignoreCase = true) }, key = { it.id }) { model ->
                KeyRow(null, model.id, trailing = {
                    Toggle(model.enabled) { enabled ->
                        service = service.copy(models = service.models.map { if (it.id == model.id) it.copy(enabled = enabled) else it })
                    }
                })
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
            if (existing) TextAction("删除服务商", { removing = true })
            ActionButton("保存", go = true, enabled = !loading && service.name.isNotBlank() && canConnect) {
                onSave(service.copy(name = service.name.trim(), base = service.base.trim(), key = service.key.trim()))
            }
        }
    }
    if (removing) AlertDialog(onDismissRequest = { removing = false }, containerColor = Ink.paper,
        title = { Text("删除服务商？") }, text = { Text("已选用 ${service.name} 的对话会保留，下次发消息前，请另选一个模型。") },
        confirmButton = { TextButton(onRemove) { Text("删除", color = marks().danger) } },
        dismissButton = { TextButton({ removing = false }) { Text("取消") } })
}

@Composable private fun ServiceField(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, invalid: Boolean = false, password: Boolean = false) {
    OutlinedTextField(value, onChange, modifier.fillMaxWidth(), enabled = enabled, isError = invalid, label = { Text(label) },
        singleLine = true, shape = RoundedCornerShape(Tokens.Radius.control.dp), visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None)
}
