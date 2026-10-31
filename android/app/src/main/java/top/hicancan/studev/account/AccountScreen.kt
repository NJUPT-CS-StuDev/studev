package top.hicancan.studev.account

import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import top.hicancan.studev.ui.theme.Tokens

@Composable private fun SecretField(label: String, value: String, enabled: Boolean, onChange: (String) -> Unit) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(value, { onChange(it.take(256)) }, Modifier.fillMaxWidth(), label = { Text(label) }, singleLine = true, enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = { IconButton(onClick = { visible = !visible }) { Icon(if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (visible) "隐藏$label" else "显示$label") } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun AccountScreen(client: AccountClient, onBack: () -> Unit, onSignedIn: () -> Unit = {}) {
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<AccountUser?>(null) }
    var state by remember { mutableStateOf<AccountState?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var register by rememberSaveable { mutableStateOf(false) }
    var section by rememberSaveable { mutableStateOf("profile") }
    var student by rememberSaveable { mutableStateOf("") }
    var realName by rememberSaveable { mutableStateOf("") }
    var nickname by rememberSaveable { mutableStateOf("") }
    var qq by rememberSaveable { mutableStateOf("") }
    // Secrets are never saved in instance state, logs or ordinary preferences.
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var totp by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    var recovery by remember { mutableStateOf<List<String>>(emptyList()) }
    var devices by remember { mutableStateOf<List<AccountDevice>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmOut by remember { mutableStateOf(false) }
    var revoke by remember { mutableStateOf<AccountDevice?>(null) }
    suspend fun reload() {
        val fresh = client.state(); state = fresh; user = fresh.user
        student = fresh.user.studentId; realName = fresh.user.realName; nickname = fresh.user.nickname
    }
    fun run(action: suspend () -> Unit) {
        scope.launch {
            busy = true; error = null; notice = null
            try { action() }
            catch (failure: Exception) {
                error = if (failure is PlatformFailure) failure.message else "连接未完成，请检查网络后重试。"
                if (failure is PlatformFailure && failure.status == 401 && failure.code in listOf("TOKEN_INVALID", "AUTH_REQUIRED", "REFRESH_REPLAYED")) {
                    client.forget(); user = null; state = null; devices = emptyList()
                }
            } finally { busy = false }
        }
    }
    LaunchedEffect(client) {
        try { user = client.current(); if (user != null) reload() }
        catch (failure: Exception) { error = if (failure is PlatformFailure) failure.message else "账号信息暂时无法读取，请重试。"; if (failure is PlatformFailure && failure.status == 401) { client.forget(); user = null } }
        loaded = true
    }
    LaunchedEffect(section, user?.id) { if (section == "devices" && user != null) run { devices = client.devices() } }
    Scaffold(topBar = { TopAppBar(title = { Text("账号") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(Tokens.Space.xl.dp), verticalArrangement = Arrangement.spacedBy(Tokens.Space.l.dp)) {
            if (!loaded) { CircularProgressIndicator(); return@Column }
            Icon(Icons.Outlined.Lock, null, Modifier.size(36.dp), tint = MaterialTheme.colorScheme.primary)
            Text(if (user == null) if (register) "注册 studev" else "登录 studev" else user!!.nickname, style = MaterialTheme.typography.headlineMedium)
            Text(if (user == null) "每位同学都可以注册，网页与 App 共用一个账号。" else "学号 ${user!!.studentId}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            error?.let { Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.error) }
            notice?.let { Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.primary) }
            if (user == null) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    listOf(false to "登录", true to "注册").forEachIndexed { i, (value, label) ->
                        SegmentedButton(selected = register == value, onClick = { register = value; password = ""; confirm = ""; totp = ""; error = null; notice = null }, enabled = !busy, shape = SegmentedButtonDefaults.itemShape(i, 2)) { Text(label) }
                    }
                }
                OutlinedTextField(student, { student = it.take(20); totp = "" }, Modifier.fillMaxWidth(), label = { Text("学号") }, singleLine = true, enabled = !busy)
                if (register) {
                    OutlinedTextField(realName, { realName = it.take(40) }, Modifier.fillMaxWidth(), label = { Text("真实姓名") }, singleLine = true, enabled = !busy)
                    OutlinedTextField(nickname, { nickname = it.take(40) }, Modifier.fillMaxWidth(), label = { Text("昵称") }, supportingText = { Text("其他同学只会看到你的昵称。身份与联系方式仅本人和管理员可见。") }, singleLine = true, enabled = !busy)
                    OutlinedTextField(qq, { qq = it.take(12) }, Modifier.fillMaxWidth(), label = { Text("联系 QQ") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true, enabled = !busy)
                }
                SecretField("密码", password, !busy) { password = it }
                if (register) SecretField("确认密码", confirm, !busy) { confirm = it }
                else OutlinedTextField(totp, { totp = it.take(64) }, Modifier.fillMaxWidth(), label = { Text("动态验证码或恢复码") }, supportingText = { Text("已绑定认证器的账号需要填写。") }, singleLine = true, enabled = !busy)
                Button(onClick = { run {
                    if (register) {
                        if (password != confirm) { error = "两次输入的密码不一致。"; return@run }
                        client.register(student, realName, nickname, qq, password)
                        register = false; password = ""; confirm = ""; totp = ""; notice = "注册成功，请使用学号和密码登录。"
                    } else {
                        user = client.signIn(student, password, totp, "${Build.MANUFACTURER} ${Build.MODEL}")
                        password = ""; totp = ""; reload(); onSignedIn()
                    }
                } }, Modifier.fillMaxWidth().testTag("account-submit"), enabled = !busy && student.isNotBlank() && password.isNotBlank() && (!register || realName.isNotBlank() && nickname.isNotBlank() && qq.isNotBlank() && confirm.isNotBlank())) {
                    if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(if (register) "创建账号" else "登录")
                }
                Text("密码需要 12–256 个字符。忘记密码或学号被占用时，请联系管理员核实。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    listOf("profile" to "资料", "security" to "安全", "devices" to "设备").forEachIndexed { i, (value, label) ->
                        SegmentedButton(selected = section == value, onClick = { section = value; password = ""; newPassword = ""; confirm = ""; totp = ""; secret = ""; recovery = emptyList() }, enabled = !busy, shape = SegmentedButtonDefaults.itemShape(i, 3)) { Text(label) }
                    }
                }
                if (state?.passwordChangeRequired == true || state?.enrollmentRequired == true) Text("请先在「安全」中${if (state?.passwordChangeRequired == true) "修改临时密码" else "绑定认证器"}，完成账号设置。", color = MaterialTheme.colorScheme.primary)
                when (section) {
                    "profile" -> {
                        OutlinedTextField(student, { student = it.take(20) }, Modifier.fillMaxWidth(), label = { Text("学号") }, readOnly = user!!.studentId.isNotBlank(), singleLine = true, enabled = !busy)
                        OutlinedTextField(realName, { realName = it.take(40) }, Modifier.fillMaxWidth(), label = { Text("真实姓名") }, readOnly = user!!.realName.isNotBlank(), singleLine = true, enabled = !busy)
                        OutlinedTextField(nickname, { nickname = it.take(40) }, Modifier.fillMaxWidth(), label = { Text("昵称") }, singleLine = true, enabled = !busy)
                        Text("普通账号对其他同学仅显示昵称。学号有误时请联系管理员核实。", style = MaterialTheme.typography.bodySmall)
                        Button(onClick = { run { client.request("/auth/profile", buildJsonObject { put("revision", user!!.revision); put("studentId", student); put("realName", realName); put("nickname", nickname) }, authenticated = true); reload(); notice = "资料已保存。" } }, enabled = !busy && nickname.isNotBlank()) { Text("保存资料") }
                    }
                    "devices" -> {
                        Text("网页与 Android 的登录设备都在这里。退出设备会同时撤销访问与刷新凭据。", style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick = { run { devices = client.devices() } }, enabled = !busy) { Text("刷新设备列表") }
                        for (device in devices) OutlinedCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(device.deviceName, style = MaterialTheme.typography.titleMedium)
                                Text((if (device.kind == "cookie") "网页" else "Android") + if (device.current) " · 当前设备" else "", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("登录于 ${device.createdAt.take(16).replace('T', ' ')} UTC", style = MaterialTheme.typography.bodySmall)
                                TextButton(onClick = { revoke = device }, enabled = !busy) { Text("退出此设备") }
                            }
                        }
                    }
                    else -> {
                        Text("修改密码", style = MaterialTheme.typography.titleLarge)
                        SecretField("当前密码", password, !busy) { password = it }
                        SecretField("新密码", newPassword, !busy) { newPassword = it }
                        SecretField("确认新密码", confirm, !busy) { confirm = it }
                        if (user!!.totpEnabled) OutlinedTextField(totp, { totp = it.take(64) }, Modifier.fillMaxWidth(), label = { Text("动态验证码或恢复码") }, singleLine = true, enabled = !busy)
                        Button(onClick = { run {
                            if (newPassword != confirm) { error = "两次输入的新密码不一致。"; return@run }
                            client.request("/auth/password", buildJsonObject { put("currentPassword", password); put("newPassword", newPassword); put("totp", totp) }, authenticated = true)
                            client.forget(); user = null; state = null; password = ""; newPassword = ""; confirm = ""; totp = ""; notice = "密码已修改，请重新登录。"
                        } }, enabled = !busy && password.isNotBlank() && newPassword.length >= 12 && confirm.isNotBlank()) { Text("修改密码并重新登录") }
                        HorizontalDivider()
                        Text("认证器验证", style = MaterialTheme.typography.titleLarge)
                        Text(if (user!!.totpEnabled) "已开启。登录时填写动态验证码或一次性恢复码。" else "可使用任意支持 TOTP 的认证器，无需 Google 服务。", style = MaterialTheme.typography.bodyMedium)
                        if (recovery.isNotEmpty()) {
                            Text("恢复码只显示一次，请妥善离线保存。每个恢复码仅可使用一次。", color = MaterialTheme.colorScheme.primary)
                            SelectionContainer { Text(recovery.joinToString("\n")) }
                            TextButton(onClick = { recovery = emptyList() }) { Text("我已保存恢复码") }
                        }
                        if (!user!!.totpEnabled) {
                            if (secret.isEmpty()) OutlinedButton(onClick = { run {
                                val reply = client.request("/auth/totp/setup", buildJsonObject { put("password", password) }, authenticated = true)
                                secret = reply.getValue("secret").jsonPrimitive.content; totp = ""
                            } }, enabled = !busy && password.isNotBlank() && state?.passwordChangeRequired != true) { Text("绑定认证器") }
                            else {
                                Text("在认证器中手动添加：名称 studev，类型基于时间，SHA1，6 位，每 30 秒更新。")
                                SelectionContainer { Text(secret, style = MaterialTheme.typography.bodyLarge) }
                                OutlinedTextField(totp, { totp = it.take(6) }, Modifier.fillMaxWidth(), label = { Text("认证器的 6 位动态码") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true, enabled = !busy)
                                Button(onClick = { run {
                                    val reply = client.request("/auth/totp/confirm", buildJsonObject { put("code", totp) }, authenticated = true)
                                    recovery = reply.getValue("recoveryCodes").jsonArray.map { it.jsonPrimitive.content }; secret = ""; totp = ""; password = ""; reload()
                                } }, enabled = !busy && totp.length == 6) { Text("确认绑定") }
                            }
                        } else if (user!!.role != "owner") OutlinedButton(onClick = { run {
                            client.request("/auth/totp/disable", buildJsonObject { put("password", password); put("code", totp) }, authenticated = true)
                            client.forget(); user = null; state = null; password = ""; totp = ""; notice = "认证器已解绑，请重新登录。"
                        } }, enabled = !busy && password.isNotBlank() && totp.isNotBlank()) { Text("解绑认证器并重新登录") }
                    }
                }
                OutlinedButton(onClick = { confirmOut = true }, enabled = !busy) { Text("退出登录") }
            }
        }
    }
    if (confirmOut || revoke != null) AlertDialog(onDismissRequest = { if (!busy) { confirmOut = false; revoke = null } }, title = { Text("退出${revoke?.deviceName ?: "此账号"}？") }, text = { Text("此设备需要重新登录才能使用账号服务。") },
        confirmButton = { TextButton(enabled = !busy, onClick = { run {
            val target = revoke
            if (target == null) client.signOut() else client.revokeDevice(target.id)
            if (target == null || target.current) { client.forget(); user = null; state = null; devices = emptyList() } else devices = client.devices()
            confirmOut = false; revoke = null
        } }) { Text(if (busy) "正在退出…" else "确认退出") } }, dismissButton = { TextButton(enabled = !busy, onClick = { confirmOut = false; revoke = null }) { Text("取消") } })
}
